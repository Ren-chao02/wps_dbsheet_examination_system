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
  ACTIVE: { color: 'green', text: '正常' },
  INACTIVE: { color: 'red', text: '禁用' },
  PENDING_APPROVAL: { color: 'orange', text: '待审批' },
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
      wpsId: account.wpsId,
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
          wpsId: values.wpsId || null,
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
          wpsId: values.wpsId || null,
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
      title: 'WPSID', dataIndex: 'wpsId', key: 'wpsId', width: 140,
      render: (v: string | null) => v || '—',
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
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'actions', width: 200,
      render: (_: any, r: Account) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm
            title={`确定重置 ${r.username} 的密码？`}
            onConfirm={() => handleResetPassword(r.id, r.username)}
          >
            <Button size="small" icon={<KeyOutlined />}>重置密码</Button>
          </Popconfirm>
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
          <Button icon={<ExportOutlined />} onClick={handleExport}>
            导出账户
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建账户
          </Button>
        </Space>
      </div>

      <Table
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={{
          current: data.page,
          total: data.total,
          pageSize: data.pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50'],
          onChange: (page, pageSize) => fetchAccounts(page, pageSize),
        }}
      />

      <Modal
        title={editingAccount ? '编辑账户' : '新建账户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {!editingAccount && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, min: 2 }]}>
                <Input placeholder="登录用户名" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, min: 6 }]}>
                <Input.Password placeholder="登录密码" />
              </Form.Item>
            </>
          )}
          <Form.Item name="realName" label="姓名">
            <Input placeholder="真实姓名" />
          </Form.Item>
          <Form.Item name="wpsId" label="WPSID (企业账号ID)">
            <Input placeholder="WPS 企业账号 ID" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="邮箱地址" />
          </Form.Item>
          <Form.Item name="role" label="账户角色" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'teacher', label: '教师' },
                { value: 'admin', label: '管理员' },
              ]}
            />
          </Form.Item>
          <Form.Item name="systemRoleId" label="系统角色（权限）">
            <Select
              allowClear
              placeholder="选择系统角色（可选）"
              options={roleOptions}
            />
          </Form.Item>
          {editingAccount && (
            <Form.Item name="accountStatus" label="状态">
              <Select
                options={[
                  { value: 'ACTIVE', label: '正常' },
                  { value: 'INACTIVE', label: '禁用' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
