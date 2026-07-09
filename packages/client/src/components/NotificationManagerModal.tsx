import { useState, useEffect } from 'react';
import { Modal, Tabs, Form, Select, Input, Button, Table, message, Tag, Space, Popconfirm, Empty } from 'antd';
import { SendOutlined, HistoryOutlined, FileTextOutlined } from '@ant-design/icons';
import api from '../services/api';
import type { User } from '../types';

interface NotificationManagerProps {
  open: boolean;
  onClose: () => void;
  role: 'admin' | 'teacher';
}

interface NotificationTemplate {
  id: string;
  name: string;
  type: string;
  title: string;
  content?: string;
}

interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  content?: string;
  isRead: boolean;
  createdAt: string;
}

interface ClassRoomInfo {
  id: string;
  name: string;
  code: string;
  major?: { name: string };
  _count?: { students: number };
  studentCount?: number;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  SYSTEM: { label: '系统公告', color: '#1890ff' },
  EXAM: { label: '考试通知', color: '#1677ff' },
  GRADE: { label: '成绩发布', color: '#52c41a' },
  ALERT: { label: '告警提醒', color: '#ff4d4f' },
  AUDIT: { label: '审计通知', color: '#faad14' },
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};

export function NotificationManagerModal({ open, onClose, role }: NotificationManagerProps) {
  const isAdmin = role === 'admin';

  return (
    <Modal
      title="通知管理"
      open={open}
      onCancel={onClose}
      width={760}
      footer={null}
      destroyOnClose
    >
      <Tabs
        items={[
          {
            key: 'send',
            label: <span><SendOutlined /> 发送通知</span>,
            children: <SendTab role={role} />,
          },
          {
            key: 'history',
            label: <span><HistoryOutlined /> 发送历史</span>,
            children: <HistoryTab role={role} />,
          },
          ...(isAdmin
            ? [{
                key: 'templates',
                label: <span><FileTextOutlined /> 模板管理</span>,
                children: <TemplatesTab />,
              }]
            : []),
        ]}
      />
    </Modal>
  );
}

// ========== Tab 1: 发送通知 ==========

function SendTab({ role }: { role: string }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [classRooms, setClassRooms] = useState<ClassRoomInfo[]>([]);
  const [classLoading, setClassLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isAdmin = role === 'admin';

  useEffect(() => {
    fetchTemplates();
    fetchClassRooms();
  }, []);

  const fetchTemplates = async () => {
    try {
      const res = await api.get('/notifications/templates');
      setTemplates(res.data.data);
    } catch { /* ignore */ }
  };

  const fetchClassRooms = async () => {
    setClassLoading(true);
    try {
      const res = await api.get('/departments');
      const depts = res.data.data || [];
      // 从院系结构中提取所有班级
      const rooms: ClassRoomInfo[] = [];
      for (const dept of depts) {
        for (const major of dept.majors || []) {
          for (const room of major.classRooms || []) {
            rooms.push({
              ...room,
              studentCount: room.studentCount || room._count?.students || 0,
            });
          }
        }
      }
      setClassRooms(rooms);
    } catch {
      setClassRooms([]);
    } finally {
      setClassLoading(false);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId);
    if (tpl) {
      form.setFieldsValue({
        type: tpl.type,
        title: tpl.title,
        content: tpl.content,
      });
    }
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      await api.post('/notifications/send', {
        classRoomIds: values.classRoomIds || [],
        userIds: values.userIds || undefined,
        type: values.type,
        priority: values.priority || 'MEDIUM',
        title: values.title,
        content: values.content,
        actionUrl: values.actionUrl || undefined,
        entityType: values.entityType || undefined,
        entityId: values.entityId || undefined,
      });
      message.success('通知发送成功');
      form.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.error || '发送失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={onFinish}>
      <Space style={{ width: '100%' }} size="middle">
        <Form.Item label="通知类型" name="type" rules={[{ required: true }]} style={{ flex: 1 }}>
          <Select
            options={
              !isAdmin
                ? [{ value: 'EXAM', label: '考试通知' }]
                : Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v.label }))
            }
            placeholder="选择通知类型"
          />
        </Form.Item>
        <Form.Item label="优先级" name="priority" initialValue="MEDIUM" style={{ flex: 1 }}>
          <Select
            options={Object.entries(PRIORITY_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          />
        </Form.Item>
      </Space>

      <Form.Item label="使用模板">
        <Select
          allowClear
          placeholder="选择模板快速填充"
          options={templates.map((t) => ({ value: t.id, label: t.name }))}
          onChange={(val) => val && handleTemplateSelect(val)}
        />
      </Form.Item>

      <Form.Item label="接收班级" name="classRoomIds" rules={[{ required: true, message: '请选择至少一个班级' }]}>
        <Select
          mode="multiple"
          placeholder="选择要通知的班级"
          loading={classLoading}
          options={classRooms.map((r) => ({
            value: r.id,
            label: `${r.name} (${r.code}) · ${r.studentCount ?? 0} 名学生`,
          }))}
        />
      </Form.Item>

      <Form.Item label="标题" name="title" rules={[{ required: true, max: 256 }]}>
        <Input placeholder="通知标题" maxLength={256} />
      </Form.Item>

      <Form.Item label="内容" name="content">
        <Input.TextArea rows={3} placeholder="通知内容（可选）" maxLength={2000} />
      </Form.Item>

      <Button type="link" size="small" onClick={() => setShowAdvanced(!showAdvanced)} style={{ padding: 0, marginBottom: showAdvanced ? 12 : 0 }}>
        {showAdvanced ? '▸ 收起高级选项' : '▸ 高级选项'}
      </Button>
      {showAdvanced && (
        <>
          <Form.Item label="跳转链接" name="actionUrl">
            <Input placeholder="可选 URL，点击通知后跳转" />
          </Form.Item>
          <Form.Item label="关联实体ID" name="entityId">
            <Input placeholder="可选，如考试ID" />
          </Form.Item>
        </>
      )}

      <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
        <Button type="primary" htmlType="submit" loading={loading} icon={<SendOutlined />}>
          发送通知
        </Button>
      </Form.Item>
    </Form>
  );
}

// ========== Tab 2: 发送历史 ==========

function HistoryTab({ role }: { role: string }) {
  const isTeacher = role === 'teacher';
  const [data, setData] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(payload.userId || payload.id);
      } catch {}
    }
  }, []);

  const fetchHistory = async (page = 1) => {
    if (!currentUserId) return; // userId 未就绪时不请求
    setLoading(true);
    try {
      const res = await api.get('/notifications', {
        params: {
          page,
          pageSize: pagination.pageSize,
          type: isTeacher ? 'EXAM' : undefined,
          senderId: currentUserId,
        },
      });
      setData(res.data.data);
      setPagination((prev) => ({
        ...prev,
        current: page,
        total: res.data.pagination?.total || 0,
      }));
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(1);
  }, [currentUserId]);

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (t: string) => {
        const cfg = TYPE_LABELS[t] || { label: t, color: '#999' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '内容', dataIndex: 'content', ellipsis: true, width: 200 },
    {
      title: '状态',
      dataIndex: 'isRead',
      width: 80,
      render: (v: boolean) => (v ? <Tag color="green">已读</Tag> : <Tag>未读</Tag>),
    },
    {
      title: '发送时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          ...pagination,
          onChange: (page) => fetchHistory(page),
        }}
        size="small"
      />
    </div>
  );
}

// ========== Tab 3: 模板管理（仅管理员） ==========

function TemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [form] = Form.useForm();

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const res = await api.get('/notifications/templates');
      setTemplates(res.data.data);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEditModal(true);
  };

  const openEdit = (record: NotificationTemplate) => {
    setEditing(record);
    form.setFieldsValue(record);
    setEditModal(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await api.put(`/notifications/templates/${editing.id}`, values);
        message.success('模板已更新');
      } else {
        await api.post('/notifications/templates', values);
        message.success('模板已创建');
      }
      setEditModal(false);
      fetchTemplates();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error('操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/notifications/templates/${id}`);
      message.success('模板已删除');
      fetchTemplates();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: '模板名称', dataIndex: 'name', width: 150 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (t: string) => {
        const cfg = TYPE_LABELS[t] || { label: t, color: '#999' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 140,
      render: (_: any, record: NotificationTemplate) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Button type="primary" onClick={openCreate} style={{ marginBottom: 16 }}>
        新建模板
      </Button>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={templates}
        loading={loading}
        size="small"
        pagination={false}
      />

      <Modal
        title={editing ? '编辑模板' : '新建模板'}
        open={editModal}
        onCancel={() => setEditModal(false)}
        onOk={handleSave}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="模板名称" rules={[{ required: true }]}>
            <Input placeholder="如：考试开始提醒" maxLength={128} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v.label }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input placeholder="通知标题" maxLength={256} />
          </Form.Item>
          <Form.Item name="content" label="内容">
            <Input.TextArea rows={3} placeholder="通知内容（可选）" maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
