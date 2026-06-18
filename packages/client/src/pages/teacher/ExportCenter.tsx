/**
 * ✅ 统一数据导出中心 (Export Center)
 *
 * 功能特性：
 * - 一键导出多种数据（考试、成绩、日志等）
 * - 多格式支持（Excel/CSV/PDF）
 * - 预设模板快速选择
 * - 导出任务历史管理
 * - 异步任务进度追踪
 * - 批量清理过期文件
 */

import { useState, useEffect } from 'react';
import {
  Card, Table, Tag, Button, Select, Space, Row, Col,
  Modal, Form, Input, Progress, Typography, Empty, Spin,
  message, Tabs, Badge, Tooltip, Alert, Statistic, Divider,
  List, Avatar, Upload, Dropdown, Menu
} from 'antd';
import {
  DownloadOutlined, FileExcelOutlined, FileTextOutlined,
  FilePdfOutlined, HistoryOutlined, DeleteOutlined,
  ReloadOutlined, PlusOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ExclamationCircleOutlined,
  CloudDownloadOutlined, FilterOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';

const { Text, Title, Paragraph } = Typography;
const { TabPane } = Tabs;

// ✅ 格式配置（图标+颜色）
const FORMAT_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  excel: { label: 'Excel', icon: <FileExcelOutlined />, color: '#52c41a' },
  csv: { label: 'CSV', icon: <FileTextOutlined />, color: '#1890ff' },
  pdf: { label: 'PDF', icon: <FilePdfOutlined />, color: '#ff4d4f' },
};

// ✅ 实体类型配置
const ENTITY_CONFIG: Record<string, { label: string; description: string; icon?: React.ReactNode }> = {
  exam: { label: '考试列表', description: '所有考试的详细信息', icon: <FileTextOutlined /> },
  student: { label: '学生信息', description: '学生基本资料', icon: <UserOutlined /> },
  submission: { label: '成绩记录', description: '学生考试成绩明细', icon: <TrophyOutlined /> },
  behavior: { label: '行为日志', description: '考生行为追踪数据', icon: <EyeOutlined /> },
  audit: { label: '审计日志', description: '系统操作审计记录', icon: <SafetyCertificateOutlined /> },
  batch: { label: '批次管理', description: '考试批次配置', icon: <AppstoreOutlined /> },
  room: { label: '考场管理', description: '考场和座位分配', icon: <HomeOutlined /> },
};

// ✅ 任务状态配置
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '等待中', color: 'default', icon: <ClockCircleOutlined /> },
  processing: { label: '处理中', color: 'processing', icon: <ClockCircleOutlined /> },
  completed: { label: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: 'error', icon: <ExclamationCircleOutlined /> },
};

interface ExportTask {
  id: string;
  userId: string;
  entityType: string;
  entityId?: string;
  format: string;
  status: string;
  progress: number;
  error?: string;
  result?: {
    fileName: string;
    fileSize: number;
    recordCount: number;
    downloadUrl: string;
  };
  createdAt: string;
  completedAt?: string;
}

interface ExportTemplate {
  id: string;
  name: string;
  entityType: string;
  description: string;
  columns: Array<{ key: string; title: string }>;
}

export function ExportCenter() {
  const [activeTab, setActiveTab] = useState('quick');
  const [tasks, setTasks] = useState<ExportTask[]>([]);
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<ExportTemplate | null>(null);

  // 表单状态
  const [form] = Form.useForm();
  const [exporting, setExporting] = useState(false);

  // ✅ 加载导出任务历史
  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await api.get('/export/tasks');
      setTasks(res.data.data || []);
    } catch (err) {
      console.error('加载任务失败:', err);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  // ✅ 加载预设模板
  const fetchTemplates = async () => {
    try {
      const res = await api.get('/export/templates');
      setTemplates(res.data.data || []);
    } catch (err) {
      console.error('加载模板失败:', err);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchTemplates();
  }, []);

  // ✅ 触发导出
  const handleExport = async (values: any) => {
    try {
      setExporting(true);
      message.loading({ content: '正在生成导出文件...', duration: 0 });

      const payload = {
        entityType: values.entityType,
        format: values.format,
        options: {
          filename: values.filename || undefined,
          columns: selectedTemplate?.columns,
          async: false, // 同步模式，等待完成
        },
      };

      const res = await api.post('/export/trigger', payload);

      message.destroy();

      if (res.data.success && res.data.result) {
        message.success(`成功导出 ${res.data.result.recordCount} 条记录`);

        // 自动下载文件
        window.open(res.data.result.downloadUrl, '_blank');

        // 刷新任务列表
        fetchTasks();
        setExportModalOpen(false);
        form.resetFields();
      } else {
        message.error(res.data.error || '导出失败');
      }
    } catch (err: any) {
      console.error('导出失败:', err);
      message.error(err.response?.data?.error || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  // ✅ 使用模板快速导出
  const handleQuickExport = (template: ExportTemplate) => {
    setSelectedTemplate(template);
    form.setFieldsValue({
      entityType: template.entityType,
      filename: template.name,
    });
    setExportModalOpen(true);
  };

  // ✅ 下载文件
  const handleDownload = (task: ExportTask) => {
    if (task.result?.downloadUrl) {
      window.open(task.result.downloadUrl, '_blank');
    }
  };

  // ✅ 删除任务
  const handleDelete = async (taskId: string) => {
    try {
      await api.delete(`/export/tasks/${taskId}`);
      message.success('已删除');
      fetchTasks();
    } catch (err) {
      console.error('删除失败:', err);
      message.error('删除失败');
    }
  };

  // ✅ 清理过期任务
  const handleCleanup = async () => {
    Modal.confirm({
      title: '确认清理',
      content: '将删除24小时前的所有过期任务和文件，是否继续？',
      onOk: async () => {
        try {
          const res = await api.post('/export/cleanup');
          message.success(`已清理 ${res.data.deletedTasks} 个任务`);
          fetchTasks();
        } catch (err) {
          message.error('清理失败');
        }
      },
    });
  };

  // ✅ 文件大小格式化
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ✅ 任务表格列定义
  const taskColumns = [
    {
      title: '实体类型',
      dataIndex: 'entityType',
      key: 'entityType',
      width: 100,
      render: (type: string) => (
        <Tag>{ENTITY_CONFIG[type]?.label || type}</Tag>
      ),
    },
    {
      title: '格式',
      dataIndex: 'format',
      key: 'format',
      width: 80,
      render: (fmt: string) => {
        const config = FORMAT_CONFIG[fmt];
        return config ? (
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
        ) : fmt;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string, record: ExportTask) => {
        const config = STATUS_CONFIG[status];
        if (status === 'processing') {
          return <Progress percent={record.progress} size="small" style={{ width: 100 }} />;
        }
        return config ? (
          <Tag icon={config.icon} color={config.color}>
            {config.label}
          </Tag>
        ) : status;
      },
    },
    {
      title: '文件名',
      key: 'fileName',
      ellipsis: true,
      render: (_: any, record: ExportTask) =>
        record.result?.fileName || '-',
    },
    {
      title: '记录数',
      key: 'count',
      width: 90,
      render: (_: any, record: ExportTask) =>
        record.result?.recordCount ?? '-',
    },
    {
      title: '文件大小',
      key: 'size',
      width: 90,
      render: (_: any, record: ExportTask) =>
        record.result?.fileSize ? formatFileSize(record.result.fileSize) : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (time: string) => dayjs(time).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, record: ExportTask) => (
        <Space size="small">
          {record.status === 'completed' && record.result && (
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload(record)}
            >
              下载
            </Button>
          )}
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container" style={{ maxWidth: 1400 }}>
      {/* 页面头部 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <Title level={3}>数据导出中心</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchTasks}>
            刷新
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleCleanup}
          >
            清理过期
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setSelectedTemplate(null);
              setExportModalOpen(true);
            }}
          >
            新建导出
          </Button>
        </Space>
      </div>

      {/* ✅ Tab切换：快捷导出 / 任务历史 / 模板库 */}
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        {/* ── Tab1: 快捷导出 ── */}
        <TabPane tab={
          <span><CloudDownloadOutlined /> 快捷导出</span>
        } key="quick">
          <Row gutter={[16, 16]}>
            {templates.map(template => (
              <Col xs={24} sm={12} md={8} lg={6} key={template.id}>
                <Card
                  hoverable
                  size="small"
                  onClick={() => handleQuickExport(template)}
                  style={{
                    cursor: 'pointer',
                    borderLeft: `4px solid ${template.entityType === 'exam' ? '#1890ff' :
                      template.entityType === 'submission' ? '#52c41a' : '#722ed1'}`
                  }}
                >
                  <Card.Meta
                    avatar={
                      <Avatar
                        style={{
                          backgroundColor:
                            template.entityType === 'exam' ? '#1890ff' :
                            template.entityType === 'submission' ? '#52c41a' : '#722ed1'
                        }}
                        icon={ENTITY_CONFIG[template.entityType]?.icon || <FileTextOutlined />}
                      />
                    }
                    title={template.name}
                    description={
                      <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                        {template.description}
                        <br />
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {template.columns.length} 个字段
                        </Text>
                      </Paragraph>
                    }
                  />
                </Card>
              </Col>
            ))}
          </Row>
        </TabPane>

        {/* ── Tab2: 任务历史 ── */}
        <TabPane tab={
          <span>
            <Badge count={tasks.filter(t => t.status === 'processing').length} size="small">
              <HistoryOutlined />
            </Badge> 导出历史
          </span>
        } key="history">
          <Card>
            <Table
              dataSource={tasks}
              rowKey="id"
              columns={taskColumns}
              loading={loading}
              pagination={{
                pageSize: 10,
                showTotal: (total) => `共 ${total} 条`,
                showSizeChanger: true,
              }}
              scroll={{ x: 1200 }}
              size="middle"
              locale={{
                emptyText: <Empty description="暂无导出记录" />,
              }}
            />
          </Card>
        </TabPane>

        {/* ── Tab3: 模板库 ── */}
        <TabPane tab={
          <span><AppstoreOutlined /> 模板库</span>
        } key="templates">
          <List
            grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4 }}
            dataSource={templates}
            renderItem={item => (
              <List.Item>
                <Card
                  size="small"
                  title={item.name}
                  extra={
                    <Button
                      type="link"
                      size="small"
                      onClick={() => handleQuickExport(item)}
                    >
                      使用模板
                    </Button>
                  }
                >
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary">{item.description}</Text>
                  </div>
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ maxHeight: 120, overflow: 'auto' }}>
                    {item.columns.map((col, idx) => (
                      <Tag key={idx} style={{ margin: '2px' }}>{col.title}</Tag>
                    ))}
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
      </Tabs>

      {/* ✅ 新建导出弹窗 */}
      <Modal
        title="新建导出任务"
        open={exportModalOpen}
        onCancel={() => {
          setExportModalOpen(false);
          form.resetFields();
        }}
        footer={null}
        width={600}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleExport}
          initialValues={{
            format: 'excel',
            entityType: selectedTemplate?.entityType || 'exam',
            filename: selectedTemplate?.name || '',
          }}
        >
          <Form.Item
            name="entityType"
            label="导出内容"
            rules={[{ required: true, message: '请选择要导出的内容' }]}
          >
            <Select placeholder="请选择实体类型">
              {Object.entries(ENTITY_CONFIG).map(([key, cfg]) => (
                <Select.Option key={key} value={key}>
                  {cfg.label} - {cfg.description}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="format"
            label="导出格式"
            rules={[{ required: true, message: '请选择格式' }]}
          >
            <Select placeholder="请选择格式">
              {Object.entries(FORMAT_CONFIG).map(([key, cfg]) => (
                <Select.Option key={key} value={key}>
                  <Space>
                    {cfg.icon} {cfg.label}
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="filename"
            label="文件名称"
            extra="可选，留空则自动生成"
          >
            <Input placeholder="如：2026春季期末考试成绩" />
          </Form.Item>

          {selectedTemplate && (
            <Alert
              type="info"
              showIcon
              message={`已选择模板: ${selectedTemplate.name}`}
              description={`包含 ${selectedTemplate.columns.length} 个字段`}
              style={{ marginBottom: 16 }}
            />
          )}

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<DownloadOutlined />}
                loading={exporting}
              >
                开始导出
              </Button>
              <Button onClick={() => setExportModalOpen(false)}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// ✅ 补充缺失的图标导入
import { UserOutlined, TrophyOutlined, EyeOutlined, SafetyCertificateOutlined, AppstoreOutlined, HomeOutlined } from '@ant-design/icons';
