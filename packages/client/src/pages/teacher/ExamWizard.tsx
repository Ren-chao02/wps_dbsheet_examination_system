import { useState, useEffect, useCallback } from 'react';
import {
  Steps, Button, Card, Form, Input, Select, InputNumber, Switch,
  message, Space, Row, Col, Tag, Table, Modal, Transfer, Typography,
  Alert, Progress, Tooltip, Divider, Spin, DatePicker, TimePicker,
  Empty
} from 'antd';
import {
  SaveOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  CheckCircleOutlined, FileTextOutlined, ClockCircleOutlined,
  HomeOutlined, TeamOutlined, BookOutlined, EyeOutlined,
  PlusOutlined, DeleteOutlined, WarningOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Paper } from '../../types';
import { useNavigate } from 'react-router-dom';

const { Step } = Steps;
const { Title, Text } = Typography;
const { TextArea } = Input;

// ✅ 向导步骤定义
interface WizardStep {
  key: string;
  title: string;
  icon: React.ReactNode;
  description: string;
}

const WIZARD_STEPS: WizardStep[] = [
  { key: 'basic', title: '基本信息', icon: <FileTextOutlined />, description: '设置考试名称、模式、时长' },
  { key: 'paper', title: '试卷绑定', icon: <BookOutlined />, description: '选择或创建试卷' },
  { key: 'session', title: '场次配置', icon: <ClockCircleOutlined />, description: '设置考试时间段' },
  { key: 'room', title: '考场分配', icon: <HomeOutlined />, description: '选择或创建考场' },
  { key: 'student', title: '学生管理', icon: <TeamOutlined />, description: '分配考生到各考场' },
];

// ✅ 向导状态接口
interface WizardData {
  // Step 1: 基本信息
  basicInfo: {
    batchId?: string; // 所属批次（可选）
    title: string;
    description?: string;
    mode: 'practice' | 'quiz' | 'exam';
    durationMinutes: number;
    passScore?: number;
    shuffleQuestions: boolean;
  };
  // Step 2: 试卷绑定
  paperInfo: {
    paperId?: string;
    paperName?: string;
    questionsCount: number;
    totalScore: number;
  };
  // Step 3: 场次配置
  sessions: Array<{
    id?: string;
    startTime: dayjs.Dayjs;
    endTime: dayjs.Dayjs;
    roomIds: string[];
  }>;
  // Step 4: 考场分配
  rooms: Array<{
    roomId: string;
    roomCode: string;
    roomName: string;
    capacity: number;
    assignedStudents: number;
  }>;
  // Step 5: 学生管理（按房间分组）
  studentAssignments: Record<string, string[]>; // roomId -> studentId[]
}

// ✅ 初始状态
const INITIAL_DATA: WizardData = {
  basicInfo: {
    title: '',
    description: '',
    mode: 'exam',
    durationMinutes: 60,
    shuffleQuestions: false,
  },
  paperInfo: {
    questionsCount: 0,
    totalScore: 0,
  },
  sessions: [],
  rooms: [],
  studentAssignments: {},
};

export function ExamWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [wizardData, setWizardData] = useState<WizardData>(INITIAL_DATA);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<any[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [availableRooms, setAvailableRooms] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);

  // 表单实例
  const [form1] = Form.useForm(); // 基本信息
  const [form3] = Form.useForm(); // 场次配置

  // ✅ 加载初始数据（批次列表、试卷列表等）
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // 并行加载所有必要数据
      const [batchRes, paperRes, roomRes, studentRes] = await Promise.all([
        api.get('/batches?pageSize=100').catch(() => ({ data: { data: [] } })),
        api.get('/papers?pageSize=100').catch(() => ({ data: { data: [] } })),
        api.get('/rooms?pageSize=100').catch(() => ({ data: { data: [] } })),
        api.get('/users?role=student&pageSize=500').catch(() => ({ data: { data: [] } })),
      ]);

      setBatches(batchRes.data?.data || []);
      setPapers(paperRes.data?.data || []);
      setAvailableRooms(roomRes.data?.data || []);
      setStudents(studentRes.data?.data || []);
    } catch (err) {
      console.error('加载数据失败:', err);
      message.error('加载基础数据失败');
    }
  };

  // ✅ 草稿自动保存（localStorage）
  useEffect(() => {
    const saveDraft = () => {
      try {
        localStorage.setItem('exam-wizard-draft', JSON.stringify({
          ...wizardData,
          savedAt: new Date().toISOString(),
        }));
      } catch (err) {
        console.error('保存草稿失败:', err);
      }
    };

    // 防抖：500ms后自动保存
    const timer = setTimeout(saveDraft, 500);
    return () => clearTimeout(timer);
  }, [wizardData]);

  // ✅ 恢复草稿
  useEffect(() => {
    try {
      const draft = localStorage.getItem('exam-wizard-draft');
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed.savedAt) {
          const age = Date.now() - new Date(parsed.savedAt).getTime();
          if (age < 24 * 60 * 60 * 1000) { // 24小时内
            Modal.confirm({
              title: '发现未完成的草稿',
              content: `您在 ${new Date(parsed.savedAt).toLocaleString()} 保存了一份草稿，是否恢复？`,
              okText: '恢复草稿',
              cancelText: '重新开始',
              onOk: () => {
                setWizardData(parsed);
                if (parsed.basicInfo) form1.setFieldsValue(parsed.basicInfo);
                message.success('已恢复草稿');
              },
            });
          }
        }
      }
    } catch (err) {
      console.error('恢复草稿失败:', err);
    }
  }, []);

  // ✅ 步骤导航控制
  const goToNext = async () => {
    try {
      setLoading(true);

      // 当前步骤的验证逻辑
      switch (currentStep) {
        case 0:
          await form1.validateFields();
          const values1 = form1.getFieldsValue();
          setWizardData(prev => ({
            ...prev,
            basicInfo: { ...prev.basicInfo, ...values1 },
          }));
          break;

        case 1:
          if (!wizardData.paperInfo.paperId) {
            message.warning('请先选择或绑定试卷');
            return;
          }
          break;

        case 2:
          if (wizardData.sessions.length === 0) {
            message.warning('请至少添加一个考试场次');
            return;
          }
          break;

        case 3:
          if (wizardData.rooms.length === 0) {
            message.warning('请至少选择一个考场');
            return;
          }
          break;

        case 4:
          const totalAssigned = Object.values(wizardData.studentAssignments).flat().length;
          if (totalAssigned === 0) {
            message.warning('请至少分配一名学生');
            return;
          }
          break;
      }

      setCurrentStep(prev => Math.min(prev + 1, WIZARD_STEPS.length - 1));
    } catch (err) {
      console.error('步骤验证失败:', err);
      message.error('请完成当前步骤的必填项');
    } finally {
      setLoading(false);
    }
  };

  const goToPrev = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0));
  };

  // ✅ 提交整个向导（创建考试+关联资源）
  const handleSubmit = async () => {
    try {
      setSaving(true);
      message.loading({ content: '正在创建考试...', duration: 0 });

      // Step 1: 创建考试主体
      const examPayload = {
        ...wizardData.basicInfo,
        batchId: wizardData.basicInfo.batchId || null,
        paperId: wizardData.paperInfo.paperId || null,
      };

      const examRes = await api.post('/exams', examPayload);
      const examId = examRes.data.id;

      // Step 2: 如果选择了批次，更新批次的exams关系（已在后端处理）

      message.success(`考试 "${examPayload.title}" 创建成功！`, 2);

      // 清除草稿
      localStorage.removeItem('exam-wizard-draft');

      // 跳转到编辑页面
      navigate(`/teacher/exams/${examId}/edit`);
    } catch (err: any) {
      console.error('创建考试失败:', err);
      message.error(err.response?.data?.message || '创建失败，请检查输入信息');
    } finally {
      setSaving(false);
    }
  };

  // ✅ 手动保存草稿
  const handleSaveDraft = useCallback(() => {
    try {
      localStorage.setItem('exam-wizard-draft', JSON.stringify({
        ...wizardData,
        savedAt: new Date().toISOString(),
      }));
      message.success('草稿已保存');
    } catch (err) {
      message.error('保存草稿失败');
    }
  }, [wizardData]);

  // ✅ 渲染当前步骤内容
  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <Card title="基本信息" style={{ marginTop: 16 }}>
            <Form form={form1} layout="vertical" initialValues={wizardData.basicInfo}>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name="batchId" label="所属批次（可选）">
                    <Select
                      placeholder="选择批次以继承公共参数"
                      allowClear
                      showSearch
                      optionFilterProp="children"
                      onChange={(value) => {
                        if (value) {
                          const batch = batches.find(b => b.id === value);
                          if (batch) {
                            form1.setFieldsValue({
                              durationMinutes: batch.examDuration,
                            });
                            message.info(`已应用批次"${batch.name}"的统一参数`);
                          }
                        }
                      }}
                    >
                      {batches.map(b => (
                        <Select.Option key={b.id} value={b.id}>
                          {b.name} ({b.examDuration}分钟)
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="title" label="考试名称" rules={[{ required: true }]}>
                    <Input placeholder="如：WPS多维表格基础操作考核" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="description" label="考试说明">
                <TextArea rows={3} placeholder="学生可见的考试说明" />
              </Form.Item>

              <Row gutter={24}>
                <Col span={8}>
                  <Form.Item name="mode" label="考试模式" rules={[{ required: true }]}>
                    <Select>
                      <Select.Option value="practice">练习</Select.Option>
                      <Select.Option value="quiz">测验</Select.Option>
                      <Select.Option value="exam">正式考试</Select.Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="durationMinutes" label="考试时长（分钟）" rules={[{ required: true }]}>
                    <InputNumber min={10} max={480} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="passScore" label="及格分数">
                    <InputNumber min={0} max={1000} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="shuffleQuestions" label="随机出题顺序" valuePropName="checked">
                <Switch checkedChildren="开启" unCheckedChildren="关闭" />
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  开启后每位学生看到不同的题目顺序
                </Text>
              </Form.Item>
            </Form>
          </Card>
        );

      case 1:
        return (
          <Card title="试卷绑定" style={{ marginTop: 16 }}>
            {selectedPaper ? (
              <div>
                <Alert
                  type="success"
                  showIcon
                  message={`已选择试卷: ${selectedPaper.name}`}
                  description={
                    <Space>
                      <Tag color="blue">{wizardData.paperInfo.questionsCount} 题</Tag>
                      <Tag color="green">总分 {wizardData.paperInfo.totalScore}</Tag>
                    </Space>
                  }
                  style={{ marginBottom: 16 }}
                  action={
                    <Button size="small" onClick={() => {
                      setSelectedPaper(null);
                      setWizardData(prev => ({
                        ...prev,
                        paperInfo: { questionsCount: 0, totalScore: 0 },
                      }));
                    }}>
                      更换试卷
                    </Button>
                  }
                />

                <Table
                  dataSource={selectedPaper.paperQuestions || []}
                  rowKey="questionId"
                  pagination={false}
                  size="small"
                  columns={[
                    { title: '序号', width: 60, render: (_, __, i) => i + 1 },
                    { title: '题型', dataIndex: ['question', 'type'], render: (v: string) => <Tag>{v}</Tag> },
                    { title: '题目', dataIndex: ['question', 'title'], ellipsis: true },
                    { title: '分值', dataIndex: 'score', width: 80 },
                  ]}
                />

                <Divider />
                <Text type="secondary">
                  提示：如需使用多张试卷随机抽题功能，请在后续版本中使用"高级设置"
                </Text>
              </div>
            ) : (
              <div>
                <Table
                  dataSource={papers}
                  rowKey="id"
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '试卷名称', dataIndex: 'name' },
                    { title: '难度', dataIndex: 'difficulty', render: (v: string) => v || '-' },
                    {
                      title: '题目数',
                      key: 'count',
                      render: (_: any, r: Paper) => r._count?.paperQuestions ?? 0,
                    },
                    { title: '总分', dataIndex: 'totalScore' },
                    {
                      title: '操作',
                      width: 100,
                      render: (_: any, r: Paper) => (
                        <Button
                          type="primary"
                          size="small"
                          onClick={() => {
                            setSelectedPaper(r);
                            setWizardData(prev => ({
                              ...prev,
                              paperInfo: {
                                paperId: r.id,
                                paperName: r.name,
                                questionsCount: r._count?.paperQuestions ?? 0,
                                totalScore: r.totalScore,
                              },
                            }));
                          }}
                        >
                          选择
                        </Button>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </Card>
        );

      case 2:
        return (
          <Card title="场次配置" style={{ marginTop: 16 }} extra={
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => {
                const newSession = {
                  id: `temp-${Date.now()}`,
                  startTime: dayjs().add(1, 'day').hour(9).minute(0),
                  endTime: dayjs().add(1, 'day').hour(11).minute(0),
                  roomIds: [],
                };
                setWizardData(prev => ({
                  ...prev,
                  sessions: [...prev.sessions, newSession],
                }));
              }}
            >
              添加场次
            </Button>
          }>
            {wizardData.sessions.length > 0 ? (
              wizardData.sessions.map((session, index) => (
                <Card
                  key={session.id || index}
                  size="small"
                  style={{ marginBottom: 12 }}
                  title={`第 ${index + 1} 场次`}
                  extra={
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => {
                        setWizardData(prev => ({
                          ...prev,
                          sessions: prev.sessions.filter((_, i) => i !== index),
                        }));
                      }}
                    >
                      删除
                    </Button>
                  }
                >
                  <Row gutter={16}>
                    <Col span={12}>
                      <div style={{ marginBottom: 8 }}>
                        <Text strong>开始时间：</Text>
                      </div>
                      <DatePicker
                        showTime
                        defaultValue={session.startTime}
                        onChange={(val) => {
                          const updated = [...wizardData.sessions];
                          updated[index].startTime = val!;
                          setWizardData(prev => ({ ...prev, sessions: updated }));
                        }}
                        style={{ width: '100%' }}
                      />
                    </Col>
                    <Col span={12}>
                      <div style={{ marginBottom: 8 }}>
                        <Text strong>结束时间：</Text>
                      </div>
                      <DatePicker
                        showTime
                        defaultValue={session.endTime}
                        onChange={(val) => {
                          const updated = [...wizardData.sessions];
                          updated[index].endTime = val!;
                          setWizardData(prev => ({ ...prev, sessions: updated }));
                        }}
                        style={{ width: '100%' }}
                      />
                    </Col>
                  </Row>

                  <div style={{ marginTop: 12 }}>
                    <Text strong>适用考场：</Text>
                    <Select
                      mode="multiple"
                      placeholder="选择本场次的考场"
                      style={{ width: '100%', marginTop: 4 }}
                      value={session.roomIds}
                      onChange={(values) => {
                        const updated = [...wizardData.sessions];
                        updated[index].roomIds = values;
                        setWizardData(prev => ({ ...prev, sessions: updated }));
                      }}
                    >
                      {availableRooms.map(room => (
                        <Select.Option key={room.id} value={room.id}>
                          {room.code} - {room.name} (容量:{room.capacity})
                        </Select.Option>
                      ))}
                    </Select>
                  </div>
                </Card>
              ))
            ) : (
              <Empty description="暂无场次，点击右上角按钮添加" />
            )}

            {wizardData.sessions.length > 1 && (
              <Alert
                type="info"
                showIcon
                message={`共 ${wizardData.sessions.length} 个场次`}
                description="不同场次可以设置不同的时间和考场，适合分批次组织考试"
                style={{ marginTop: 16 }}
              />
            )}
          </Card>
        );

      case 3:
        return (
          <Card title="考场分配" style={{ marginTop: 16 }}>
            <Transfer
              dataSource={availableRooms.map(room => ({
                key: room.id,
                title: `${room.code} - ${room.name}`,
                description: `容量:${room.capacity}人 | 位置:${room.location || '-'}`,
              }))}
              titles={['可选考场', '已选考场']}
              targetKeys={wizardData.rooms.map(r => r.roomId)}
              onChange={(targetKeys) => {
                const selectedRooms = availableRooms.filter(room =>
                  targetKeys.includes(room.id)
                );
                setWizardData(prev => ({
                  ...prev,
                  rooms: selectedRooms.map(room => ({
                    roomId: room.id,
                    roomCode: room.code,
                    roomName: room.name,
                    capacity: room.capacity,
                    assignedStudents: prev.studentAssignments[room.id]?.length || 0,
                  })),
                }));
              }}
              listStyle={{ width: 350, height: 400 }}
              render={(item) => (
                <div>
                  <div><strong>{item.title as string}</strong></div>
                  <div style={{ fontSize: 12, color: '#999' }}>{item.description as string}</div>
                </div>
              )}
              showSearch
              filterOption={(inputValue, item: any) =>
                item.title.toLowerCase().includes(inputValue.toLowerCase())
              }
            />

            {wizardData.rooms.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>已选择考场总容量：</Text>
                <Tag color="blue">
                  {wizardData.rooms.reduce((sum, r) => sum + r.capacity, 0)} 人
                </Tag>
              </div>
            )}
          </Card>
        );

      case 4:
        return (
          <Card title="学生管理" style={{ marginTop: 16 }}>
            {wizardData.rooms.length > 0 ? (
              <Tabs
                items={wizardData.rooms.map(room => ({
                  key: room.roomId,
                  label: `${room.roomCode} (${wizardData.studentAssignments[room.roomId]?.length || 0}/${room.capacity})`,
                  children: (
                    <div>
                      <Transfer
                        dataSource={students.map(s => ({
                          key: s.id,
                          title: `${s.realName || s.username}${s.studentId ? ` (${s.studentId})` : ''}`,
                        }))}
                        titles={['可选学生', '已分配']}
                        targetKeys={wizardData.studentAssignments[room.roomId] || []}
                        onChange={(keys) => {
                          setWizardData(prev => ({
                            ...prev,
                            studentAssignments: {
                              ...prev.studentAssignments,
                              [room.roomId]: keys as string[],
                            },
                          }));
                        }}
                        listStyle={{ width: 300, height: 300 }}
                        showSearch
                      />

                      <Progress
                        percent={Math.round(
                          ((wizardData.studentAssignments[room.roomId]?.length || 0) / room.capacity) * 100
                        )}
                        status={
                          (wizardData.studentAssignments[room.roomId]?.length || 0) >= room.capacity
                            ? 'exception'
                            : 'active'
                        }
                        style={{ marginTop: 12 }}
                      />
                    </div>
                  ),
                }))}
              />
            ) : (
              <Alert
                type="warning"
                showIcon
                message="请先在上一步中选择考场"
              />
            )}
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>
      {/* 页面头部 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/teacher/exams')}>
            返回列表
          </Button>
          <Title level={3} style={{ margin: 0 }}>创建考试（向导模式）</Title>
        </Space>
        <Space>
          <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>
            保存草稿
          </Button>
        </Space>
      </div>

      {/* 向导进度条 */}
      <Card>
        <Steps current={currentStep} onChange={(step) => {
          // 允许跳回之前的步骤，但不允许直接跳到后面的步骤
          if (step <= currentStep) {
            setCurrentStep(step);
          }
        }}>
          {WIZARD_STEPS.map(step => (
            <Step
              key={step.key}
              title={step.title}
              icon={step.icon}
              description={step.description}
            />
          ))}
        </Steps>
      </Card>

      {/* 当前步骤内容 */}
      {renderStepContent()}

      {/* 底部操作栏 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 24,
        padding: '16px 24px',
        background: '#fafafa',
        borderRadius: 8,
      }}>
        <div>
          <Text type="secondary">
            步骤 {currentStep + 1} / {WIZARD_STEPS.length}
          </Text>
          {currentStep === WIZARD_STEPS.length - 1 && (
            <WarningOutlined style={{ color: '#faad14', marginLeft: 8 }} />
          )}
        </div>

        <Space>
          {currentStep > 0 && (
            <Button onClick={goToPrev} icon={<ArrowLeftOutlined />}>
              上一步
            </Button>
          )}

          {currentStep < WIZARD_STEPS.length - 1 ? (
            <Button
              type="primary"
              onClick={goToNext}
              loading={loading}
              icon={<ArrowRightOutlined />}
            >
              下一步
            </Button>
          ) : (
            <Button
              type="primary"
              onClick={handleSubmit}
              loading={saving}
              icon={<CheckCircleOutlined />}
              size="large"
            >
              完成创建
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}

// ✅ 导入Tabs组件（Ant Design 5需要单独导入）
import { Tabs } from 'antd';
