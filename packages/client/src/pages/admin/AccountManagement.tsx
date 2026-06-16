import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space,
  Popconfirm, message, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  ImportOutlined, ExportOutlined, KeyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import type { Account, SystemRole, PaginatedResponse } from '../../types';

const { Text } = Typography;

const statusMap: Record<string, { color: string; text: string }> = {
  ENABLED: { color: 'green', text: '启用' },
  DISABLED: { color: 'red', text: '禁用' },
};

const roleColorMap: Record<string, string> = {
  admin: 'red',
  teacher: 'blue',
  student: 'green',
};

export default function AccountManagement() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Account>>({
    data: [], total: 0, page: 1, pageSize: 20,
  });
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [form] = Form.useForm();

  const fetchAccounts = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const res = await api.get('/accounts', { params: { page, pageSize } });
      setData(res.data);
    } catch { message.error('加载账户列表失败'); }
    finally { setLoading(false); }
  };

  const fetchRoles = async () => {
    try {
      const res = await api.get('/roles');
      setRoles(res.data.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchAccounts(); fetchRoles(); }, []);

  const handleCreate = () => {
    setEditingAccount(null);
    form.resetFields();
    form.setFieldsValue({ role: 'teacher' });
    setModalOpen(true);
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    form.setFieldsValue({
      realName: account.realName,
      gender: account.gender,
      remark: account.remark,
      email: account.email,
      role: account.role,
      systemRoleId: account.systemRoleId,
      accountStatus: account.accountStatus,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingAccount) {
        await api.put(`/accounts/${editingAccount.id}`, {
          realName: values.realName,
          gender: values.gender || null,
          remark: values.remark || null,
          email: values.email || null,
          role: values.role,
          systemRoleId: values.systemRoleId || null,
          accountStatus: values.accountStatus,
        });
        message.success('更新成功');
      } else {
        await api.post('/accounts', {
          username: values.username,
          password: values.password,
          realName: values.realName,
          gender: values.gender || null,
          remark: values.remark || null,
          email: values.email || null,
          role: values.role,
          systemRoleId: values.systemRoleId || null,
        });
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchAccounts(data.page);
    } catch (err: any) {
      const msg = err.response?.data?.message || '操作失败';
      message.error(msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/accounts/${id}`);
      message.success('删除成功');
      fetchAccounts(data.page);
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const handleResetPassword = async (id: string, username: string) => {
    try {
      await api.put(`/accounts/reset-password/${id}`);
      message.success(`已重置 ${username} 的密码为默认密码`);
    } catch (err: any) {
      message.error(err.response?.data?.message || '重置失败');
    }
  };

  const handleToggleStatus = async (account: Account) => {
    try {
      if (account.accountStatus === 'ENABLED') {
        await api.put(`/accounts/${account.id}/disable`);
        message.success('账户已禁用');
      } else {
        await api.put(`/accounts/${account.id}/enable`);
        message.success('账户已启用');
      }
      fetchAccounts(data.page);
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  const handleExport = async () => {
    try {
      const response = await api.get('/accounts/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `账户列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch { message.error('导出失败'); }
  };

  const roleOptions = roles
    .filter((r) => r.status === 'ACTIVE')
    .map((r) => ({ value: r.id, label: `${r.roleName} (${r.roleCode})` }));

  const columns = [
    {
      title: '用户名', dataIndex: 'username', key: 'username', width: 120,
    },
    {
      title: '姓名', dataIndex: 'realName', key: 'realName', width: 100,
      render: (v: string | null) => v || '—',
    },
    {
      title: '性别', dataIndex: 'gender', key: 'gender', width: 80,
      render: (v: string | null) => {
        if (v === 'MALE') return '男';
        if (v === 'FEMALE') return '女';
        return '—';
      },
    },
    {
      title: '系统角色', dataIndex: 'systemRole', key: 'systemRole', width: 120,
      render: (v: { roleCode: string; roleName: string } | null) =>
        v ? <Tag color="blue">{v.roleName}</Tag> : '—',
    },
    {
      title: '角色', dataIndex: 'role', key: 'role', width: 80,
      render: (v: string) => (
        <Tag color={roleColorMap[v] || 'default'}>
          {v === 'admin' ? '管理员' : v === 'teacher' ? '教师' : '学生'}
        </Tag>
      ),
    },
    {
      title: '状态', dataIndex: 'accountStatus', key: 'accountStatus', width: 80,
      render: (v: string) => {
        const cfg = statusMap[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '备注', dataIndex: 'remark', key: 'remark', width: 120, ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'actions', width: 300,
      render: (_: any, r: Account) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm
            title={`确定重置 ${r.username} 的密码？`}
            onConfirm={() => handleResetPassword(r.id, r.username)}
          >
            <Button size="small" icon={<KeyOutlined />}>重置密码</Button>
          </Popconfirm>
          {r.accountStatus === 'ENABLED' ? (
            <Popconfirm
              title={`确定禁用账户 ${r.username}？`}
              onConfirm={() => handleToggleStatus(r)}
            >
              <Button size="small" danger>禁用</Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title={`确定启用账户 ${r.username}？`}
              onConfirm={() => handleToggleStatus(r)}
            >
              <Button size="small" style={{ color: '#52c41a', borderColor: '#52c41a' }}>启用</Button>
            </Popconfirm>
          )}
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
        <h2>账户管理</h2>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => navigate('/admin/accounts/import')}>
            批量导入
          </Button>
          <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增账户</Button>
        </Space>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        管理系统账户信息，支持创建、编辑、禁用/启用、重置密码和批量导入导出操作。
      </Text>

      <Table
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1300 }}
        pagination={{
          current: data.page,
          total: data.total,
          pageSize: data.pageSize,
          showSizeChanger: false,
          onChange: (page) => fetchAccounts(page),
        }}
      />

      {/* 创建/编辑 Modal */}
      <Modal
        title={editingAccount ? '编辑账户' : '新增账户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {!editingAccount && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2 }]}>
                <Input placeholder="登录用户名" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
                <Input.Password placeholder="至少6位" />
              </Form.Item>
            </>
          )}
          <Form.Item name="realName" label="姓名">
            <Input placeholder="真实姓名" />
          </Form.Item>
          <Form.Item name="gender" label="性别">
            <Select allowClear placeholder="请选择性别">
              <Select.Option value="MALE">男</Select.Option>
              <Select.Option value="FEMALE">女</Select.Option>
              <Select.Option value="UNSET">未设置</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
            <Input placeholder="电子邮箱" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" maxLength={512} />
          </Form.Item>
          <Form.Item name="role" label="角色类型" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="teacher">教师</Select.Option>
              <Select.Option value="admin">管理员</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="systemRoleId" label="系统角色">
            <Select allowClear placeholder="选择系统角色" options={roleOptions} />
          </Form.Item>
          {editingAccount && (
            <Form.Item name="accountStatus" label="状态">
              <Select>
                <Select.Option value="ENABLED">启用</Select.Option>
                <Select.Option value="DISABLED">禁用</Select.Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
