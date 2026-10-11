import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Select, InputNumber, Button, Card, Space, Tag, message, Spin, Row, Col, Tooltip, Radio, Checkbox, Alert } from 'antd';
import { SaveOutlined, SettingOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Question, QuestionCategory, AnswerRule, QuestionSkeleton, ReverseOutput, RuleSuggestion, Proposal, QuestionState, QuestionType, ObjectiveAnswer, ObjectiveOption, SchemaRefs } from '../../types';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';
import { CapabilitySelector } from './components/CapabilitySelector';
import { AnswerImporter } from './components/AnswerImporter';
import { RulePreviewer } from './components/RulePreviewer';
import { CoachingPanel } from './components/CoachingPanel';
import { applyProposal, type QuestionStateForApply } from './components/applyProposal';

const { TextArea } = Input;

/** 客观题题型集合（与 server 端 OBJECTIVE_TYPES 对齐）：配客观题答案，不走判分规则编辑器 */
const OBJECTIVE_TYPES: QuestionType[] = ['single_choice', 'multiple_choice', 'true_false'];

/** 题型选项：实操题保持原有 5 种 + 新增 3 种客观题 */
const QUESTION_TYPE_OPTIONS = [
  {
    label: '实操题',
    options: [
      { value: 'create_table', label: '创建数据表' },
      { value: 'add_field', label: '添加字段' },
      { value: 'config_view', label: '配置视图' },
      { value: 'create_form', label: '创建表单' },
      { value: 'comprehensive', label: '综合实操' },
    ],
  },
  {
    label: '客观题',
    options: [
      { value: 'single_choice', label: '单选题' },
      { value: 'multiple_choice', label: '多选题' },
      { value: 'true_false', label: '判断题' },
    ],
  },
];

/**
 * 客观题答案本地校验：与服务端 validateObjectiveAnswer 同口径，
 * 保存前拦截，报错直接指出哪一项不对。
 * 为什么要在前端再拦一遍：配错的题一旦进考试，学生按错误答案被扣分，事后只能人工复核。
 */
function validateObjectiveAnswerLocal(type: QuestionType | undefined, answer: ObjectiveAnswer | null): string | null {
  if (!type || !OBJECTIVE_TYPES.includes(type)) return null; // 实操题不校验
  if (!answer) return '客观题必须配置正确答案';
  if (answer.options.length < 2) return '至少 2 个选项';
  const keys = answer.options.map(o => o.key);
  if (new Set(keys).size !== keys.length) return '选项标识不能重复';
  const emptyIndex = answer.options.findIndex(o => !o.text.trim());
  if (emptyIndex >= 0) return `第 ${emptyIndex + 1} 个选项（${keys[emptyIndex]}）内容为空`;
  const unknown = answer.correct.filter(c => !keys.includes(c));
  if (unknown.length > 0) return `正确选项 ${unknown.join('、')} 不在选项列表中`;
  if (answer.correct.length < 1) return '至少要指定 1 个正确选项';
  if ((type === 'single_choice' || type === 'true_false') && answer.correct.length !== 1) {
    return type === 'true_false' ? '判断题只能有一个正确选项' : '单选题只能有一个正确选项';
  }
  return null;
}

/** 取下一个可用选项 key（自动分配 A/B/C…；删除后留下的空位会被复用，保证 key 永远唯一） */
function nextOptionKey(options: ObjectiveOption[]): string | null {
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!options.some(o => o.key === letter)) return letter;
  }
  return null; // 超过 26 个选项（与服务端 max 26 对齐）
}

/**
 * 将已保存的 AnswerRule 包装为 RuleSuggestion，供 RulePreviewer 展示。
 * 编辑模式加载时使用：让用户可在三段式 UI 中继续编辑已保存的规则。
 */
function rulesToSuggestions(rules: AnswerRule[]): RuleSuggestion[] {
  return rules.map(rule => ({
    rule,
    source: {
      sheetName: '(已保存规则)',
      sheetId: 0,
      capabilityId: '',
    },
    editable: false,
    selected: true,
    missingParams: [],
  }));
}

export function QuestionEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  /** 最终将保存到题目的 answerRules */
  const [rules, setRules] = useState<AnswerRule[]>([]);
  /** 反向生成的规则建议（待确认） */
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  /** 用户勾选的能力 id */
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<string[]>([]);
  /** 客观题答案（客观题题型下编辑；实操题保持 null） */
  const [objectiveAnswer, setObjectiveAnswer] = useState<ObjectiveAnswer | null>(null);
  /** 实操题引用声明（抽题等值校验依据，选填） */
  const [schemaRefs, setSchemaRefs] = useState<SchemaRefs | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  /** Phase 2：WPS 凭据（上提自 AnswerImporter，供 CoachingPanel 共用） */
  const [credentials, setCredentials] = useState<{ fileId: string; accessToken: string; apiSecret?: string } | null>(null);
  const isEdit = !!id;
  const primaryCategoryId = Form.useWatch('primaryCategoryId', form);
  /** 当前题型（决定显示判分规则编辑器还是选项编辑器） */
  const questionType = (Form.useWatch('type', form) as QuestionType | undefined) || 'comprehensive';
  const isObjective = OBJECTIVE_TYPES.includes(questionType);

  useEffect(() => {
    // ✅ 获取分类列表并扁平化（用于两级分类选择）
    api.get('/categories?mode=tree')
      .then(res => {
        const treeData = res.data?.data || [];
        // 扁平化树形数据，保留 level 和 parentId
        const flattenCategories = (cats: any[], level: number = 1): QuestionCategory[] => {
          return cats.reduce((acc: QuestionCategory[], cat: any) => {
            acc.push({ ...cat, level, children: cat.children || [] });
            if (cat.children && cat.children.length > 0) {
              acc.push(...flattenCategories(cat.children, level + 1));
            }
            return acc;
          }, []);
        };
        setCategories(flattenCategories(treeData));
      })
      .catch(() => {});

    if (isEdit) {
      setLoading(true);
      api.get(`/questions/${id}`).then(res => {
        const q: Question = res.data;
        form.setFieldsValue({
          ...q,
          // 确保新字段正确映射
          primaryCategoryId: q.primaryCategoryId,
          secondaryCategoryId: q.secondaryCategoryId,
          teacherName: q.teacherName,
        });
        const savedRules = q.answerRules || [];
        setRules(savedRules);
        // 将已保存规则包装为 suggestions，便于在 RulePreviewer 中继续编辑
        setSuggestions(rulesToSuggestions(savedRules));
        // 回填新增字段：知识点打标 / 客观题答案 / 引用声明
        setSelectedCapabilityIds(q.capabilityIds || []);
        setObjectiveAnswer(q.objectiveAnswer ?? null);
        setSchemaRefs(q.schemaRefs ?? null);
      }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
    }
  }, [id]);

  /** 能力变化时清空建议（能力变了需重新反向生成） */
  const handleCapabilityChange = (ids: string[]) => {
    setSelectedCapabilityIds(ids);
    // 若已有反向生成的建议且当前未应用过，清空以避免不一致
    if (suggestions.some(s => s.source.capabilityId)) {
      setSuggestions(suggestions.filter(s => !s.source.capabilityId));
    }
  };

  /** 题型切换：判断题自动给「正确/错误」两个选项；客观题初始化空选项编辑器 */
  const handleTypeChange = (t: QuestionType) => {
    if (t === 'true_false' && (!objectiveAnswer || objectiveAnswer.options.length === 0)) {
      setObjectiveAnswer({ options: [{ key: 'A', text: '正确' }, { key: 'B', text: '错误' }], correct: [] });
    } else if (OBJECTIVE_TYPES.includes(t) && !objectiveAnswer) {
      setObjectiveAnswer({ options: [], correct: [] });
    }
  };

  /** 添加选项（自动分配 A/B/C… key） */
  const handleAddOption = () => {
    if (!objectiveAnswer) return;
    const key = nextOptionKey(objectiveAnswer.options);
    if (!key) {
      message.warning('最多支持 26 个选项');
      return;
    }
    setObjectiveAnswer({ ...objectiveAnswer, options: [...objectiveAnswer.options, { key, text: '' }] });
  };

  /** 删除选项：同步从 correct 中移除（否则正确答案悬空，保存会被拦截） */
  const handleRemoveOption = (key: string) => {
    if (!objectiveAnswer) return;
    setObjectiveAnswer({
      ...objectiveAnswer,
      options: objectiveAnswer.options.filter(o => o.key !== key),
      correct: objectiveAnswer.correct.filter(c => c !== key),
    });
  };

  /** 修改选项文字 */
  const handleOptionTextChange = (key: string, text: string) => {
    if (!objectiveAnswer) return;
    setObjectiveAnswer({
      ...objectiveAnswer,
      options: objectiveAnswer.options.map(o => (o.key === key ? { ...o, text } : o)),
    });
  };

  /** 勾选正确项（单选/判断 Radio 传单值，多选 Checkbox 传数组） */
  const handleCorrectChange = (correct: string[]) => {
    if (!objectiveAnswer) return;
    setObjectiveAnswer({ ...objectiveAnswer, correct });
  };

  /** 引用声明归一化：全部为空时按 null 保存，避免题库里存一堆空对象 */
  const normalizeSchemaRefs = (): SchemaRefs | null => {
    if (!schemaRefs) return null;
    const tables = (schemaRefs.tables || []).map(t => t.trim()).filter(Boolean);
    const fields = (schemaRefs.fields || []).map(t => t.trim()).filter(Boolean);
    if (tables.length === 0 && fields.length === 0) return null;
    return { ...(tables.length > 0 ? { tables } : {}), ...(fields.length > 0 ? { fields } : {}) };
  };

  /** 骨架生成成功：回填标题/描述/分值/难度 */
  const handleSkeleton = (skeleton: QuestionSkeleton) => {
    form.setFieldsValue({
      title: skeleton.title,
      description: skeleton.description,
      score: skeleton.suggestedScore,
      difficulty: skeleton.difficulty,
    });
    if (skeleton.warnings.length > 0) {
      message.warning(skeleton.warnings.join('；'));
    }
  };

  /** 反向生成成功：覆盖 suggestions */
  const handleGenerated = (output: ReverseOutput) => {
    setSuggestions(output.suggestions);
  };

  /** 应用选中规则到题目 answerRules */
  const handleApplyRules = (appliedRules: AnswerRule[]) => {
    setRules(appliedRules);
  };

  /** Phase 2：从表单 + 状态拼装 QuestionState（每次渲染时构建，保证 CoachingPanel 拿到最新） */
  const buildQuestionState = useCallback((): QuestionState => {
    const values = form.getFieldsValue(true);
    return {
      title: values.title || '',
      description: values.description || '',
      type: values.type || 'comprehensive',
      difficulty: values.difficulty || 'medium',
      score: values.score ?? 0,
      selectedCapabilityIds,
      currentRules: rules.map(r => ({
        id: r.id,
        action: r.action,
        tableName: r.params?.tableName,
        fieldName: r.params?.fieldName,
        score: r.score,
      })),
      hints: values.hints || '',
    };
  }, [form, selectedCapabilityIds, rules]);

  /** Phase 2：应用 AI 建议卡（包装纯函数 applyProposal，含 React state setters） */
  const handleApplyProposal = useCallback((proposal: Proposal): { ok: boolean; reason?: string } => {
    const snapshot: QuestionStateForApply = {
      selectedCapabilityIds,
      suggestions,
      rules,
      description: form.getFieldValue('description') || '',
      hints: form.getFieldValue('hints') || '',
    };
    const result = applyProposal(snapshot, proposal);
    if (!result.ok) return { ok: false, reason: result.reason };
    const { newState } = result;
    if (newState.selectedCapabilityIds) setSelectedCapabilityIds(newState.selectedCapabilityIds);
    if (newState.suggestions) setSuggestions(newState.suggestions);
    if (newState.rules) setRules(newState.rules);
    if (newState.description !== undefined) form.setFieldsValue({ description: newState.description });
    if (newState.hints !== undefined) form.setFieldsValue({ hints: newState.hints });
    return { ok: true };
  }, [form, selectedCapabilityIds, suggestions, rules]);

  const onFinish = async (values: any) => {
    const type: QuestionType = values.type || 'comprehensive';
    const objective = OBJECTIVE_TYPES.includes(type);
    // 保存前本地校验：与服务端口径一致，提前指出哪一项不对
    const objectiveError = validateObjectiveAnswerLocal(type, objective ? objectiveAnswer : null);
    if (objectiveError) {
      message.error(objectiveError);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...values,
        type,
        // 客观题不带判分规则（判分规则编辑器只对实操题出现）；实操题不带客观题答案
        answerRules: objective ? [] : rules,
        // 知识点打标：抽题组卷按它做同知识点等值替换，不打标就无法被抽中
        capabilityIds: selectedCapabilityIds,
        objectiveAnswer: objective ? objectiveAnswer : null,
        schemaRefs: objective ? null : normalizeSchemaRefs(),
      };
      if (isEdit) {
        await api.put(`/questions/${id}`, payload);
        message.success('更新成功');
      } else {
        const res = await api.post('/questions', payload);
        message.success('创建成功');
        navigate(`/teacher/questions/${res.data.id}/edit`);
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  return (
    <div className="page-container" style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{isEdit ? '编辑题目' : '新建题目'}</h2>
        <Space>
          <Button onClick={() => navigate('/teacher/questions')}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={saving}>保存</Button>
        </Space>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ type: 'comprehensive', difficulty: 'medium', score: 10, tags: [] }}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="题目标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：创建学生档案表" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              {/* 题型决定下方出现「判分规则编辑器」（实操题）还是「选项编辑器」（客观题） */}
              <Form.Item name="type" label="题型" rules={[{ required: true, message: '请选择题型' }]}>
                <Select options={QUESTION_TYPE_OPTIONS} onChange={handleTypeChange} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="difficulty" label="难度" rules={[{ required: true }]}>
                <Select options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="score" label="分值" rules={[{ required: true }]}>
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {/* ✅ 替换为两级分类选择（带编辑按钮） */}
          <Row gutter={16} align="middle">
            <Col span={10}>
              <Form.Item name="primaryCategoryId" label="一级分类" style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="选择一级分类"
                  onChange={() => {
                    // 清空二级分类
                    form.setFieldsValue({ secondaryCategoryId: undefined });
                  }}
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={categories.filter(c => c.level === 1 || !c.parentId).map(c => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
              </Form.Item>
            </Col>

            <Col span={2}>
              <div style={{ paddingTop: 29 }}>
                <Tooltip title="编辑知识点分类">
                  <Button
                    type="text"
                    icon={<SettingOutlined />}
                    onClick={() => setCategoryModalVisible(true)}
                    style={{
                      color: '#1677ff',
                      border: '1px solid #1677ff33',
                      borderRadius: 6,
                      height: 32,
                      width: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  />
                </Tooltip>
              </div>
            </Col>

            <Col span={12}>
              <Form.Item name="secondaryCategoryId" label="二级分类" style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="先选择一级分类"
                  disabled={!primaryCategoryId}
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={
                    categories
                      .filter(cat => cat.parentId === primaryCategoryId)
                      .map(sub => ({
                        value: sub.id,
                        label: sub.name,
                      }))
                  }
                />
              </Form.Item>
            </Col>
          </Row>

          {/* ✅ 新增：出题老师字段 */}
          <Form.Item
            name="teacherName"
            label="出题老师"
            tooltip="留空则自动使用当前登录用户姓名"
          >
            <Input
              placeholder="输入出题老师姓名（可选）"
              maxLength={64}
            />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="输入标签后回车" />
          </Form.Item>
        </Card>

        <Card title="题目内容" style={{ marginBottom: 16 }}>
          <Form.Item name="description" label="题目描述" rules={[{ required: true, message: '请输入题目描述' }]}>
            <TextArea rows={5} placeholder="详细描述题目要求，如：请创建一个名为「学生档案」的数据表，并添加以下字段..." />
          </Form.Item>
          <Form.Item name="hints" label="提示（选填）">
            <TextArea rows={2} placeholder="给学生的操作提示" />
          </Form.Item>
        </Card>

        {/* 客观题：选项编辑器（替换判分规则编辑器） */}
        {isObjective && (
          <Card
            title={
              <Space>
                <span>选项与答案</span>
                <Tag color="blue">{objectiveAnswer?.options.length ?? 0} 个选项</Tag>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={questionType === 'multiple_choice'
                ? '多选题可勾选多个正确项（至少 1 个）；保存前必须配好答案，学生按此判分'
                : '单选题/判断题只能勾选 1 个正确项；保存前必须配好答案，学生按此判分'}
            />
            {(objectiveAnswer?.options ?? []).map(opt => (
              <div key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 28, textAlign: 'center', fontWeight: 600, color: '#1677ff' }}>{opt.key}</span>
                <Input
                  placeholder={`选项 ${opt.key} 内容`}
                  value={opt.text}
                  onChange={e => handleOptionTextChange(opt.key, e.target.value)}
                  style={{ flex: 1 }}
                />
                {questionType === 'multiple_choice' ? (
                  // 多选：Checkbox 勾选，允许 ≥1 个正确项
                  <Checkbox
                    checked={(objectiveAnswer?.correct ?? []).includes(opt.key)}
                    onChange={e => {
                      const correct = objectiveAnswer?.correct ?? [];
                      handleCorrectChange(e.target.checked ? [...correct, opt.key] : correct.filter(c => c !== opt.key));
                    }}
                  >
                    正确
                  </Checkbox>
                ) : (
                  // 单选/判断：Radio 保证恰好 1 个正确项
                  <Radio
                    checked={(objectiveAnswer?.correct ?? [])[0] === opt.key}
                    onChange={() => handleCorrectChange([opt.key])}
                  >
                    正确
                  </Radio>
                )}
                {/* 至少保留 2 个选项（服务端校验同口径），最后两个禁止删除 */}
                <Tooltip title={(objectiveAnswer?.options.length ?? 0) <= 2 ? '客观题至少需要 2 个选项' : `删除选项 ${opt.key}`}>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={(objectiveAnswer?.options.length ?? 0) <= 2}
                    onClick={() => handleRemoveOption(opt.key)}
                  />
                </Tooltip>
              </div>
            ))}
            <Button
              icon={<PlusOutlined />}
              onClick={handleAddOption}
              disabled={(objectiveAnswer?.options.length ?? 0) >= 26}
            >
              添加选项
            </Button>
          </Card>
        )}

        {/* ✅ 三段式出题辅助：能力选择 → 标准答案导入 → 规则预览（仅实操题走 ② ③ 段） */}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="题目按勾选的知识点参与抽题组卷（同知识点等值替换）：未打知识点标签的题目不会被抽中。"
        />
        <CapabilitySelector
          selectedIds={selectedCapabilityIds}
          onChange={handleCapabilityChange}
        />
        {!isObjective && (
          <>
            <AnswerImporter
              selectedCapabilityIds={selectedCapabilityIds}
              onSkeleton={handleSkeleton}
              onGenerated={handleGenerated}
              onCredentialsChange={setCredentials}
            />
            <RulePreviewer
              suggestions={suggestions}
              onChange={setSuggestions}
              onApply={handleApplyRules}
            />

            {/* ✅ 已应用规则汇总（展示当前将保存的 answerRules） */}
            {rules.length > 0 && (
              <Card
                title={<Space><span>已应用规则</span><Tag color="green">{rules.length} 条</Tag><Tag color="blue">总分 {rules.reduce((s, r) => s + r.score, 0)}</Tag></Space>}
                style={{ marginBottom: 16 }}
              >
                {rules.map(rule => (
                  <Tag key={rule.id} style={{ marginBottom: 4 }}>
                    {rule.action} · {rule.score}分
                  </Tag>
                ))}
              </Card>
            )}

            {/* 引用声明：抽题组卷等值校验依据（选填，但题目操作具体表/字段时建议必填） */}
            <Card
              title={<Space><span>引用声明</span><Tag color="geekblue">抽题等值校验依据</Tag></Space>}
              style={{ marginBottom: 16 }}
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="抽题组卷要求同题位候选题引用相同的表/字段（每个学生的表格结构不同，声明不一致的题混抽会导致部分学生做不了）。题目让学生创建或修改具体表/字段时请务必填写。"
              />
              <Row gutter={16}>
                <Col span={12}>
                  <div style={{ marginBottom: 4 }}>表名（回车添加，可多个）</div>
                  <Select
                    mode="tags"
                    placeholder="如：学生档案"
                    value={schemaRefs?.tables ?? []}
                    onChange={v => setSchemaRefs(s => ({ ...(s ?? {}), tables: v }))}
                    style={{ width: '100%' }}
                    tokenSeparators={[',', '，']}
                  />
                </Col>
                <Col span={12}>
                  <div style={{ marginBottom: 4 }}>字段名（回车添加，可多个）</div>
                  <Select
                    mode="tags"
                    placeholder="如：姓名、学号"
                    value={schemaRefs?.fields ?? []}
                    onChange={v => setSchemaRefs(s => ({ ...(s ?? {}), fields: v }))}
                    style={{ width: '100%' }}
                    tokenSeparators={[',', '，']}
                  />
                </Col>
              </Row>
            </Card>
          </>
        )}
      </Form>

      {/* ✨ 知识点分类管理弹窗 */}
      <CategoryManagerModal
        visible={categoryModalVisible}
        onClose={() => {
          setCategoryModalVisible(false);
          // 刷新分类列表
          api.get('/categories?mode=tree')
            .then(res => {
              // 转换为扁平列表格式
              const treeData = res.data?.data || [];
              const flattenCategories = (cats: any[], level: number = 1): QuestionCategory[] => {
                return cats.reduce((acc: QuestionCategory[], cat: any) => {
                  acc.push({
                    ...cat,
                    level,
                    children: cat.children || [],
                  });
                  if (cat.children && cat.children.length > 0) {
                    acc.push(...flattenCategories(cat.children, level + 1));
                  }
                  return acc;
                }, []);
              };
              setCategories(flattenCategories(treeData));
            })
            .catch(() => {});
        }}
      />

      {/* ✨ Phase 2：AI 对话式教练侧栏（仅实操题渲染；客观题没有规则可练） */}
      {!isObjective && (
        <CoachingPanel
          questionState={buildQuestionState()}
          credentials={credentials || undefined}
          onApplyProposal={handleApplyProposal}
        />
      )}
    </div>
  );
}
