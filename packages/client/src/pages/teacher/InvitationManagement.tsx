import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Tag, Space, Modal, Form, DatePicker, InputNumber,
  message, Tooltip, Card, Typography, Select, TreeSelect
} from 'antd';
import {
  PlusOutlined, CopyOutlined, StopOutlined, LinkOutlined
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import api from '../../services/api';
import { Invitation, Department } from '../../types';

const { Title } = Typography;

interface DeptTreeNode {
  title: string;
  value: string;
  selectable: boolean;
  children?: DeptTreeNode[];
}

function buildTreeData(departments: Department[]): DeptTreeNode[] {
  return departments.map((dept) => ({
    title: dept.name,
    value: `dept_${dept.id}`,
    selectable: false,
    children: (dept.majors || []).map((major) => ({
      title: major.name,
      value: `major_${major.id}`,
      selectable: false,
      children: (major.classRooms || []).map((cls) => ({
        title: cls.name,
        value: cls.id,
        selectable: true,
        children: undefined,
      })),
    })),
  }));
}

const statusConfig: Record<string, { color: string; text: string }> = {
  ACTIVE: { color: 'green', text: '有效' },
  EXPIRED: { color: 'default', text: '已过期' },
  DISABLED: { color: 'red', text: '已禁用' },
};

export default function InvitationManagement() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deptTree, setDeptTree] = useState<DeptTreeNode[]>([]);
  const [form] = Form.useForm();

  const fetchInvitations = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await api.get('/api/invitations', { params: { page: p, pageSize } });
      const d = res.data;
      setInvitations(d.data || d);
      setTotal(d.total || (d.data || d).length);
    } catch {
      message.error('加载邀请列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  const fetchDepts = async () => {
    try {
      const res = await api.get('/departments');
      const depts: Department[] = res.data.data;
      setDeptTree(buildTreeData(depts));
    } catch {
      message.error('加载院系数据失败');
    }
  };

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const handleOpenModal = () => {
    fetchDepts();
    form.resetFields();
    setModalOpen(true);
  };

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await api.post('/api/invitations', {
        classRoomId: values.classRoomId,
        expiresAt: values.expiresAt?.toISOString(),
        maxUses: values.maxUses ?? 0,
      });
      message.success('邀请创建成功');
      setModalOpen(false);
      fetchInvitations(1);
      setPage(1);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = (inv: Invitation) => {
    const link = `${window.location.origin}/join/${inv.code}`;
    navigator.clipboard.writeText(link).then(() => {
      message.success('链接已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败，请手动复制');
    });
  };

  const handleDisable = (inv: Invitation) => {
    Modal.confirm({
      title: '确认禁用',
      content: `确认禁用邀请码 ${inv.code}？禁用后该邀请链接将无法使用。`,
      okText: '确认禁用',
      okType: 'danger',
      onOk: async () => {
        try {
          await api.put(`/api/invitations/${inv.id}/disable`);
          message.success('已禁用');
          fetchInvitations();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '操作失败');
        }
      },
    });
  };

  const columns: ColumnsType<Invitation> = [
    {
      title: '邀请码',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => (
        <Typography.Text code copyable style={{ fontSize: 13 }}>{code}</Typography.Text>
      ),
    },
    {
      title: '关联班级',
      key: 'classRoom',
      render: (_, rec) => {
        const cls = rec.classRoom;
        if (!cls) return '-';
        const dept = cls.department?.name || '';
        const major = cls.major?.name || '';
        return (
          <Space direction="vertical" size={0}>
            <span style={{ fontWeight: 500 }}>{cls.name}</span>
            {(dept || major) && (
              <span style={{ color: '#888', fontSize: 12 }}>
                {[dept, major].filter(Boolean).join(' / ')}
              </span>
            )}
          </Space>
        );
      },
    },
    {
      title: '使用情况',
      key: 'uses',
      render: (_, rec) => (
        <span>
          {rec.usedCount} / {rec.maxUses === 0 ? '不限' : rec.maxUses}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const cfg = statusConfig[status] || { color: 'default', text: status };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '有效期',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, rec) => (
        <Space>
          <Tooltip title="复制邀请链接">
            <Button
              type="link"
              icon={<CopyOutlined />}
              size="small"
              onClick={() => handleCopy(rec)}
            >
              复制链接
            </Button>
          </Tooltip>
          {rec.status === 'ACTIVE' && (
            <Tooltip title="禁用邀请">
              <Button
                type="link"
                danger
                icon={<StopOutlined />}
                size="small"
                onClick={() => handleDisable(rec)}
              >
                禁用
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <Space>
            <LinkOutlined style={{ color: '#1677ff' }} />
            <Title level={4} style={{ margin: 0 }}>邀请管理</Title>
          </Space>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
            创建邀请
          </Button>
        }
        bodyStyle={{ padding: 0 }}
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={invitations}
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => { setPage(p); fetchInvitations(p); },
            showTotal: (t) => `共 ${t} 条`,
          }}
          style={{ padding: '0 16px' }}
        />
      </Card>

      <Modal
        title="创建邀请链接"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="classRoomId"
            label="选择班级"
            rules={[{ required: true, message: '请选择班级' }]}
          >
            <TreeSelect
              treeData={deptTree}
              placeholder="请选择班级（院系 > 专业 > 班级）"
              showSearch
              treeNodeFilterProp="title"
              style={{ width: '100%' }}
              dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
            />
          </Form.Item>

          <Form.Item
            name="expiresAt"
            label="有效期"
            rules={[{ required: true, message: '请设置有效期' }]}
          >
            <DatePicker
              showTime
              style={{ width: '100%' }}
              placeholder="选择过期时间"
              disabledDate={(d) => d && d.isBefore(dayjs(), 'day')}
            />
          </Form.Item>

          <Form.Item
            name="maxUses"
            label="最大使用次数"
            initialValue={0}
            extra="设置为 0 表示不限制使用次数"
          >
            <InputNumber min={0} style={{ width: '100%' }} placeholder="0 表示不限" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
