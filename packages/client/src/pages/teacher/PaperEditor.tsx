import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Form, Input, Select, Button, Card, message, Spin, Space, Row, Col,
  Modal, Tag, InputNumber, Popconfirm, Empty, Table, Popover,
} from 'antd';
import {
  ArrowLeftOutlined, PlusOutlined, DeleteOutlined, ArrowUpOutlined, ArrowDownOutlined,
  BarChartOutlined, EyeOutlined, SaveOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import { questionTypeLabel } from '../../utils/questionLabels';
import {
  itemsFromSlots, slotsFromItems, validateEditorItems, analyzeItems,
  difficultyBreakdown, nextEditorKey, ruleItemTotal, DIFFICULTY_LABELS,
  type EditorItem, type FixedEditorItem, type RuleEditorItem,
} from '../../utils/paperAssembly';
import type { Capability, Paper, Question } from '../../types';
import { QuestionSelectPanel } from './components/QuestionSelectPanel';
import { RuleItemEditor } from './components/RuleItemEditor';

const { TextArea } = Input;

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

/**
 * 组卷编辑器
 *
 * 版式对齐参考产品「新建试卷」：顶部返回 + 右侧（选题/试卷分析/整卷预览/保存），
 * 基础信息卡片 → 试卷题目区（共 N 题 · 共 M 分 · 及格分 → 题干行 / 抽题规则行）
 * → 选题页（整页切换，QuestionSelectPanel）。
 *
 * 与参考产品的差异（我们独有的模型，保留）：
 * - 试卷可以**混排**固定题与抽题规则：规则行承载"简单/中等/困难各抽几道"，
 *   保存时展开成逐个题位（开考时 paper-generator 按题位为每名学生抽等值题并去重）。
 * - 「启用状态/公开状态」两个开关我们没有对应字段，未做。
 */
export function PaperEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'edit' | 'select'>('edit');
  const [items, setItems] = useState<EditorItem[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isEdit = !!id;

  useEffect(() => {
    // 能力图谱：规则行"抽题范围"多选框的选项（与出题打标同一份，保证 id 一致可匹配）
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
        setItems(itemsFromSlots(p.paperQuestions || []));
        if (searchParams.get('tab') === 'preview') {
          setPreviewOpen(true);
        }
      }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 编辑行操作 ─────────────────────────────────────────────

  const patchItem = useCallback((key: string, patch: Partial<RuleEditorItem>) => {
    setItems(prev => prev.map(it => (it.kind === 'rule' && it.key === key ? { ...it, ...patch } : it)));
  }, []);

  const handleRemoveItem = (key: string) => {
    setItems(prev => prev.filter(it => it.key !== key));
  };

  const handleMoveItem = (key: string, dir: -1 | 1) => {
    setItems(prev => {
      const idx = prev.findIndex(it => it.key === key);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleAddRuleItem = () => {
    setItems(prev => [...prev, {
      kind: 'rule',
      key: nextEditorKey('rule'),
      ruleType: undefined,
      capabilityIds: [],
      score: 10, // 默认分值；候选题分值必须与规则分值一致，教师按题库实际情况修改
      counts: { easy: 0, medium: 0, hard: 0 },
      noDifficultyCount: 0,
    }]);
  };

  const handleFixedScoreChange = (key: string, score: number) => {
    setItems(prev => prev.map(it => (it.kind === 'fixed' && it.key === key ? { ...it, score } : it)));
  };

  // ── 选题（引用/取消引用）──────────────────────────────────

  const fixedItems = items.filter((it): it is FixedEditorItem => it.kind === 'fixed');
  const ruleItems = items.filter((it): it is RuleEditorItem => it.kind === 'rule');
  const fixedIds = new Set(fixedItems.map(it => it.questionId));

  const handleQuote = useCallback((q: Question) => {
    setItems(prev => {
      if (prev.some(it => it.kind === 'fixed' && it.questionId === q.id)) return prev;
      return [...prev, {
        kind: 'fixed', key: nextEditorKey('fixed'), questionId: q.id, question: q, score: q.score,
      }];
    });
  }, []);

  const handleUnquote = useCallback((questionId: string) => {
    setItems(prev => prev.filter(it => !(it.kind === 'fixed' && it.questionId === questionId)));
  }, []);

  const handleRemoveFixedGroup = (type: string) => {
    setItems(prev => prev.filter(it => !(it.kind === 'fixed' && (it.question?.type ?? 'unset') === type)));
  };

  const handleClearFixed = () => {
    setItems(prev => prev.filter(it => it.kind !== 'fixed'));
  };

  // ── 保存 ───────────────────────────────────────────────────

  const onFinish = async (values: any) => {
    // 与服务端口径一致的前置校验（规则数量超过可用题数、空规则行等在这里拦下）
    const errors = validateEditorItems(items);
    if (errors.length > 0) {
      message.error(errors[0]);
      return;
    }
    setSaving(true);
    try {
      let paperId = id;
      const payload = {
        name: values.name,
        // 显式 null：清空备注/难度后要真正清掉；服务端 paperSchema 已允许 null
        description: values.description ?? null,
        difficulty: values.difficulty ?? null,
        passScore: values.passScore ?? null,
      };
      if (isEdit) {
        await api.put(`/papers/${id}`, payload);
      } else {
        const res = await api.post('/papers', payload);
        paperId = res.data.id;
      }
      // 题位提交：规则行在这里展开（每个难度数量 → 一个固定难度的题位）
      await api.put(`/papers/${paperId}/questions`, { questionIds: slotsFromItems(items) });
      message.success(isEdit ? '更新成功' : '创建成功');
      navigate('/teacher/papers');
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ── 派生数据 ───────────────────────────────────────────────

  const analysis = analyzeItems(items);
  const cartDifficulty = difficultyBreakdown(fixedItems);
  const fixedByType = fixedItems.reduce((acc, it) => {
    const type = it.question?.type ?? 'unset';
    acc.set(type, (acc.get(type) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  const analysisModal = (
    <Modal
      title="试卷分析"
      open={analysisOpen}
      onCancel={() => setAnalysisOpen(false)}
      footer={null}
      width={760}
    >
      <div style={{ display: 'flex', gap: 24, margin: '8px 0 16px', color: '#333' }}>
        <span>总题数: {analysis.totalQuestions}</span>
        <span>总分: {analysis.totalScore}</span>
        <span>及格分: {form.getFieldValue('passScore') ?? 0}</span>
      </div>
      <Table
        dataSource={analysis.rows}
        rowKey="key"
        pagination={false}
        size="small"
        locale={{ emptyText: '暂无题目' }}
      >
        <Table.Column title="题型" dataIndex="label" />
        <Table.Column title="题目数（占比）" width={140} render={(_: unknown, r) => `${r.count}（${r.countPct}%）`} />
        <Table.Column title="分值（占比）" width={140} render={(_: unknown, r) => `${r.score}（${r.scorePct}%）`} />
        <Table.Column
          title="题号"
          width={220}
          render={(_: unknown, r) => r.indexes.map((i: number) => <Tag key={i} style={{ marginRight: 4 }}>{i}</Tag>)}
        />
      </Table>
    </Modal>
  );

  const previewModal = (
    <Modal
      title="整卷预览"
      open={previewOpen}
      onCancel={() => setPreviewOpen(false)}
      footer={null}
      width={800}
    >
      {items.length === 0 ? <Empty description="暂无题目" /> : items.map((item, i) => (
        <Card key={item.key} size="small" style={{ marginBottom: 8 }}>
          {item.kind === 'fixed' ? (
            <>
              <div>
                <strong>{i + 1}. {item.question ? questionTypeLabel(item.question.type) : '固定题'}：{item.question?.title ?? '（未指定题目）'}</strong>
                <Tag color="blue" style={{ marginLeft: 8 }}>{item.score} 分</Tag>
              </div>
              {item.question?.description && (
                <div style={{ color: '#666', marginTop: 4, whiteSpace: 'pre-wrap' }}>{item.question.description}</div>
              )}
            </>
          ) : (
            <>
              <div>
                <strong>{i + 1}. 【抽题规则】{item.ruleType ? questionTypeLabel(item.ruleType) : '不限题型'}</strong>
                <Tag color="blue" style={{ marginLeft: 8 }}>每题 {item.score} 分</Tag>
                <Tag color="purple">共 {ruleItemTotal(item)} 题</Tag>
              </div>
              <div style={{ color: '#666', marginTop: 4 }}>
                范围：{item.capabilityIds.length > 0 ? `知识点 ${item.capabilityIds.length} 个` : '全部知识点'}；
                难度：简单 ×{item.counts.easy}、中等 ×{item.counts.medium}、困难 ×{item.counts.hard}
                {item.noDifficultyCount > 0 ? `；旧规则 ×${item.noDifficultyCount}（不限难度）` : ''}
                。开考时按条件为每位学生抽取等值题目（同卷不重复）。
              </div>
            </>
          )}
        </Card>
      ))}
    </Modal>
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  // ── 选题模式（整页，对齐参考产品的「选题」页）─────────────

  if (mode === 'select') {
    return (
      <div className="page-container">
        <QuestionSelectPanel
          selectedIds={fixedIds}
          onQuote={handleQuote}
          onUnquote={handleUnquote}
          onBack={() => setMode('edit')}
          headerRight={
            <>
              <Popover
                trigger="click"
                placement="bottomRight"
                content={
                  <div style={{ width: 300 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>已选 <b>{fixedItems.length}</b> 道题</span>
                      <Popconfirm title="清空已引用的题目？" onConfirm={handleClearFixed} okText="清空" cancelText="取消">
                        <a style={{ fontSize: 12 }}>清空</a>
                      </Popconfirm>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
                      题目难度：简单（{cartDifficulty.easy}）、中等（{cartDifficulty.medium}）、困难（{cartDifficulty.hard}）
                    </div>
                    {ruleItems.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>
                        另有抽题规则 {ruleItems.length} 条（共 {analysis.totalQuestions - fixedItems.length} 题），在编辑页管理
                      </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      {Array.from(fixedByType.entries()).map(([type, count]) => (
                        <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderTop: '1px solid #f0f0f0' }}>
                          <span>{type === 'unset' ? '未指定题型' : questionTypeLabel(type)} <b>{count}</b> 道</span>
                          <Popconfirm
                            title={`移除全部「${type === 'unset' ? '未指定题型' : questionTypeLabel(type)}」？`}
                            onConfirm={() => handleRemoveFixedGroup(type)}
                            okText="移除"
                            cancelText="取消"
                          >
                            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </div>
                      ))}
                    </div>
                  </div>
                }
              >
                <Button>已选题目（{fixedItems.length}）</Button>
              </Popover>
              <Button onClick={() => setAnalysisOpen(true)}>试卷分析</Button>
              <Button type="primary" onClick={() => setMode('edit')}>完成选题</Button>
            </>
          }
        />
        {analysisModal}
      </div>
    );
  }

  // ── 编辑模式 ───────────────────────────────────────────────

  return (
    <div className="page-container" style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/teacher/papers')} />
          <h2 style={{ margin: 0 }}>{isEdit ? '编辑试卷' : '新建试卷'}</h2>
        </Space>
        <Space>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>整卷预览</Button>
          <Button icon={<BarChartOutlined />} onClick={() => setAnalysisOpen(true)}>试卷分析</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={saving}>保存</Button>
        </Space>
      </div>

      {/* 组卷四步引导：题位/抽题/等值替换是系统自定义概念，页内常驻步骤说明降低教师上手成本 */}
      <div className="editor-guide">
        <span className="editor-guide__step"><b>1</b> 填写试卷信息</span>
        <span className="editor-guide__arrow">›</span>
        <span className="editor-guide__step"><b>2</b> 选题（固定题）或新增抽题规则（按难度数量自动抽题）</span>
        <span className="editor-guide__arrow">›</span>
        <span className="editor-guide__step"><b>3</b> 确认抽题规则的可用题数充足，并查看试卷分析</span>
        <span className="editor-guide__arrow">›</span>
        <span className="editor-guide__step"><b>4</b> 保存试卷</span>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Card title="基础信息" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item name="name" label="试卷名称" rules={[{ required: true }]}>
                <Input placeholder="如：多维表格基础操作考核" maxLength={30} showCount />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="difficulty" label="难度">
                <Select placeholder="选择难度" allowClear options={DIFFICULTY_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="备注" style={{ marginBottom: 0 }}>
            <TextArea rows={2} placeholder="试卷备注（仅教师可见）" maxLength={100} showCount />
          </Form.Item>
        </Card>

        {/* 试卷题目区：与参考产品一致，题量/总分/及格分放在区块头上 */}
        <div className="paper-section-bar">
          <span className="paper-section-bar__title">试卷题目</span>
          <span className="paper-section-bar__sum">
            <span>共 {analysis.totalQuestions} 题</span>
            <span>共 {analysis.totalScore} 分</span>
            {fixedItems.length > 0 && ruleItems.length > 0 && (
              <span style={{ color: '#999' }}>（固定 {fixedItems.length} · 抽题 {analysis.totalQuestions - fixedItems.length}）</span>
            )}
          </span>
          <span className="paper-section-bar__pass">
            及格分：
            <Form.Item name="passScore" noStyle>
              <InputNumber min={0} max={1000} style={{ width: 90 }} placeholder="0" />
            </Form.Item>
          </span>
          <span style={{ flex: 1 }} />
          <Button icon={<PlusOutlined />} onClick={() => setMode('select')}>选题</Button>
          <Button icon={<PlusOutlined />} onClick={handleAddRuleItem}>新增抽题规则</Button>
        </div>

        {items.length === 0 ? (
          <Card size="small">
            <Empty description="暂未选题">
              <Space>
                <Button type="primary" onClick={() => setMode('select')}>去选题</Button>
                <Button onClick={handleAddRuleItem}>新增抽题规则</Button>
              </Space>
            </Empty>
          </Card>
        ) : (
          <Card size="small" styles={{ body: { padding: '4px 12px' } }}>
            {items.map((item, index) => {
              if (item.kind === 'rule') {
                return (
                  <RuleItemEditor
                    key={item.key}
                    item={item}
                    index={index}
                    capabilities={capabilities}
                    onPatch={patchItem}
                    onRemove={handleRemoveItem}
                    onMove={handleMoveItem}
                  />
                );
              }
              return (
                <div className="paper-item-row" key={item.key}>
                  <div className="paper-item-row__idx">{index + 1}</div>
                  <div className="paper-item-row__info">
                    {item.question ? (
                      <>
                        <div className="paper-item-row__title">
                          <Tag color="blue">{questionTypeLabel(item.question.type)}</Tag>
                          <Tag>{DIFFICULTY_LABELS[item.question.difficulty] || item.question.difficulty}</Tag>
                          <span>{item.question.title}</span>
                        </div>
                        {item.question.description && (
                          <div className="paper-item-row__desc">{item.question.description}</div>
                        )}
                      </>
                    ) : (
                      <div className="paper-item-row__title">
                        <Tag color="red">题目缺失</Tag>
                        <span>该题可能已被删除，请移除后重新选题</span>
                      </div>
                    )}
                  </div>
                  <div className="paper-item-row__score">
                    分值
                    <InputNumber
                      size="small"
                      min={1}
                      max={1000}
                      value={item.score}
                      onChange={v => handleFixedScoreChange(item.key, Number(v) || 0)}
                      style={{ width: 70, marginLeft: 6 }}
                    />
                  </div>
                  <div className="paper-item-row__ops">
                    <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => handleMoveItem(item.key, -1)} disabled={index === 0} />
                    <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => handleMoveItem(item.key, 1)} disabled={index === items.length - 1} />
                    <Popconfirm title="确认移除？" onConfirm={() => handleRemoveItem(item.key)} okText="移除" cancelText="取消">
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </Form>

      {analysisModal}
      {previewModal}
    </div>
  );
}
