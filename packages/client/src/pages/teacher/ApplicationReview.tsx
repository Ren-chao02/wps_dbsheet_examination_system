import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Tag, Space, Modal, Form, Input, message,
  Tabs, Card, Typography, Popconfirm
} from 'antd';
import {
  CheckOutlined, CloseOutlined, TeamOutlined
} from '@ant-design/icons';
import type { ColumnsType, TableRowSelection } from 'antd/es/table/interface';
import dayjs from 'dayjs';
import api from '../../services/api';
import { StudentApplication } from '../../types';

const { Title } = Typography;
const { TextArea } = Input;

type AppStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

const statusConfig: Record<AppStatus, { color: string; text: string }> = {
  PENDING: { color: 'orange', text: '待审批' },
  APPROVED: { color: 'green', text: '已通过' },
  REJECTED: { color: 'red', text: '已拒绝' },
};

const genderMap: Record<string, string> = {
  MALE: '男',
  FEMALE: '女',
};

export default function ApplicationReview() {
  const [activeTab, setActiveTab] = useState<AppStatus>('PENDING');
  const [applications, setApplications] = useState<StudentApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  // 选中行
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  // 拒绝弹窗
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<StudentApplication | null>(null);
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectForm] = Form.useForm();

  // 批量通过
  const [batchLoading, setBatchLoading] = useState(false);

  const fetchApplications = useCallback(async (p = page, tab = activeTab) => {
    setLoading(true);
    try {
      const res = await api.get('/api/applications', {
        params: { status: tab, page: p, pageSize },
      });
      const d = res.data;
      setApplications(d.data || d);
      setTotal(d.total || (d.data || d).length);
    } catch {
      message.error('加载申请列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeTab]);

  useEffect(() => {
    setSelectedRowKeys([]);
    fetchApplications(1, activeTab);
    setPage(1);
  }, [activeTab]); // eslint-disable-line

  const handleApprove = async (app: StudentApplication) => {
    try {
      await api.put(`/api/applications/${app.id}/approve`);
      message.success('已通过申请');
      fetchApplications(page, activeTab);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  const openRejectModal = (app: StudentApplication) => {
    setRejectTarget(app);
    rejectForm.resetFields();
    setRejectModalOpen(true);
  };

  const handleReject = async () => {
    try {
      const values = await rejectForm.validateFields();
      if (!rejectTarget) return;
      setRejectLoading(true);
      await api.put(`/api/applications/${rejectTarget.id}/reject`, {
        rejectReason: values.rejectReason,
      });
      message.success('已拒绝申请');
      setRejectModalOpen(false);
      fetchApplications(page, activeTab);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '操作失败');
    } finally {
      setRejectLoading(false);
    }
  };

  const handleBatchApprove = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择申请记录');
      return;
    }
    setBatchLoading(true);
    try {
      await api.put('/api/applications/batch-approve', { ids: selectedRowKeys });
      message.success(`已批量通过 ${selectedRowKeys.length} 条申请`);
      setSelectedRowKeys([]);
      fetchApplications(page, activeTab);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '批量通过失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const rowSelection: TableRowSelection<StudentApplication> = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys as string[]),
    getCheckboxProps: () => ({ disabled: activeTab !== 'PENDING' }),
  };

  const columns: ColumnsType<StudentApplication> = [
    {
      title: '姓名',
      dataIndex: 'realName',
      key: 'realName',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '学号',
      dataIndex: 'studentId',
      key: 'studentId',
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      render: (v: string) => genderMap[v] || '-',
    },
    {
      title: '手机号',
      dataIndex: 'phoneNumber',
      key: 'phoneNumber',
      render: (v: string) => v || '-',
    },
    {
      title: '申请班级',
      key: 'classRoom',
      render: (_, rec) => {
        const cls = rec.invitation?.classRoom;
        if (!cls) return '-';
        const parts = [
          cls.department?.name,
          cls.major?.name,
          cls.name,
        ].filter(Boolean);
        return parts.join(' / ');
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: AppStatus) => {
        const cfg = statusConfig[s] || { color: 'default', text: s };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '申请时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, rec) => {
        if (activeTab !== 'PENDING') {
          if (rec.status === 'REJECTED' && rec.rejectReason) {
            return (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                拒绝原因：{rec.rejectReason}
              </Typography.Text>
            );
          }
          return null;
        }
        return (
          <Space>
            <Popconfirm
              title="确认通过此申请？"
              onConfirm={() => handleApprove(rec)}
              okText="通过"
              cancelText="取消"
            >
              <Button type="link" icon={<CheckOutlined />} size="small">
                通过
              </Button>
            </Popconfirm>
            <Button
              type="link"
              danger
              icon={<CloseOutlined />}
              size="small"
              onClick={() => openRejectModal(rec)}
            >
              拒绝
            </Button>
          </Space>
        );
      },
    },
  ];

  const tabItems = [
    { key: 'PENDING', label: `待审批` },
    { key: 'APPROVED', label: `已通过` },
    { key: 'REJECTED', label: `已拒绝` },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <Card
        title={
          <Space>
            <TeamOutlined style={{ color: '#1677ff' }} />
            <Title level={4} style={{ margin: 0 }}>申请审批</Title>
          </Space>
        }
        bodyStyle={{ padding: '0 0 16px' }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as AppStatus)}
          items={tabItems}
          style={{ padding: '0 16px' }}
          tabBarExtraContent={
            activeTab === 'PENDING' && (
              <Button
                type="primary"
                disabled={selectedRowKeys.length === 0}
                loading={batchLoading}
                icon={<CheckOutlined />}
                onClick={handleBatchApprove}
              >
                批量通过 {selectedRowKeys.length > 0 ? `(${selectedRowKeys.length})` : ''}
              </Button>
            )
          }
        />

        <div style={{ padding: '0 16px' }}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={applications}
            loading={loading}
            rowSelection={activeTab === 'PENDING' ? rowSelection : undefined}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p) => {
                setPage(p);
                fetchApplications(p, activeTab);
              },
              showTotal: (t) => `共 ${t} 条`,
            }}
          />
        </div>
      </Card>

      {/* 拒绝弹窗 */}
      <Modal
        title="拒绝申请"
        open={rejectModalOpen}
        onOk={handleReject}
        onCancel={() => setRejectModalOpen(false)}
        okText="确认拒绝"
        okType="danger"
        cancelText="取消"
        confirmLoading={rejectLoading}
        width={440}
      >
        {rejectTarget && (
          <div style={{ marginBottom: 16, color: '#555' }}>
            申请人：<strong>{rejectTarget.realName}</strong>（{rejectTarget.studentId}）
          </div>
        )}
        <Form form={rejectForm} layout="vertical">
          <Form.Item
            name="rejectReason"
            label="拒绝原因"
            rules={[{ required: true, message: '请填写拒绝原因' }]}
          >
            <TextArea
              rows={4}
              placeholder="请输入拒绝原因，将通知申请人"
              maxLength={200}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
