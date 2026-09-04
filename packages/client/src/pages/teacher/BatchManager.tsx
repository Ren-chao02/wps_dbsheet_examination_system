import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Select, Tag, message,
  Card, Popconfirm, Typography, Row, Col, Statistic, Descriptions, Empty, Radio,
  Switch, DatePicker, Divider
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined, InboxOutlined,
  SendOutlined, RollbackOutlined, FieldTimeOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';

const { Title, Text } = Typography;

// 批次状态配置
const batchStatusConfig = {
  draft: { color: 'default', text: '规划中', icon: <FileTextOutlined /> },
  active: { color: 'processing', text: '已上线', icon: <ClockCircleOutlined /> },
  completed: { color: 'success', text: '已完成', icon: <CheckCircleOutlined /> },
  archived: { color: 'warning', text: '已归档', icon: <InboxOutlined /> },
};

const examModeMap = {
  unified: '集中统一',
  flexible: '随到随考',
};

// 新建批次默认考试须知（与考生端 ExamEntrySteps 的兜底规则保持一致）
const DEFAULT_RULES_CONTENT = `考场开放
1. 各科考试考场开放时间（包括考场开放开始时间及考场入口关闭时间）将公布在"多维表格考试系统-首页-我的待考科目"中；
2. 考场开放后考生可以登录并进入相应考场，请考生务必在考场入口关闭前进入考场，并完成考生信息确认、阅读考规（每次重新进入考场时均需重新完成信息确认等工作），完成后保持登录状态等候考试开始；
3. 考场入口：多维表格考试系统 - 我的考试；
4. 若系统界面显示过小/过大（如"下一步"等按钮未显示出等），请前往电脑的显示设置-屏幕中，调整缩放比例/显示器分辨率至合适值；
5. 相应科目的考场入口关闭后，未按照本条第2款的约定完成相应考前工作的考生不得再进入考场。

考试纪律
1. 考生应本人参加考试，严禁由他人替代考试或替代他人考试；
2. 考试过程中，考生不得离开考试页面、切换屏幕、打开其他软件或网页，不得查阅资料、使用通讯工具或接受他人协助；
3. 考生须在规定时间内完成答卷，考试时间结束后系统将自动提交；
4. 考生须在指定的 WPS 多维表格中进行操作，所有作答将被系统自动记录并评分；
5. 考生应自觉遵守考场纪律，服从监考人员管理，违者将按相关规定处理。`;

const exitPolicyMap = {
  finite: '有限续考',
  unlimited: '无限续考',
  none: '不可续考',
};

interface ExamBatch {
  id: string;
  name: string;
  description?: string;
  examMode: 'unified' | 'flexible';
  startTime?: string;
  endTime?: string;
  examDuration: number;
  waitingTime: number;
  lateTolerance: number;
  ipLimitEnabled: boolean;
  allowedIps: string[];
  freezeMinutes: number;
  exitPolicy: 'finite' | 'unlimited' | 'none';
  exitMaxCount: number;
  exitMaxMinutes: number;
  rulesContent?: string;
  rulesReadSeconds: number;
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
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [extendingBatch, setExtendingBatch] = useState<ExamBatch | null>(null);
  const [editingBatch, setEditingBatch] = useState<ExamBatch | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ExamBatch | null>(null);
  const [form] = Form.useForm();
  const [extendForm] = Form.useForm();
  const exitPolicy = Form.useWatch('exitPolicy', form);
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
      examMode: 'unified',
      examDuration: 60,
      waitingTime: 15,
      lateTolerance: 30,
      ipLimitEnabled: false,
      allowedIps: [],
      freezeMinutes: 30,
      exitPolicy: 'finite',
      exitMaxCount: 10,
      exitMaxMinutes: 20,
      rulesContent: DEFAULT_RULES_CONTENT,
      rulesReadSeconds: 15,
    });
    setModalOpen(true);
  };

  // 编辑批次
  const handleEdit = (batch: ExamBatch) => {
    setEditingBatch(batch);
    form.setFieldsValue({
      name: batch.name,
      description: batch.description,
      examMode: batch.examMode,
      startTime: batch.startTime ? dayjs(batch.startTime) : null,
      endTime: batch.endTime ? dayjs(batch.endTime) : null,
      examDuration: batch.examDuration,
      waitingTime: batch.waitingTime,
      lateTolerance: batch.lateTolerance,
      ipLimitEnabled: batch.ipLimitEnabled,
      allowedIps: batch.allowedIps || [],
      freezeMinutes: batch.freezeMinutes,
      exitPolicy: batch.exitPolicy,
      exitMaxCount: batch.exitMaxCount,
      exitMaxMinutes: batch.exitMaxMinutes,
      rulesContent: batch.rulesContent,
      rulesReadSeconds: batch.rulesReadSeconds,
    });
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
      const cleanValues = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== null),
      );
      const payload = {
        ...cleanValues,
        startTime: values.startTime ? values.startTime.toISOString() : undefined,
        endTime: values.endTime ? values.endTime.toISOString() : undefined,
      };

      if (editingBatch) {
        await api.put(`/batches/${editingBatch.id}`, payload);
        message.success('更新成功');
      } else {
        await api.post('/batches', payload);
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

  // 发布/上线批次（激活 + 级联发布子考试）
  const handleActivate = async (id: string) => {
    try {
      const res = await api.put(`/batches/${id}/status`, { status: 'active' });
      const cascadeCount = res.data.cascadePublished;
      if (cascadeCount > 0) {
        message.success(`批次已上线，同时级联发布了 ${cascadeCount} 场已准备好的考试`);
      } else {
        message.success('批次已上线');
      }
      fetchBatches(pagination.current, pagination.pageSize);
    } catch (err: any) {
      message.error(err.response?.data?.message || '上线失败');
    }
  };

  // 下线批次
  const handleDeactivate = async (id: string) => {
    try {
      const res = await api.post(`/batches/${id}/deactivate`);
      const revertedCount = res.data.revertedExams;
      if (revertedCount > 0) {
        message.success(`批次已下线，同时撤回了 ${revertedCount} 场已发布的考试`);
      } else {
        message.success('批次已下线');
      }
      fetchBatches(pagination.current, pagination.pageSize);
    } catch (err: any) {
      message.error(err.response?.data?.message || '下线失败');
    }
  };

  // 打开延期弹窗
  const handleOpenExtend = (batch: ExamBatch) => {
    setExtendingBatch(batch);
    extendForm.resetFields();
    extendForm.setFieldsValue({
      endTime: batch.endTime ? dayjs(batch.endTime) : null,
    });
    setExtendModalOpen(true);
  };

  // 确认延期
  const handleExtend = async () => {
    try {
      const values = await extendForm.validateFields();
      if (!extendingBatch) return;
      await api.post(`/batches/${extendingBatch.id}/extend`, {
        endTime: values.endTime.toISOString(),
      });
      message.success('批次已延期');
      setExtendModalOpen(false);
      fetchBatches(pagination.current, pagination.pageSize);
    } catch (err: any) {
      if (err.response?.data?.message) {
        message.error(err.response.data.message);
      }
    }
  };

  const columns = [
    {
      title: '批次名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: ExamBatch) => (
        <a onClick={() => handleViewDetail(record)}>{text}</a>
      ),
    },
    {
      title: '考试模式',
      dataIndex: 'examMode',
      key: 'examMode',
      width: 110,
      render: (v: keyof typeof examModeMap) => examModeMap[v] || v,
    },
    {
      title: '批次时间',
      key: 'batchTime',
      width: 180,
      render: (_: any, record: ExamBatch) => {
        if (!record.startTime || !record.endTime) return '-';
        return `${dayjs(record.startTime).format('MM-DD HH:mm')} ~ ${dayjs(record.endTime).format('MM-DD HH:mm')}`;
      },
    },
    {
      title: '考试时长',
      dataIndex: 'examDuration',
      key: 'examDuration',
      width: 100,
      render: (v: number) => `${v}分钟`,
    },
    {
      title: '候考/迟到',
      key: 'waitingLate',
      width: 140,
      render: (_: any, record: ExamBatch) =>
        record.examMode === 'flexible' ? '-' : `${record.waitingTime}/${record.lateTolerance} 分钟`,
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
      width: 320,
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

          {/* 状态驱动主按钮 */}
          {record.status === 'draft' && (
            <Popconfirm
              title="确认上线批次？"
              description="上线后将自动发布批次下已准备好的考试"
              onConfirm={() => handleActivate(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" type="primary" icon={<SendOutlined />}>
                发布/上线批次
              </Button>
            </Popconfirm>
          )}
          {record.status === 'active' && (
            <>
              <Button size="small" icon={<FieldTimeOutlined />} onClick={() => handleOpenExtend(record)}>
                批次延期
              </Button>
              <Popconfirm
                title="确认下线批次？"
                description="下线后将撤回已发布的考试，进行中的考试不受影响"
                onConfirm={() => handleDeactivate(record.id)}
                okText="确定下线"
                cancelText="取消"
              >
                <Button size="small" danger icon={<RollbackOutlined />}>
                  下线批次
                </Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  const renderFormSection = (title: string, children: React.ReactNode) => (
    <div style={{ marginBottom: 24 }}>
      <Divider titlePlacement="left" style={{ marginTop: 0, marginBottom: 16 }}>
        <Text strong>{title}</Text>
      </Divider>
      {children}
    </div>
  );

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
              valueStyle={{ color: '#1677ff' }}
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
        scroll={{ x: 1400 }}
      />

      {/* 创建/编辑批次 Modal */}
      <Modal
        title={editingBatch ? '编辑批次' : '新建批次'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={720}
        destroyOnHidden
        styles={{ body: { maxHeight: 'calc(100vh - 240px)', overflow: 'auto', paddingRight: 8 } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {renderFormSection('基础信息', (
            <>
              <Form.Item name="name" label="批次名称" rules={[{ required: true, message: '请输入批次名称' }]}>
                <Input placeholder="如：2026春季期末考试、WPS实训考核" />
              </Form.Item>

              <Form.Item name="description" label="批次说明">
                <Input.TextArea rows={2} placeholder="可选，描述该批次的用途和范围" />
              </Form.Item>

              <Form.Item
                name="examMode"
                label="考试模式"
                rules={[{ required: true, message: '请选择考试模式' }]}
              >
                <Radio.Group>
                  <Radio value="unified">集中统一</Radio>
                  <Radio value="flexible">随到随考</Radio>
                </Radio.Group>
              </Form.Item>
              <div style={{ marginTop: -12, marginBottom: 16, color: '#888', fontSize: 12 }}>
                选择"集中统一"后，考生需在设置的场次时间内进行考试；确认后不可修改。
              </div>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="startTime" label="周期开始" rules={[{ required: true, message: '请选择开始时间' }]}>
                    <DatePicker showTime style={{ width: '100%' }} placeholder="考试周期开始" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="endTime" label="周期结束" rules={[{ required: true, message: '请选择结束时间' }]}>
                    <DatePicker showTime style={{ width: '100%' }} placeholder="考试周期结束" />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ marginTop: -12, marginBottom: 8, color: '#888', fontSize: 12 }}>
                在批次时段内可设置多场考试，建议按考试周期的时间范围设置。
              </div>
            </>
          ))}

          {renderFormSection('考前配置', (
            <>
              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.examMode !== cur.examMode}>
                {({ getFieldValue }) => {
                  const mode = getFieldValue('examMode');
                  if (mode !== 'flexible') {
                    return (
                      <>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item name="waitingTime" label="候考时长（分钟）">
                              <InputNumber min={0} max={120} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="lateTolerance" label="允许迟到时长（分钟）">
                              <InputNumber min={0} max={120} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <div style={{ marginBottom: 16, color: '#888', fontSize: 12 }}>
                          候考时长：考生可提前进入考场等待开考；允许迟到时长：开考后仍可进入考试的最大时长。
                        </div>
                      </>
                    );
                  }
                  return null;
                }}
              </Form.Item>

              <Form.Item name="ipLimitEnabled" label="IP限制" valuePropName="checked">
                <Switch checkedChildren="启用" unCheckedChildren="不启用" />
              </Form.Item>

              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.ipLimitEnabled !== cur.ipLimitEnabled}>
                {({ getFieldValue }) => {
                  const enabled = getFieldValue('ipLimitEnabled');
                  return enabled ? (
                    <Form.Item
                      name="allowedIps"
                      label="允许访问的 IP/CIDR"
                      rules={[{ required: true, message: '请至少填写一个允许的 IP 或 CIDR 段' }]}
                    >
                      <Select
                        mode="tags"
                        placeholder="例如：192.168.1.0/24、10.0.0.5，按回车确认"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  ) : null;
                }}
              </Form.Item>
            </>
          ))}

          {renderFormSection('考中配置', (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="examDuration" label="考试时长（分钟）" rules={[{ required: true }]}>
                    <InputNumber min={10} max={480} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="freezeMinutes" label="冻结时间（分钟）">
                    <InputNumber min={0} max={120} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ color: '#888', fontSize: 12 }}>
                考试时长为正式开考到规定交卷时间；冻结时间为考生自主交卷后进入阅卷冻结的时长。
              </div>
            </>
          ))}

          {renderFormSection('异常行为配置', (
            <>
              <Form.Item name="exitPolicy" label="考生中途退出处理">
                <Radio.Group>
                  <Radio value="finite">有限续考</Radio>
                  <Radio value="unlimited">无限续考</Radio>
                  <Radio value="none">不可续考</Radio>
                </Radio.Group>
              </Form.Item>

              {exitPolicy === 'finite' && (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="exitMaxCount" label="退出次数上限">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="exitMaxMinutes" label="退出时间上限（分钟）">
                      <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              {exitPolicy === 'finite' && (
                <div style={{ color: '#888', fontSize: 12 }}>
                  超出退出次数或单次退出时间上限将无法再次续考。
                </div>
              )}
              {exitPolicy === 'unlimited' && (
                <div style={{ color: 'red', fontSize: 12 }}>
                  在考试结束前考生可以随时重新续考。
                </div>
              )}
              {exitPolicy === 'none' && (
                <div style={{ color: 'red', fontSize: 12 }}>
                  考生中途一旦退出考试则无法再次进入考试。
                </div>
              )}
            </>
          ))}

          {renderFormSection('考试须知', (
            <>
              <Form.Item name="rulesContent" label="考试须知内容">
                <Input.TextArea rows={6} placeholder="考生进入考场前需阅读的考场规则" />
              </Form.Item>

              <Form.Item name="rulesReadSeconds" label="强制阅读时长（秒）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </>
          ))}
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
              <Descriptions.Item label="考试模式">
                {examModeMap[selectedBatch.examMode]}
              </Descriptions.Item>
              <Descriptions.Item label="考试周期">
                {selectedBatch.startTime && selectedBatch.endTime
                  ? `${dayjs(selectedBatch.startTime).format('YYYY-MM-DD HH:mm')} ~ ${dayjs(selectedBatch.endTime).format('YYYY-MM-DD HH:mm')}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="考试时长">{selectedBatch.examDuration} 分钟</Descriptions.Item>
              <Descriptions.Item label="冻结时间">{selectedBatch.freezeMinutes} 分钟</Descriptions.Item>
              {selectedBatch.examMode !== 'flexible' && (
                <>
                  <Descriptions.Item label="候考时间">{selectedBatch.waitingTime} 分钟</Descriptions.Item>
                  <Descriptions.Item label="迟到容忍">{selectedBatch.lateTolerance} 分钟</Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="IP限制">
                {selectedBatch.ipLimitEnabled ? (
                  <>
                    启用
                    <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
                      白名单：{selectedBatch.allowedIps?.join('、') || '未配置'}
                    </div>
                  </>
                ) : (
                  '不启用'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="退出处理">{exitPolicyMap[selectedBatch.exitPolicy]}</Descriptions.Item>
              <Descriptions.Item label="退出次数上限">{selectedBatch.exitMaxCount}</Descriptions.Item>
              <Descriptions.Item label="退出时间上限">{selectedBatch.exitMaxMinutes} 分钟</Descriptions.Item>
              <Descriptions.Item label="须知阅读时长">{selectedBatch.rulesReadSeconds} 秒</Descriptions.Item>
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
              {selectedBatch.rulesContent && (
                <Descriptions.Item label="考试须知" span={2}>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{selectedBatch.rulesContent}</pre>
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

      {/* 批次延期 Modal */}
      <Modal
        title={`批次延期 - ${extendingBatch?.name}`}
        open={extendModalOpen}
        onOk={handleExtend}
        onCancel={() => setExtendModalOpen(false)}
        okText="确认延期"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={extendForm} layout="vertical" style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 16, color: '#888' }}>
            当前结束时间：
            {extendingBatch?.endTime
              ? dayjs(extendingBatch.endTime).format('YYYY-MM-DD HH:mm')
              : '未设置'}
          </div>
          <Form.Item
            name="endTime"
            label="新的结束时间"
            rules={[{ required: true, message: '请选择新的结束时间' }]}
          >
            <DatePicker showTime style={{ width: '100%' }} placeholder="选择延期后的结束时间" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
