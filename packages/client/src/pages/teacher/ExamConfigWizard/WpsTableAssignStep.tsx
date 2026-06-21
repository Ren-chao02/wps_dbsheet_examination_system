import { useEffect, useState } from 'react';
import {
  Button, Card, Input, Table, message, Space, Typography, Alert, Spin, Tabs
} from 'antd';
import { SaveOutlined, ImportOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import { useAuthStore } from '../../../stores/auth';

const { Text, TextArea } = Typography;

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

export function WpsTableAssignStep({ exam, onSaved, onBack }: WpsTableAssignStepProps) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const { user } = useAuthStore();

  // Try to use the user's cached WPS access token if available in the auth store.
  // Fallback: leave empty; the backend will reject if absent.
  const accessToken = (user as any)?.wpsAccessToken || '';

  useEffect(() => {
    loadData();
  }, [exam.id]);

  const loadData = async () => {
    try {
      const [studentsRes, assignmentsRes] = await Promise.all([
        api.get(`/exams/${exam.id}/students`),
        api.get(`/exam-table-assignments/${exam.id}`),
      ]);

      const assignedMap = new Map(
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

  const handleShareUrlChange = (studentId: string, value: string) => {
    setStudents(prev => prev.map(s =>
      s.studentId === studentId ? { ...s, shareUrl: value } : s
    ));
  };

  const handleSave = async () => {
    const items = students
      .filter(s => s.shareUrl.trim())
      .map(s => ({
        studentId: s.studentId,
        shareUrl: s.shareUrl.trim(),
        accessToken,
      }));

    if (items.length === 0) {
      message.warning('请至少为一个考生填写分享链接');
      return;
    }

    if (!accessToken) {
      message.warning('请先完成 WPS Token 授权（个人设置 → WPS Token 管理）');
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

  const columns = [
    { title: '姓名', dataIndex: 'realName', width: 120 },
    { title: '学号', dataIndex: 'studentIdNumber', width: 140, render: (v: string) => v || '-' },
    { title: '用户名', dataIndex: 'username', width: 140 },
    {
      title: 'WPS 多维表格分享链接',
      render: (_: any, record: StudentRow) => (
        <Input
          placeholder="https://www.kdocs.cn/l/xxxxxx"
          value={record.shareUrl}
          onChange={(e) => handleShareUrlChange(record.studentId, e.target.value)}
        />
      ),
    },
  ];

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;

  return (
    <Card title="WPS 多维表格分配">
      <Alert
        type="info"
        showIcon
        message="请先在 WPS 中为每个考生创建空白多维表格，然后将分享链接粘贴到下方。"
        style={{ marginBottom: 16 }}
      />

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
                <TextArea
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
