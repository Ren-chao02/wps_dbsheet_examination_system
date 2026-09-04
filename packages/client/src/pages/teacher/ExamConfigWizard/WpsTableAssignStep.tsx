import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Button, Card, Input, Table, message, Space, Typography, Alert, Spin, Tabs
} from 'antd';
import { SaveOutlined, ImportOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/auth';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

interface WpsTableAssignStepProps {
  exam: { id: string; title: string };
  onSaved: () => void;
  onBack: () => void;
}

interface StudentRow {
  studentId: string;
  realName: string;
  username: string;
  studentIdNumber: string | null;
  shareUrl: string;
}

// 独立输入组件：本地 state 管理，只在失焦时提交到父级，避免每次按键全量更新
function StudentUrlCell({
  studentId,
  value,
  onChange,
}: {
  studentId: string;
  value: string;
  onChange: (studentId: string, url: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);
  const prevStudentIdRef = useRef(studentId);
  const prevExternalValueRef = useRef(value);

  // 使用 useEffect 同步外部值变化，避免在 render 中调用 setState 导致级联重渲染
  useEffect(() => {
    if (studentId !== prevStudentIdRef.current) {
      prevStudentIdRef.current = studentId;
      setLocalValue(value);
      prevExternalValueRef.current = value;
    } else if (value !== prevExternalValueRef.current) {
      prevExternalValueRef.current = value;
      setLocalValue(value);
    }
  }, [studentId, value]);

  const handleBlur = useCallback(() => {
    if (localValue !== value) {
      onChange(studentId, localValue);
    }
  }, [studentId, localValue, value, onChange]);

  return (
    <Input
      placeholder="https://www.kdocs.cn/l/xxxxxx"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onPressEnter={(e: any) => e.target?.blur?.()}
    />
  );
}

export function WpsTableAssignStep({ exam, onSaved, onBack }: WpsTableAssignStepProps) {
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const accessToken = useAuthStore(state => state.wpsToken?.accessToken) || '';
  const wpsToken = useAuthStore(state => state.wpsToken);
  const getWpsTokenRemainingSeconds = useAuthStore(state => state.getWpsTokenRemainingSeconds);

  useEffect(() => {
    loadData();
  }, [exam.id]);

  const loadData = async () => {
    try {
      const [studentsRes, assignmentsRes] = await Promise.all([
        api.get(`/exams/${exam.id}/students`),
        api.get(`/exam-table-assignments/${exam.id}`),
      ]);

      const assignedMap = new Map<string, any>(
        (assignmentsRes.data.assignments || []).map((a: any) => [a.studentId, a])
      );

      setStudents((studentsRes.data.students || []).map((s: any) => {
        const assigned = assignedMap.get(s.id);
        return {
          studentId: s.id,
          realName: s.realName || s.username,
          username: s.username,
          studentIdNumber: s.studentId || null,
          shareUrl: assigned?.shareUrl || '',
        };
      }));
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleShareUrlChange = useCallback((studentId: string, value: string) => {
    setStudents(prev => prev.map(s =>
      s.studentId === studentId ? { ...s, shareUrl: value } : s
    ));
  }, []);

  const handleSave = async () => {
    const items = students
      .filter(s => s.shareUrl.trim())
      .map(s => ({
        studentId: s.studentId,
        shareUrl: s.shareUrl.trim(),
        accessToken,
      }));

    if (students.length === 0) {
      message.warning('该考试尚未分配考生，请先返回上一步（考生设置）分配考生后再分配表格');
      return;
    }
    if (items.length === 0) {
      message.warning('请至少为一个考生填写 WPS 表格分享链接');
      return;
    }

    setSaving(true);
    try {
      await api.post(`/exam-table-assignments/${exam.id}/bulk`, { items });
      message.success('分配保存成功');
      onSaved();
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkImport = () => {
    const lines = bulkText.split('\n').filter(l => l.trim());
    const map = new Map<string, string>();
    for (const line of lines) {
      const parts = line.split(/[,\s]+/).filter(Boolean);
      if (parts.length >= 2) {
        map.set(parts[0].trim(), parts[1].trim());
      }
    }

    setStudents(prev => prev.map(s => {
      const key = s.studentIdNumber || s.username;
      if (map.has(key)) {
        return { ...s, shareUrl: map.get(key)! };
      }
      return s;
    }));
    message.success('批量导入完成');
    setBulkText('');
  };

  const columns = useMemo(() => [
    { title: '姓名', dataIndex: 'realName', width: 120 },
    { title: '学号', dataIndex: 'studentIdNumber', width: 140, render: (v: string) => v || '-' },
    { title: '用户名', dataIndex: 'username', width: 140 },
    {
      title: 'WPS 多维表格分享链接',
      render: (_: any, record: StudentRow) => (
        <StudentUrlCell
          studentId={record.studentId}
          value={record.shareUrl}
          onChange={handleShareUrlChange}
        />
      ),
    },
  ], [handleShareUrlChange]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;

  return (
    <Card title="WPS 多维表格分配">
      <Alert
        type="info"
        showIcon
        message="请先在 WPS 中为每个考生创建空白多维表格，然后将分享链接粘贴到下方。"
        description={
          <div>
            <p style={{ marginBottom: 4 }}>
              <strong>重要：分享链接必须设置为「任何人可查看/编辑」（无需登录）。</strong>
            </p>
            <p style={{ marginBottom: 0, color: '#666' }}>
              在 WPS 多维表格右上角「分享」→ 权限设置为「知道链接的人都能查看/编辑」。
              否则学生在考试界面会看到 WPS 登录页而非表格内容。
            </p>
          </div>
        }
        style={{ marginBottom: 16 }}
      />

      {/* WPS Token 状态提示 */}
      {!wpsToken && (
        <Alert
          type="info"
          showIcon
          message="建议配置 WPS Token"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>
                自动判分时需要 WPS Token 来获取考生多维表格数据。当前尚未配置，建议在判分前完成配置。
              </p>
              <Button
                type="default"
                size="small"
                icon={<LinkOutlined />}
                onClick={() => navigate('/teacher/wps-token')}
              >
                前往 WPS Token 管理
              </Button>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      {wpsToken && getWpsTokenRemainingSeconds() <= 0 && (
        <Alert
          type="warning"
          showIcon
          message="WPS Token 已过期"
          description={
            <div>
              <p style={{ marginBottom: 8 }}>
                自动判分时需要有效的 WPS Token。当前 Token 已过期，建议在判分前刷新。
              </p>
              <Button
                type="default"
                size="small"
                icon={<LinkOutlined />}
                onClick={() => navigate('/teacher/wps-token')}
              >
                前往刷新 Token
              </Button>
            </div>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Tabs
        items={[
          {
            key: 'list',
            label: '逐个分配',
            children: (
              <Table
                dataSource={students}
                rowKey="studentId"
                columns={columns}
                pagination={{ pageSize: 20 }}
                size="small"
              />
            ),
          },
          {
            key: 'bulk',
            label: '批量导入',
            children: (
              <div>
                <Text type="secondary">
                  每行格式：学号/用户名 + 空格/逗号 + 分享链接
                </Text>
                <Input.TextArea
                  rows={10}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={`2024001 https://www.kdocs.cn/l/abc123\n2024002 https://www.kdocs.cn/l/def456`}
                  style={{ marginTop: 8, marginBottom: 12 }}
                />
                <Button icon={<ImportOutlined />} onClick={handleBulkImport}>
                  应用批量导入
                </Button>
              </div>
            ),
          },
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>
          保存并下一步
        </Button>
      </div>
    </Card>
  );
}
