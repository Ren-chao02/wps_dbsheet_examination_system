/**
 * 教师/管理员「给单个学生配置练习表格」弹窗。
 * - 粘贴该生练习表格分享链接（服务端从 /l/xxx 提取 fileId）
 * - access_token 留空时服务端复用系统 WPS Token（缓存管理 → WPS Token 管理）
 * 复用：学生管理列表、学生详情页
 */
import { useEffect, useState } from 'react';
import { Modal, Form, Input, Alert, message, Space, Button, Popconfirm, Spin } from 'antd';
import api from '../../services/api';

export interface PracticeFileStudent {
  id: string;
  realName?: string | null;
  username?: string;
}

interface Assignment {
  fileId: string;
  shareUrl: string | null;
  accessToken: string | null;
  updatedAt: string;
}

interface Props {
  student: PracticeFileStudent | null;
  open: boolean;
  onClose: () => void;
  /** 保存/清除成功后回调（用于刷新列表） */
  onSaved: () => void;
}

export function PracticeFileModal({ student, open, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);

  // 打开时拉取该生当前配置
  useEffect(() => {
    if (!open || !student) return;
    form.resetFields();
    setAssignment(null);
    setLoading(true);
    api
      .get<{ assignment: Assignment | null }>(`/students/${student.id}/practice-file`)
      .then((res) => {
        setAssignment(res.data.assignment);
        if (res.data.assignment) {
          form.setFieldsValue({
            shareUrl: res.data.assignment.shareUrl || '',
            accessToken: res.data.assignment.accessToken || '',
          });
        }
      })
      .catch(() => message.error('加载练习表格配置失败'))
      .finally(() => setLoading(false));
  }, [open, student, form]);

  const handleSave = async () => {
    if (!student) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.put(`/students/${student.id}/practice-file`, values);
      message.success('练习表格配置成功，该学生现在可以开始练习');
      onSaved();
      onClose();
    } catch (err: any) {
      if (err?.response?.data?.message) {
        message.error(err.response.data.message);
      }
      // 表单校验失败由 antd 就地提示，无需额外处理
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!student) return;
    try {
      await api.delete(`/students/${student.id}/practice-file`);
      message.success('已清除该学生的练习表格配置');
      onSaved();
      onClose();
    } catch {
      message.error('清除失败，请重试');
    }
  };

  const displayName = student?.realName || student?.username || '';

  return (
    <Modal
      title={student ? `配置练习表格 — ${displayName}` : '配置练习表格'}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      okText="保存配置"
      cancelText="关闭"
      width={620}
      destroyOnHidden
      footer={
        <Space>
          {assignment && !loading && (
            <Popconfirm title="确定清除该学生的练习表格配置？" onConfirm={handleClear} okText="确定" cancelText="取消">
              <Button danger disabled={saving}>清除配置</Button>
            </Popconfirm>
          )}
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>保存配置</Button>
        </Space>
      }
    >
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="操作步骤"
        description={
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            <li>为这位学生准备一份<b>独立</b>的多维表格副本并开启「分享」（每次练习/重练都会重置该文件内容，切勿多人共用同一份）；</li>
            <li>复制该表格的分享链接（形如 <code>https://www.kdocs.cn/l/xxxxxx</code>）粘贴到下方；</li>
            <li>access_token 可留空，默认使用「缓存管理 → WPS Token 管理」中配置的系统 Token。</li>
          </ol>
        }
      />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : (
        <>
          {assignment && (
            <div style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>
              当前文件 ID：{assignment.fileId} · 更新于{' '}
              {assignment.updatedAt ? new Date(assignment.updatedAt).toLocaleString() : '—'}
            </div>
          )}
          <Form form={form} layout="vertical">
            <Form.Item
              name="shareUrl"
              label="练习表格分享链接"
              rules={[{ required: true, message: '请粘贴分享链接' }]}
            >
              <Input placeholder="https://www.kdocs.cn/l/xxxxxx" />
            </Form.Item>
            <Form.Item
              name="accessToken"
              label="access_token（可选）"
              extra="留空则自动使用系统 WPS Token"
            >
              <Input placeholder="留空自动使用系统缓存的 WPS Token" />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
