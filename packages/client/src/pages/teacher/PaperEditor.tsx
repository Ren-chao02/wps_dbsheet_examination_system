import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Form, Input, Select, Button, Card, Table, message, Spin, Space, Row, Col,
  Drawer, Tree, Tabs, Tag, InputNumber, Popconfirm, Empty, Statistic,
  Alert, Segmented, Popover, Typography,
} from 'antd';
import {
  SaveOutlined, ArrowLeftOutlined, PlusOutlined, DeleteOutlined,
  EyeOutlined, BarChartOutlined, ArrowUpOutlined, ArrowDownOutlined
} from '@ant-design/icons';
import api from '../../services/api';
import { QUESTION_TYPE_LABELS } from '../../utils/questionLabels';
import type {
  Question, QuestionCategory, Paper, PaperQuestion,
  Capability, SlotRule, SlotType, SlotPreviewResult,
} from '../../types';

const { TextArea } = Input;
const { TabPane } = Tabs;
const { Text } = Typography;

const DIFFICULTY_LABELS: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' };

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

/** 抽题条件的可读描述（抽屉"已选试题"、整卷预览用） */
function describeRule(rule?: SlotRule | null): string {
  if (!rule) return '未配置条件';
  const parts: string[] = [];
  if (rule.capabilityIds?.length) parts.push(`知识点 ${rule.capabilityIds.length} 个`);
  if (rule.difficulty) parts.push(DIFFICULTY_LABELS[rule.difficulty] || rule.difficulty);
  if (rule.type) parts.push(QUESTION_TYPE_LABELS[rule.type] || rule.type);
  return parts.length > 0 ? parts.join(' · ') : '未配置条件';
}

/**
 * 抽题题位的候选池状态展示。
 * 候选数是组卷的关键信息：0 道 = 开考抽不出题（学生少做一题）；1 道 = 全员同题。
 */
function SlotPreviewStatus({ preview }: { preview: SlotPreviewResult }) {
  const { candidateCount, excludedByScore, schemaRefsConflict } = preview;
  return (
    <div style={{ marginTop: 8 }}>
      {candidateCount > 0 ? (
        <Space size={4} wrap>
          <Text type="success" style={{ fontSize: 12 }}>候选题 {candidateCount} 道</Text>
          <Popover
            title={`候选题（共 ${candidateCount} 道，最多显示 20 条）`}
            content={
              <ul style={{ maxHeight: 240, overflow: 'auto', paddingLeft: 16, margin: 0, maxWidth: 320 }}>
                {preview.candidates.map(c => (
                  <li key={c.id} style={{ marginBottom: 4 }}>
                    {c.title}
                    <Tag style={{ marginLeft: 6 }}>{QUESTION_TYPE_LABELS[c.type] || c.type}</Tag>
                    <Tag>{DIFFICULTY_LABELS[c.difficulty] || c.difficulty}</Tag>
                  </li>
                ))}
              </ul>
            }
          >
            <a style={{ fontSize: 12 }}>查看候选题</a>
          </Popover>
        </Space>
      ) : (
        // 0 道候选 = 开考时此题位抽不出题，学生会少做一题：红色最醒目
        <Alert
          type="error"
          showIcon
          message="开考时此题位抽不出题，学生会少做一题"
          description="请调整知识点/难度/题型条件，或核对本题位分值"
          style={{ marginBottom: 4 }}
        />
      )}
      {candidateCount === 1 && (
        <Alert
          type="warning"
          showIcon
          message="只有 1 道候选题，所有学生会拿到同一道题"
          style={{ marginBottom: 4 }}
        />
      )}
      {schemaRefsConflict && (
        <Alert
          type="warning"
          showIcon
          message="候选题引用的表/字段不一致，可能有的学生做不了，请统一题库里的引用声明"
          style={{ marginBottom: 4 }}
        />
      )}
      {excludedByScore > 0 && (
        <Alert
          type="info"
          showIcon
          message={`${excludedByScore} 道题因分值不符被排除（候选题分值需与本题位分值一致）`}
          style={{ marginBottom: 4 }}
        />
      )}
    </div>
  );
}

/**
 * 抽题题位编辑器：知识点 + 难度 + 题型条件，加候选池实时预览。
 * 预览请求做 600ms 防抖 —— 教师连续调整条件时不逐键发请求；
 * 依赖变化后旧请求会被 AbortController 取消，避免慢响应覆盖新结果。
 */
function RuleSlotEditor({ rule, score, capabilities, onChange }: {
  rule: SlotRule;
  score: number;
  capabilities: Capability[];
  onChange: (patch: Partial<SlotRule>) => void;
}) {
  const [preview, setPreview] = useState<SlotPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(false);

  const hasCondition = !!(rule.capabilityIds?.length || rule.difficulty || rule.type);

  useEffect(() => {
    const capabilityIds = rule.capabilityIds ?? [];
    const conditionFilled = capabilityIds.length > 0 || !!rule.difficulty || !!rule.type;
    if (!conditionFilled) {
      // 条件为空时发预览没有意义（候选池 = 全部已发布题目）
      setPreview(null);
      setPreviewing(false);
      setPreviewError(false);
      return;
    }
    setPreviewing(true);
    setPreviewError(false);
    const controller = new AbortController();
    // 防抖：停顿 600ms 才发请求，避免"每敲一个键发一次"
    const timer = setTimeout(() => {
      api.post('/papers/slot-preview', {
        rule: {
          capabilityIds,
          difficulty: rule.difficulty,
          type: rule.type,
        },
        score,
      }, { signal: controller.signal })
        .then(res => {
          setPreview(res.data);
          setPreviewing(false);
        })
        .catch(() => {
          // 请求被取消（条件又变了）时保持现状，等下一轮防抖结果
          if (!controller.signal.aborted) {
            setPreview(null);
            setPreviewError(true);
            setPreviewing(false);
          }
        });
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [rule.capabilityIds, rule.difficulty, rule.type, score]);

  return (
    <div>
      <Row gutter={8}>
        <Col span={9}>
          <Select
            mode="multiple"
            allowClear
            showSearch
            size="small"
            placeholder="知识点（能力点）"
            value={rule.capabilityIds ?? []}
            options={capabilities.map(c => ({ value: c.id, label: c.name }))}
            onChange={v => onChange({ capabilityIds: v })}
            style={{ width: '100%' }}
            maxTagCount="responsive"
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Col>
        <Col span={5}>
          <Select
            size="small"
            allowClear
            placeholder="难度"
            value={rule.difficulty}
            options={DIFFICULTY_OPTIONS}
            onChange={v => onChange({ difficulty: v })}
            style={{ width: '100%' }}
          />
        </Col>
        <Col span={6}>
          <Select
            size="small"
            allowClear
            placeholder="题型"
            value={rule.type}
            options={Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={v => onChange({ type: v })}
            style={{ width: '100%' }}
          />
        </Col>
      </Row>
      {/* 候选池状态：0 道红色 / 1 道橙色 / 引用声明冲突橙色 / 分值不符蓝色 */}
      {!hasCondition ? (
        <Text type="secondary" style={{ fontSize: 12 }}>填写知识点/难度/题型后显示候选题数量</Text>
      ) : previewing ? (
        <Space size={4} style={{ marginTop: 8 }}><Spin size="small" /><Text type="secondary" style={{ fontSize: 12 }}>计算候选题…</Text></Space>
      ) : previewError ? (
        <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'inline-block' }}>候选池查询失败，请稍后重试</Text>
      ) : preview ? (
        <SlotPreviewStatus preview={preview} />
      ) : null}
    </div>
  );
}

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
  const [categoryMap, setCategoryMap] = useState<Map<string, number>>(new Map());
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<PaperQuestion[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<{ id: string; level: number } | null>(null);
  /** 抽题条件里的知识点选项：与出题打标同一份能力图谱，保证 id 一致可匹配 */
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  /** 待替换的题位下标：抽题切回固定题后，在选题抽屉里选中的题替换该行 */
  const [pendingReplaceIndex, setPendingReplaceIndex] = useState<number | null>(null);
  const isEdit = !!id;

  useEffect(() => {
    fetchCategories();
    // 能力图谱：抽题题位的知识点多选框选项（只取列表，不关心域导航）
    api.get('/capabilities')
      .then(res => setCapabilities(res.data?.data?.capabilities || []))
      .catch(() => console.error('Error fetching capabilities'));
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
      const res = await api.get('/categories?mode=tree');
      const treeData = res.data?.data || [];
      setCategories(treeData);

      const map = new Map<string, number>();
      const traverse = (cats: QuestionCategory[]) => {
        cats.forEach((c) => {
          map.set(c.id, c.level);
          if (c.children && c.children.length > 0) {
            traverse(c.children);
          }
        });
      };
      traverse(treeData);
      setCategoryMap(map);
    } catch {
      console.error('Error fetching categories');
    }
  };

  const fetchQuestions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.append('status', 'published');
      params.append('pageSize', '1000');
      if (selectedCategory) {
        if (selectedCategory.level === 1) {
          params.append('primaryCategory', selectedCategory.id);
        } else {
          params.append('secondaryCategory', selectedCategory.id);
        }
      }
      const res = await api.get(`/questions?${params.toString()}`);
      setAllQuestions(res.data?.data || []);
    } catch {
      console.error('Error fetching questions');
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (drawerOpen) {
      fetchQuestions();
    }
  }, [drawerOpen, fetchQuestions]);

  const onFinish = async (values: any) => {
    // 保存前校验题位配置（与服务端口径一致，报错直接指出是哪一题的问题）
    for (let i = 0; i < selectedQuestions.length; i++) {
      const pq = selectedQuestions[i];
      if (pq.slotType === 'fixed' && !pq.questionId) {
        message.error(`第 ${i + 1} 题：固定题位尚未指定题目`);
        return;
      }
      if (pq.slotType === 'rule') {
        const hasCondition = !!pq.rule && (
          (pq.rule.capabilityIds?.length || 0) > 0 || !!pq.rule.difficulty || !!pq.rule.type
        );
        if (!hasCondition) {
          message.error(`第 ${i + 1} 题：抽题题位至少需要一个抽题条件（知识点/难度/题型）`);
          return;
        }
      }
    }
    setSaving(true);
    try {
      let paperId = id;
      if (isEdit) {
        await api.put(`/papers/${id}`, values);
      } else {
        const res = await api.post('/papers', values);
        paperId = res.data.id;
      }
      // Save questions（按服务端题位结构提交：fixed 带 questionId，rule 带 rule 且 questionId 为 null）
      await api.put(`/papers/${paperId}/questions`, {
        questionIds: selectedQuestions.map((pq, i) => ({
          questionId: pq.slotType === 'fixed' ? pq.questionId : null,
          sortOrder: i,
          score: pq.score,
          slotType: pq.slotType,
          rule: pq.slotType === 'rule'
            ? {
                capabilityIds: pq.rule?.capabilityIds ?? [],
                difficulty: pq.rule?.difficulty,
                type: pq.rule?.type,
              }
            : undefined,
        })),
      });
      message.success(isEdit ? '更新成功' : '创建成功');
      // 保存成功后返回上一级页面（试卷列表）
      navigate('/teacher/papers');
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = (q: Question) => {
    if (selectedQuestions.some(pq => pq.questionId === q.id)) {
      message.warning('该题目已存在');
      return;
    }
    if (pendingReplaceIndex !== null) {
      // 抽题→固定的题位在抽屉里选题后替换原行
      setSelectedQuestions(prev => prev.map((pq, i) =>
        i === pendingReplaceIndex
          ? { ...pq, questionId: q.id, question: q, slotType: 'fixed' as SlotType, rule: null }
          : pq,
      ));
      setPendingReplaceIndex(null);
      message.success('已替换为该题目');
      return;
    }
    setSelectedQuestions(prev => [...prev, {
      id: `temp-${Date.now()}-${prev.length}`,
      paperId: id || '',
      questionId: q.id,
      sortOrder: prev.length,
      score: q.score,
      slotType: 'fixed' as SlotType,
      rule: null,
      question: q,
    }]);
    message.success('已添加');
  };

  /** 新增抽题题位：条件默认留空，教师填知识点/难度/题型后候选池预览会自动出现 */
  const handleAddRuleSlot = () => {
    setSelectedQuestions(prev => [...prev, {
      id: `temp-rule-${Date.now()}-${prev.length}`,
      paperId: id || '',
      questionId: null,
      sortOrder: prev.length,
      score: 10, // 默认分值；候选题分值必须与题位分值一致，教师按需修改
      slotType: 'rule' as SlotType,
      rule: { capabilityIds: [] },
      question: null,
    }]);
  };

  /** 切换题位类型：固定→抽题丢弃题目引用；抽题→固定等待在抽屉中选题 */
  const handleSlotTypeChange = (index: number, slotType: SlotType) => {
    setSelectedQuestions(prev => prev.map((pq, i) => {
      if (i !== index) return pq;
      if (slotType === 'rule') {
        return { ...pq, slotType, questionId: null, question: null, rule: { capabilityIds: [] } };
      }
      return { ...pq, slotType, rule: null, question: null, questionId: null };
    }));
  };

  const handleRuleChange = (index: number, patch: Partial<SlotRule>) => {
    setSelectedQuestions(prev => prev.map((pq, i) =>
      i === index && pq.slotType === 'rule'
        ? { ...pq, rule: { ...(pq.rule ?? {}), ...patch } }
        : pq,
    ));
  };

  const handleRemoveQuestion = (index: number) => {
    setSelectedQuestions(prev => prev.filter((_, i) => i !== index));
    // 移除的正好是待替换行时，清除待替换标记，避免下一次选题误替换别行
    // （待替换标记只在抽屉打开前设置，抽屉打开期间主表不可交互，这里是防御性兜底）
    if (pendingReplaceIndex !== null && pendingReplaceIndex === index) {
      setPendingReplaceIndex(null);
    }
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

  // 总分包含抽题题位分值（开考时抽出的题与题位分值一致，总卷面分不变）
  const totalScore = selectedQuestions.reduce((sum, pq) => sum + (pq.score || 0), 0);
  const questionCount = selectedQuestions.length;
  const fixedCount = selectedQuestions.filter((pq) => pq.slotType !== 'rule').length;
  const ruleCount = questionCount - fixedCount;
  const typeDistribution = selectedQuestions.reduce((acc, pq) => {
    const t = pq.slotType === 'rule' ? '抽题' : (pq.question?.type ?? '未选题');
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const selectedQuestionIds = new Set(selectedQuestions.map(pq => pq.questionId));

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

      {/* 组卷四步引导：题位/抽题/等值替换是系统自定义概念，页内常驻步骤说明降低教师上手成本 */}
      <div className="editor-guide">
        <span className="editor-guide__step"><b>1</b> 填写试卷信息</span>
        <span className="editor-guide__arrow">›</span>
        <span className="editor-guide__step"><b>2</b> 添加题位（固定题指定题目 / 抽题设置知识点、难度、题型条件）</span>
        <span className="editor-guide__arrow">›</span>
        <span className="editor-guide__step"><b>3</b> 确认每个题位候选池充足，并查看试卷分析</span>
        <span className="editor-guide__arrow">›</span>
        <span className="editor-guide__step"><b>4</b> 保存试卷</span>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="试卷名称" rules={[{ required: true }]}>
                <Input placeholder="如：多维表格基础操作考核" maxLength={50} showCount />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="difficulty" label="难度">
                <Select placeholder="选择难度" allowClear options={DIFFICULTY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="passScore" label="及格分">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="不设及格分" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="备注">
            <TextArea rows={3} placeholder="试卷备注（仅教师可见）" maxLength={300} showCount />
          </Form.Item>
        </Card>
      </Form>

      <Card title="已选题目" style={{ marginBottom: 16 }}
        extra={
          <Space>
            <span style={{ color: '#666' }}>
              共 {questionCount} 题，总分 {totalScore} 分
              {questionCount > 0 && (
                <span style={{ color: '#999' }}>（固定题 {fixedCount} · 抽题题位 {ruleCount}）</span>
              )}
            </span>
            <Button icon={<PlusOutlined />} onClick={() => { setDrawerOpen(true); setDrawerTab('select'); }}>添加题目</Button>
            <Button icon={<PlusOutlined />} onClick={handleAddRuleSlot}>添加抽题题位</Button>
          </Space>
        }
      >
        {selectedQuestions.length === 0 ? (
          <Empty description="暂未选题，点击右上角添加题目或抽题题位" />
        ) : (
          <Table dataSource={selectedQuestions} rowKey={r => r.id} pagination={false} size="small">
            <Table.Column title="序号" width={50} render={(_, __, i) => i + 1} />
            <Table.Column title="题位" width={120} render={(_, pq: PaperQuestion, index: number) => (
              <Segmented
                size="small"
                value={pq.slotType}
                onChange={v => handleSlotTypeChange(index, v as SlotType)}
                options={[{ label: '固定题', value: 'fixed' }, { label: '抽题', value: 'rule' }]}
              />
            )} />
            <Table.Column title="题目 / 抽题条件" render={(_, pq: PaperQuestion, index: number) => {
              if (pq.slotType === 'rule') {
                return (
                  <RuleSlotEditor
                    rule={pq.rule ?? {}}
                    score={pq.score || 0}
                    capabilities={capabilities}
                    onChange={patch => handleRuleChange(index, patch)}
                  />
                );
              }
              if (!pq.question) {
                // 抽题切回固定后尚未选题：引导去抽屉指定题目
                return (
                  <Space>
                    <Tag color="red">未指定题目</Tag>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => { setPendingReplaceIndex(index); setDrawerOpen(true); setDrawerTab('select'); }}
                    >
                      去选题
                    </Button>
                  </Space>
                );
              }
              return (
                <Space direction="vertical" size={0}>
                  <span>{pq.question.title}</span>
                  <Space size={4}>
                    <Tag color="blue">{QUESTION_TYPE_LABELS[pq.question.type] || pq.question.type}</Tag>
                    <Tag>{DIFFICULTY_LABELS[pq.question.difficulty] || pq.question.difficulty}</Tag>
                  </Space>
                </Space>
              );
            }} />
            <Table.Column title="分值" width={90} render={(_, pq: PaperQuestion, index: number) => (
              <InputNumber min={1} max={1000} value={pq.score} onChange={v => handleScoreChange(index, v || 0)} style={{ width: 80 }} />
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
        onClose={() => {
          setDrawerOpen(false);
          // 关抽屉即取消"待替换"状态，避免下次添加题目时误替换
          setPendingReplaceIndex(null);
        }}
        bodyStyle={{ padding: 0 }}
      >
        <Tabs activeKey={drawerTab} onChange={setDrawerTab} style={{ padding: '0 24px' }}>
          <TabPane tab="选题" key="select">
            {pendingReplaceIndex !== null && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={`当前在选择第 ${pendingReplaceIndex + 1} 题位的固定题目，点击"添加"将替换该题位`}
                action={<Button size="small" onClick={() => setPendingReplaceIndex(null)}>取消替换</Button>}
              />
            )}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={6}>
                <Tree
                  treeData={buildTreeData(categories)}
                  selectedKeys={selectedCategory ? [selectedCategory.id] : []}
                  expandedKeys={expandedKeys}
                  onExpand={keys => setExpandedKeys(keys as string[])}
                  onSelect={keys => {
                    const id = keys[0] as string;
                    if (id) {
                      setSelectedCategory({ id, level: categoryMap.get(id) || 1 });
                    } else {
                      setSelectedCategory(null);
                    }
                  }}
                  style={{ maxHeight: 500, overflow: 'auto', border: '1px solid #f0f0f0', padding: 8 }}
                />
              </Col>
              <Col span={18}>
                <Table dataSource={allQuestions} rowKey="id" size="small" pagination={{ pageSize: 10 }}
                  columns={[
                    { title: '题型', dataIndex: 'type', width: 100, render: (v: string) => <Tag>{QUESTION_TYPE_LABELS[v] || v}</Tag> },
                    { title: '题目', dataIndex: 'title', ellipsis: true },
                    { title: '难度', dataIndex: 'difficulty', width: 80, render: (v: string) => DIFFICULTY_LABELS[v] || v },
                    { title: '分值', dataIndex: 'score', width: 60 },
                    { title: '分类', dataIndex: ['primaryCategory', 'name'], width: 120, render: (v: string) => v || '-' },
                    { title: '操作', width: 80, render: (_: any, q: Question) =>
                      selectedQuestionIds.has(q.id) ? (
                        <Button size="small" disabled>已添加</Button>
                      ) : (
                        <Button size="small" type="primary" onClick={() => handleAddQuestion(q)}>
                          {pendingReplaceIndex !== null ? '替换' : '添加'}
                        </Button>
                      )
                    },
                  ]}
                />
              </Col>
            </Row>
          </TabPane>

          <TabPane tab="已选试题" key="selected">
            <Table dataSource={selectedQuestions} rowKey={r => r.id} pagination={false} size="small">
              <Table.Column title="序号" width={60} render={(_, __, i) => i + 1} />
              <Table.Column title="题型" width={100} render={(_, pq: PaperQuestion) => (
                pq.slotType === 'rule'
                  ? <Tag color="purple">抽题</Tag>
                  : <Tag>{pq.question ? (QUESTION_TYPE_LABELS[pq.question.type] || pq.question.type) : '未选题'}</Tag>
              )} />
              <Table.Column title="题目 / 抽题条件" render={(_, pq: PaperQuestion) => (
                pq.slotType === 'rule'
                  ? <Text type="secondary">按条件抽题：{describeRule(pq.rule)}</Text>
                  : <span>{pq.question?.title ?? <Tag color="red">未指定题目</Tag>}</span>
              )} />
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
                <Tag key={type} color={type === '抽题' ? 'purple' : 'blue'}>{type}: {count} 题</Tag>
              ))}
            </Space>
          </TabPane>

          <TabPane tab="整卷预览" key="preview">
            {selectedQuestions.map((pq, i) => (
              <Card key={pq.id} size="small" style={{ marginBottom: 8 }}>
                {pq.slotType === 'rule' ? (
                  <>
                    <div>
                      <strong>{i + 1}. 【抽题】</strong>
                      <Tag color="purple" style={{ marginLeft: 8 }}>{describeRule(pq.rule)}</Tag>
                      <Tag color="blue">{pq.score}分</Tag>
                    </div>
                    <div style={{ color: '#666', marginTop: 4 }}>开考时从题库中按条件随机抽 1 道题（同知识点等值替换）</div>
                  </>
                ) : (
                  <>
                    <div><strong>{i + 1}. {pq.question?.title ?? '（未指定题目）'}</strong> <Tag color="blue">{pq.score}分</Tag></div>
                    <div style={{ color: '#666', marginTop: 4 }}>{pq.question?.description}</div>
                  </>
                )}
              </Card>
            ))}
          </TabPane>
        </Tabs>
      </Drawer>
    </div>
  );
}
