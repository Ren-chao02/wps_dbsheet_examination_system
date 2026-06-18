import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Select, Tag, message,
  Card, Popconfirm, Typography, Row, Col, Statistic, Descriptions, Empty
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined, InboxOutlined
} from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text } = Typography;

// ✅ 批次状态配置
const batchStatusConfig = {
  draft: { color: 'default', text: '草稿', icon: <FileTextOutlined /> },
  active: { color: 'processing', text: '进行中', icon: <ClockCircleOutlined /> },
  completed: { color: 'success', text: '已完成', icon: <CheckCircleOutlined /> },
  archived: { color: 'warning', text: '已归档', icon: <InboxOutlined /> },
};

interface ExamBatch {
  id: string;
  name: string;
  description?: string;
  examDuration: number;
  waitingTime: number;
  lateTolerance: number;
  status: 'draft' | 'active' | 'completed' | 'archived';
  settings: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; realName: string | null; username: string };
  _count: { exams: number };
  exams?: Array<{
    id: string;
    title: string;
    mode: string;
    status: string;
    paper?: { name: string };
    _count?: { submissions: number };
  }>;
}

export function BatchManager() {
  const [batches, setBatches] = useState<ExamBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<ExamBatch | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ExamBatch | null>(null);
  const [form] = Form.useForm();
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  // 加载批次列表
  const fetchBatches = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const res = await api.get('/batches', { params: { page, pageSize } });
      setBatches(res.data.data || []);
      setPagination({ current: res.data.page, pageSize: res.data.pageSize, total: res.data.total });
    } catch (err) {
      console.error('加载批次列表失败:', err);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  // 创建新批次
  const handleCreate = () => {
    setEditingBatch(null);
    form.resetFields();
    form.setFieldsValue({
      examDuration: 60,
      waitingTime: 10,
      lateTolerance: 15,
    });
    setModalOpen(true);
  };

  // 编辑批次
  const handleEdit = (batch: ExamBatch) => {
    setEditingBatch(batch);
    form.setFieldsValue(batch);
    setModalOpen(true);
  };

  // 查看详情
  const handleViewDetail = async (batch: ExamBatch) => {
    try {
      const res = await api.get(`/batches/${batch.id}`);
      setSelectedBatch(res.data);
      setDetailModalOpen(true);
    } catch (err) {
      message.error('加载详情失败');
    }
  };

  // 保存批次（创建或更新）
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingBatch) {
        await api.put(`/batches/${editingBatch.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/batches', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchBatches(pagination.current, pagination.pageSize);
    } catch (err: any) {
      if (err.response?.data?.message) {
        message.error(err.response.data.message);
      }
    }
  };

  // 删除批次
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/batches/${id}`);
      message.success('删除成功');
      fetchBatches(pagination.current, pagination.pageSize);
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // 更新状态
  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      await api.put(`/batches/${id}/status`, { status: newStatus });
      message.success('状态更新成功');
      fetchBatches(pagination.current, pagination.pageSize);
    } catch (err: any) {
      message.error(err.response?.data?.message || '更新失败');
    }
  };

  const columns = [
    {
      title: '批次名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <a onClick={() => {}}>{text}</a>,
    },
    {
      title: '考试时长',
      dataIndex: 'examDuration',
      key: 'examDuration',
      width: 100,
      render: (v: number) => `${v}分钟`,
    },
    {
      title: '候考时间',
      dataIndex: 'waitingTime',
      key: 'waitingTime',
      width: 100,
      render: (v: number) => `${v}分钟`,
    },
    {
      title: '迟到容忍',
      dataIndex: 'lateTolerance',
      key: 'lateTolerance',
      width: 100,
      render: (v: number) => `${v}分钟`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: keyof typeof batchStatusConfig) => {
        const config = batchStatusConfig[status];
        return (
          <Tag color={config.color} icon={config.icon}>
            {config.text}
          </Tag>
        );
      },
    },
    {
      title: '关联考试数',
      key: 'examCount',
      width: 120,
      render: (_: any, record: ExamBatch) => (
        <Tag color="blue">{record._count.exams} 场</Tag>
      ),
    },
    {
      title: '创建者',
      key: 'creator',
      width: 120,
      render: (_: any, record: ExamBatch) => record.creator.realName || record.creator.username,
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: any, record: ExamBatch) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            disabled={record.status === 'completed' || record.status === 'archived'}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该批次？"
            description="删除后不可恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.status !== 'draft'}
            >
              删除
            </Button>
          </Popconfirm>
          {record.status === 'draft' && (
            <Button
              size="small"
              type="primary"
              onClick={() => handleStatusChange(record.id, 'active')}
            >
              激活
            </Button>
          )}
          {record.status === 'active' && (
            <Button
              size="small"
              onClick={() => handleStatusChange(record.id, 'completed')}
            >
              完成
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container" style={{ maxWidth: 1400 }}>
      {/* 页面标题和操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>批次管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新建批次
        </Button>
      </div>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总批次数" value={pagination.total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="进行中"
              value={batches.filter(b => b.status === 'active').length}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已完成"
              value={batches.filter(b => b.status === 'completed').length}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="总考试数"
              value={batches.reduce((sum, b) => sum + b._count.exams, 0)}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 批次列表表格 */}
      <Table
        columns={columns}
        dataSource={batches}
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => fetchBatches(page, pageSize),
        }}
        scroll={{ x: 1200 }}
      />

      {/* 创建/编辑批次 Modal */}
      <Modal
        title={editingBatch ? '编辑批次' : '新建批次'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="批次名称" rules={[{ required: true, message: '请输入批次名称' }]}>
            <Input placeholder="如：2026春季期末考试、WPS实训考核" />
          </Form.Item>

          <Form.Item name="description" label="批次说明">
            <Input.TextArea rows={3} placeholder="可选，描述该批次的用途和范围" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="examDuration" label="考试时长（分钟）" rules={[{ required: true }]}>
                <InputNumber min={10} max={480} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="waitingTime" label="候考时间（分钟）">
                <InputNumber min={0} max={60} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lateTolerance" label="迟到容忍（分钟）">
                <InputNumber min={0} max={60} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: 4, marginBottom: 16 }}>
            <Text type="secondary">
              提示：批次中的所有考试将统一使用上述参数。创建批次后可在其中添加多场考试。
            </Text>
          </div>
        </Form>
      </Modal>

      {/* 批次详情 Modal */}
      <Modal
        title={`批次详情 - ${selectedBatch?.name}`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={800}
      >
        {selectedBatch && (
          <>
            <Descriptions bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="批次名称">{selectedBatch.name}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={batchStatusConfig[selectedBatch.status].color}>
                  {batchStatusConfig[selectedBatch.status].text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="考试时长">{selectedBatch.examDuration} 分钟</Descriptions.Item>
              <Descriptions.Item label="候考时间">{selectedBatch.waitingTime} 分钟</Descriptions.Item>
              <Descriptions.Item label="迟到容忍">{selectedBatch.lateTolerance} 分钟</Descriptions.Item>
              <Descriptions.Item label="创建者">
                {selectedBatch.creator.realName || selectedBatch.creator.username}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间" span={2}>
                {new Date(selectedBatch.createdAt).toLocaleString()}
              </Descriptions.Item>
              {selectedBatch.description && (
                <Descriptions.Item label="说明" span={2}>
                  {selectedBatch.description}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Title level={5}>关联考试列表 ({selectedBatch._count.exams})</Title>
            {selectedBatch.exams && selectedBatch.exams.length > 0 ? (
              <Table
                dataSource={selectedBatch.exams}
                rowKey="id"
                pagination={false}
                size="small"
                columns={[
                  { title: '考试名称', dataIndex: 'title' },
                  { title: '模式', dataIndex: 'mode', render: (v: string) => v },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (v: string) => <Tag>{v}</Tag>,
                  },
                  {
                    title: '提交数',
                    key: 'submissions',
                    render: (_: any, r: any) => r._count?.submissions || 0,
                  },
                  {
                    title: '试卷',
                    key: 'paper',
                    render: (_: any, r: any) => r.paper?.name || '-',
                  },
                ]}
              />
            ) : (
              <Empty description="暂无关联考试" />
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
