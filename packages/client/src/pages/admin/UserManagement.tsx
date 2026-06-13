import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { User, PaginatedResponse } from '../../types';

const roleMap: Record<string, { color: string; text: string }> = {
  admin: { color: 'red', text: '管理员' },
  teacher: { color: 'blue', text: '教师' },
  student: { color: 'green', text: '学生' },
};

export function UserManagement() {
  const [data, setData] = useState<PaginatedResponse<User>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form] = Form.useForm();

  const fetchUsers = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get(`/users?page=${page}&pageSize=20`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleCreate = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'student' });
    setModalOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    form.setFieldsValue({ realName: user.realName, email: user.email, role: user.role });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/users', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/users/${id}`); message.success('删除成功'); fetchUsers(); }
    catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const columns = [
    { title: '用户名', dataIndex: 'username', key: 'username' },
    { title: '姓名', dataIndex: 'realName', key: 'realName', render: (v: string | null) => v || '—' },
    { title: '邮箱', dataIndex: 'email', key: 'email', render: (v: string | null) => v || '—' },
    { title: '角色', dataIndex: 'role', key: 'role', render: (v: string) => { const r = roleMap[v] || { color: 'default', text: v }; return <Tag color={r.color}>{r.text}</Tag>; } },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', render: (v: string) => new Date(v).toLocaleDateString('zh-CN') },
    {
      title: '操作', key: 'actions', width: 120, render: (_: any, r: User) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>用户管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建用户</Button>
      </div>

      <Table dataSource={data.data} columns={columns} rowKey="id" loading={loading} pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchUsers }} />

      <Modal
        title={editingUser ? '编辑用户' : '新建用户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          {!editingUser && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Form.Item name="realName" label="真实姓名">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={[
              { value: 'student', label: '学生' },
              { value: 'teacher', label: '教师' },
              { value: 'admin', label: '管理员' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
