import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Select, InputNumber, Button, Card, Space, Tag, message, Spin, Row, Col, Tooltip } from 'antd';
import { SaveOutlined, SettingOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Question, QuestionCategory, AnswerRule, QuestionSkeleton, ReverseOutput, RuleSuggestion, Proposal, QuestionState } from '../../types';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';
import { CapabilitySelector } from './components/CapabilitySelector';
import { AnswerImporter } from './components/AnswerImporter';
import { RulePreviewer } from './components/RulePreviewer';
import { CoachingPanel } from './components/CoachingPanel';
import { applyProposal, type QuestionStateForApply } from './components/applyProposal';

const { TextArea } = Input;

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  /** Phase 2：WPS 凭据（上提自 AnswerImporter，供 CoachingPanel 共用） */
  const [credentials, setCredentials] = useState<{ fileId: string; accessToken: string; apiSecret?: string } | null>(null);
  const isEdit = !!id;
  const primaryCategoryId = Form.useWatch('primaryCategoryId', form);

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
    setSaving(true);
    try {
      const payload = { ...values, answerRules: rules };
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

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ difficulty: 'medium', score: 10, tags: [] }}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="题目标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：创建学生档案表" />
          </Form.Item>
          <Row gutter={16}>
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

        {/* ✅ 三段式出题辅助：能力选择 → 标准答案导入 → 规则预览 */}
        <CapabilitySelector
          selectedIds={selectedCapabilityIds}
          onChange={handleCapabilityChange}
        />
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

      {/* ✨ Phase 2：AI 对话式教练侧栏（仅实操题渲染，本编辑器全为实操题） */}
      <CoachingPanel
        questionState={buildQuestionState()}
        credentials={credentials || undefined}
        onApplyProposal={handleApplyProposal}
      />
    </div>
  );
}
