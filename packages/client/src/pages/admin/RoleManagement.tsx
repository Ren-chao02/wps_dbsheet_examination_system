import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space,
  Popconfirm, message, Checkbox, Drawer, Descriptions, Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { SystemRole, SystemModule } from '../../types';

const { Text } = Typography;

const statusMap: Record<string, { color: string; text: string }> = {
  ACTIVE: { color: 'green', text: '启用' },
  DISABLED: { color: 'red', text: '禁用' },
};

const roleTypeMap: Record<string, { color: string; text: string }> = {
  preset: { color: 'blue', text: '预设' },
  custom: { color: 'orange', text: '自定义' },
};

export default function RoleManagement() {
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [modules, setModules] = useState<SystemModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<SystemRole | null>(null);
  const [viewingRole, setViewingRole] = useState<SystemRole | null>(null);
  const [form] = Form.useForm();

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await api.get('/roles');
      setRoles(res.data.data);
    } catch { message.error('加载角色列表失败'); }
    finally { setLoading(false); }
  };

  const fetchModules = async () => {
    try {
      const res = await api.get('/roles/modules');
      setModules(res.data.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchRoles(); fetchModules(); }, []);

  const handleCreate = () => {
    setEditingRole(null);
    form.resetFields();
    form.setFieldsValue({ permissions: [], status: 'ACTIVE' });
    setModalOpen(true);
  };

  const handleEdit = (role: SystemRole) => {
    setEditingRole(role);
    form.setFieldsValue({
      roleName: role.roleName,
      description: role.description,
      status: role.status,
      permissions: role.permissions,
    });
    setModalOpen(true);
  };

  const handleView = (role: SystemRole) => {
    setViewingRole(role);
    setDrawerOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRole) {
        await api.put(`/roles/${editingRole.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/roles', { ...values, roleCode: values.roleCode });
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchRoles();
    } catch (err: any) {
      const msg = err.response?.data?.message || '操作失败';
      message.error(msg);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/roles/${id}`);
      message.success('删除成功');
      fetchRoles();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const moduleNameMap = modules.reduce<Record<string, string>>((acc, m) => {
    acc[m.code] = m.name;
    return acc;
  }, {});

  const columns = [
    { title: '角色编码', dataIndex: 'roleCode', key: 'roleCode', width: 120 },
    {
      title: '角色属性', dataIndex: 'roleType', key: 'roleType', width: 90,
      render: (v: string) => {
        const cfg = roleTypeMap[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    { title: '角色名称', dataIndex: 'roleName', key: 'roleName', width: 140 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (v: string) => {
        const cfg = statusMap[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '用户数', dataIndex: 'userCount', key: 'userCount', width: 80, align: 'center' as const,
    },
    { title: '备注', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 160,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作', key: 'actions', width: 160,
      render: (_: any, r: SystemRole) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(r)}>详情</Button>
          {r.roleType === 'custom' && (
            <>
              <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
              <Popconfirm
                title="确定删除该角色？"
                description="删除后不可恢复"
                onConfirm={() => handleDelete(r.id)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const permissionOptions = modules.map((m) => ({
    label: `${m.name} (${m.code})`,
    value: m.code,
  }));

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>角色权限管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新建角色</Button>
      </div>

      <Table
        dataSource={roles}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
      />

      {/* 创建/编辑 Modal */}
      <Modal
        title={editingRole ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          {!editingRole && (
            <Form.Item
              name="roleCode"
              label="角色编码"
              rules={[
                { required: true, message: '请输入角色编码' },
                { pattern: /^[A-Z_0-9]+$/, message: '只允许大写字母、数字和下划线' },
              ]}
            >
              <Input placeholder="例如: TEACHER_ADVANCED" />
            </Form.Item>
          )}
          <Form.Item name="roleName" label="角色名称" rules={[{ required: true, min: 2 }]}>
            <Input placeholder="例如: 高级教师" />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'ACTIVE', label: '启用' },
                { value: 'DISABLED', label: '禁用' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="permissions"
            label="模块权限"
            rules={[{ required: true, message: '请至少选择一个权限模块' }]}
          >
            <Checkbox.Group options={permissionOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 角色详情 Drawer */}
      <Drawer
        title="角色详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
      >
        {viewingRole && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="角色编码">{viewingRole.roleCode}</Descriptions.Item>
            <Descriptions.Item label="角色名称">{viewingRole.roleName}</Descriptions.Item>
            <Descriptions.Item label="角色属性">
              <Tag color={roleTypeMap[viewingRole.roleType]?.color}>
                {roleTypeMap[viewingRole.roleType]?.text}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusMap[viewingRole.status]?.color}>
                {statusMap[viewingRole.status]?.text}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="用户数">{viewingRole.userCount ?? 0}</Descriptions.Item>
            <Descriptions.Item label="备注">{viewingRole.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(viewingRole.createdAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {new Date(viewingRole.updatedAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="模块权限">
              <Space wrap>
                {viewingRole.permissions.length > 0
                  ? viewingRole.permissions.map((code) => (
                    <Tag key={code} color="blue">{moduleNameMap[code] || code}</Tag>
                  ))
                  : <Text type="secondary">无权限</Text>
                }
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
