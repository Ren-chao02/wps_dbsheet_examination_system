import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Form, Input, Select, Button, Card, Table, message, Spin, Space, Row, Col,
  Drawer, Tree, Tabs, Tag, InputNumber, Popconfirm, Empty, Statistic
} from 'antd';
import {
  SaveOutlined, ArrowLeftOutlined, PlusOutlined, DeleteOutlined,
  EyeOutlined, BarChartOutlined, ArrowUpOutlined, ArrowDownOutlined
} from '@ant-design/icons';
import api from '../../services/api';
import type { Question, QuestionCategory, Paper, PaperQuestion } from '../../types';

const { TextArea } = Input;
const { TabPane } = Tabs;

export function PaperEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('select');
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<PaperQuestion[]>([]);
  const [questionFilter, setQuestionFilter] = useState({ type: '', difficulty: '', search: '' });
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const isEdit = !!id;

  useEffect(() => {
    fetchCategories();
    if (isEdit) {
      setLoading(true);
      api.get(`/papers/${id}`).then(res => {
        const p: Paper = res.data;
        form.setFieldsValue({
          name: p.name,
          description: p.description,
          difficulty: p.difficulty,
          passScore: p.passScore,
        });
        if (p.paperQuestions) {
          setSelectedQuestions(p.paperQuestions);
        }
        if (searchParams.get('tab') === 'preview') {
          setDrawerOpen(true);
          setDrawerTab('preview');
        }
      }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
    }
  }, [id]);

  const fetchCategories = async () => {
    try {
      const res = await api.get('/categories/tree');
      setCategories(res.data?.data || []);
    } catch {
      console.error('Error fetching categories');
    }
  };

  const fetchQuestions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('status', 'published');
      params.append('pageSize', '1000');
      if (questionFilter.type) params.append('type', questionFilter.type);
      if (questionFilter.difficulty) params.append('difficulty', questionFilter.difficulty);
      if (questionFilter.search) params.append('search', questionFilter.search);
      if (selectedCategory) params.append('primaryCategoryId', selectedCategory);
      const res = await api.get(`/questions?${params.toString()}`);
      setAllQuestions(res.data?.data || []);
    } catch {
      console.error('Error fetching questions');
    }
  }, [questionFilter, selectedCategory]);

  useEffect(() => {
    if (drawerOpen) {
      fetchQuestions();
    }
  }, [drawerOpen, fetchQuestions]);

  const onFinish = async (values: any) => {
    setSaving(true);
    try {
      let paperId = id;
      if (isEdit) {
        await api.put(`/papers/${id}`, values);
      } else {
        const res = await api.post('/papers', values);
        paperId = res.data.id;
      }
      // Save questions
      await api.put(`/papers/${paperId}/questions`, {
        questionIds: selectedQuestions.map((pq, i) => ({
          questionId: pq.questionId,
          sortOrder: i,
          score: pq.score,
        })),
      });
      message.success(isEdit ? '更新成功' : '创建成功');
      if (!isEdit) {
        navigate(`/teacher/papers/${paperId}/edit`);
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = (q: Question) => {
    if (selectedQuestions.find(pq => pq.questionId === q.id)) {
      message.warning('该题目已存在');
      return;
    }
    setSelectedQuestions(prev => [...prev, {
      id: `temp-${Date.now()}`,
      paperId: id || '',
      questionId: q.id,
      sortOrder: prev.length,
      score: q.score,
      question: q,
    }]);
    message.success('已添加');
  };

  const handleRemoveQuestion = (index: number) => {
    setSelectedQuestions(prev => prev.filter((_, i) => i !== index));
  };

  const handleMoveQuestion = (index: number, direction: number) => {
    const newQuestions = [...selectedQuestions];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newQuestions.length) return;
    [newQuestions[index], newQuestions[targetIndex]] = [newQuestions[targetIndex], newQuestions[index]];
    setSelectedQuestions(newQuestions);
  };

  const handleScoreChange = (index: number, score: number) => {
    const newQuestions = [...selectedQuestions];
    newQuestions[index] = { ...newQuestions[index], score };
    setSelectedQuestions(newQuestions);
  };

  const buildTreeData = (cats: QuestionCategory[]): any[] => {
    return cats.map(c => ({
      title: c.name,
      key: c.id,
      children: c.children ? buildTreeData(c.children) : [],
    }));
  };

  const totalScore = selectedQuestions.reduce((sum, pq) => sum + (pq.score || 0), 0);
  const questionCount = selectedQuestions.length;
  const typeDistribution = selectedQuestions.reduce((acc, pq) => {
    const t = pq.question.type;
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const filteredQuestions = allQuestions.filter(q => {
    const selectedIds = new Set(selectedQuestions.map(pq => pq.questionId));
    return !selectedIds.has(q.id);
  });

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/teacher/papers')} />
          <h2>{isEdit ? '编辑试卷' : '创建试卷'}</h2>
        </Space>
        <Space>
          <Button icon={<EyeOutlined />} onClick={() => { setDrawerOpen(true); setDrawerTab('preview'); }}>整卷预览</Button>
          <Button icon={<BarChartOutlined />} onClick={() => { setDrawerOpen(true); setDrawerTab('analysis'); }}>试卷分析</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={saving}>保存</Button>
        </Space>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="试卷名称" rules={[{ required: true }]}>
                <Input placeholder="如：多维表格基础操作考核" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="difficulty" label="难度">
                <Select placeholder="选择难度" allowClear options={[
                  { value: 'easy', label: '简单' },
                  { value: 'medium', label: '中等' },
                  { value: 'hard', label: '困难' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="passScore" label="及格分">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="不设及格分" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="备注">
            <TextArea rows={3} placeholder="试卷备注" />
          </Form.Item>
        </Card>
      </Form>

      <Card title="已选题目" style={{ marginBottom: 16 }}
        extra={
          <Space>
            <span style={{ color: '#666' }}>共 {questionCount} 题，总分 {totalScore} 分</span>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setDrawerOpen(true); setDrawerTab('select'); }}>添加题目</Button>
          </Space>
        }
      >
        {selectedQuestions.length === 0 ? (
          <Empty description="暂未选题，点击右上角添加题目" />
        ) : (
          <Table dataSource={selectedQuestions} rowKey="questionId" pagination={false} size="small">
            <Table.Column title="序号" width={60} render={(_, __, i) => i + 1} />
            <Table.Column title="题型" width={100} dataIndex={['question', 'type']} render={(v: string) => <Tag>{v}</Tag>} />
            <Table.Column title="题目" dataIndex={['question', 'title']} ellipsis />
            <Table.Column title="难度" width={80} dataIndex={['question', 'difficulty']} />
            <Table.Column title="分值" width={100} render={(_, record: PaperQuestion, index: number) => (
              <InputNumber min={1} max={1000} value={record.score} onChange={v => handleScoreChange(index, v || 0)} style={{ width: 80 }} />
            )} />
            <Table.Column title="操作" width={120} render={(_, __, index: number) => (
              <Space>
                <Button size="small" icon={<ArrowUpOutlined />} onClick={() => handleMoveQuestion(index, -1)} disabled={index === 0} />
                <Button size="small" icon={<ArrowDownOutlined />} onClick={() => handleMoveQuestion(index, 1)} disabled={index === selectedQuestions.length - 1} />
                <Popconfirm title="确认移除？" onConfirm={() => handleRemoveQuestion(index)}>
                  <Button size="small" icon={<DeleteOutlined />} danger />
                </Popconfirm>
              </Space>
            )} />
          </Table>
        )}
      </Card>

      <Drawer
        title="选题组卷"
        width={900}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        bodyStyle={{ padding: 0 }}
      >
        <Tabs activeKey={drawerTab} onChange={setDrawerTab} style={{ padding: '0 24px' }}>
          <TabPane tab="选题" key="select">
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={6}>
                <Tree
                  treeData={buildTreeData(categories)}
                  expandedKeys={expandedKeys}
                  onExpand={keys => setExpandedKeys(keys as string[])}
                  onSelect={keys => setSelectedCategory(keys[0] as string || null)}
                  style={{ maxHeight: 500, overflow: 'auto', border: '1px solid #f0f0f0', padding: 8 }}
                />
              </Col>
              <Col span={18}>
                <Space style={{ marginBottom: 16 }} wrap>
                  <Input placeholder="搜索题目" value={questionFilter.search} onChange={e => setQuestionFilter({ ...questionFilter, search: e.target.value })} onPressEnter={fetchQuestions} style={{ width: 200 }} />
                  <Select placeholder="题型" allowClear value={questionFilter.type || undefined} onChange={v => setQuestionFilter({ ...questionFilter, type: v || '' })} style={{ width: 140 }}
                    options={[
                      { value: 'create_table', label: '创建表格' },
                      { value: 'add_field', label: '添加字段' },
                      { value: 'config_view', label: '配置视图' },
                      { value: 'create_form', label: '创建表单' },
                      { value: 'comprehensive', label: '综合题' },
                    ]}
                  />
                  <Select placeholder="难度" allowClear value={questionFilter.difficulty || undefined} onChange={v => setQuestionFilter({ ...questionFilter, difficulty: v || '' })} style={{ width: 120 }}
                    options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]}
                  />
                  <Button type="primary" onClick={fetchQuestions}>查询</Button>
                </Space>
                <Table dataSource={filteredQuestions} rowKey="id" size="small" pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '题型', dataIndex: 'type', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                    { title: '题目', dataIndex: 'title', ellipsis: true },
                    { title: '难度', dataIndex: 'difficulty', width: 80 },
                    { title: '分值', dataIndex: 'score', width: 60 },
                    { title: '分类', dataIndex: ['primaryCategory', 'name'], width: 120, render: (v: string) => v || '-' },
                    { title: '操作', width: 80, render: (_: any, q: Question) => (
                      <Button size="small" type="primary" onClick={() => handleAddQuestion(q)}>添加</Button>
                    )},
                  ]}
                />
              </Col>
            </Row>
          </TabPane>

          <TabPane tab="已选试题" key="selected">
            <Table dataSource={selectedQuestions} rowKey="questionId" pagination={false} size="small">
              <Table.Column title="序号" width={60} render={(_, __, i) => i + 1} />
              <Table.Column title="题型" width={100} dataIndex={['question', 'type']} render={(v: string) => <Tag>{v}</Tag>} />
              <Table.Column title="题目" dataIndex={['question', 'title']} />
              <Table.Column title="分值" width={80} dataIndex="score" />
              <Table.Column title="操作" width={80} render={(_, __, index: number) => (
                <Button size="small" icon={<DeleteOutlined />} danger onClick={() => handleRemoveQuestion(index)}>移除</Button>
              )} />
            </Table>
          </TabPane>

          <TabPane tab="试卷分析" key="analysis">
            <Row gutter={16} style={{ marginBottom: 24 }}>
              <Col span={8}>
                <Statistic title="总题数" value={questionCount} />
              </Col>
              <Col span={8}>
                <Statistic title="总分" value={totalScore} />
              </Col>
              <Col span={8}>
                <Statistic title="平均分值" value={questionCount > 0 ? (totalScore / questionCount).toFixed(1) : 0} />
              </Col>
            </Row>
            <h4>题型分布</h4>
            <Space direction="vertical" style={{ marginBottom: 16 }}>
              {Object.entries(typeDistribution).map(([type, count]) => (
                <Tag key={type} color="blue">{type}: {count} 题</Tag>
              ))}
            </Space>
          </TabPane>

          <TabPane tab="整卷预览" key="preview">
            {selectedQuestions.map((pq, i) => (
              <Card key={pq.questionId} size="small" style={{ marginBottom: 8 }}>
                <div><strong>{i + 1}. {pq.question.title}</strong> <Tag color="blue">{pq.score}分</Tag></div>
                <div style={{ color: '#666', marginTop: 4 }}>{pq.question.description}</div>
              </Card>
            ))}
          </TabPane>
        </Tabs>
      </Drawer>
    </div>
  );
}
