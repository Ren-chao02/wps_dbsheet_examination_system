import { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Tag, Typography, Select, Segmented, Progress, Spin,
  List, Collapse, Descriptions, Empty, Divider, message, Space, Badge, Tooltip,
} from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, QuestionCircleOutlined,
  ThunderboltOutlined, FileTextOutlined, SendOutlined, EyeOutlined,
  TrophyOutlined, ExperimentOutlined, BulbOutlined,
} from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

// ============================================================
// 类型定义
// ============================================================

interface DemoQuestion {
  id: string;
  title: string;
  description: string;
  type: string;
  difficulty: string;
  score: number;
  answerRules: AnswerRule[];
  hints?: string;
  tags?: string[];
}

interface AnswerRule {
  id: string;
  action: string;
  params: Record<string, any>;
  score: number;
}

interface RuleResult {
  ruleId: string;
  action: string;
  actionLabel: string;
  passed: boolean;
  score: number;
  maxScore: number;
  expected: any;
  actual: any;
  errorMessage?: string;
  needsReview: boolean;
}

interface GradingResponse {
  questionId: string;
  questionTitle: string;
  mockMode: string;
  schemaKey: string;
  totalScore: number;
  maxScore: number;
  pass: boolean;
  results: RuleResult[];
}

// ============================================================
// 常量
// ============================================================

const difficultyLabels: Record<string, { text: string; color: string }> = {
  easy: { text: '简单', color: 'green' },
  medium: { text: '中等', color: 'orange' },
  hard: { text: '困难', color: 'red' },
};

const actionLabels: Record<string, string> = {
  check_table_exists: '验证表存在',
  check_field: '验证字段',
  check_view_exists: '验证视图存在',
  check_view_type: '验证视图类型',
  check_view_filter: '验证视图筛选',
  check_view_group: '验证视图分组',
  check_form_exists: '验证表单存在',
  check_form_fields: '验证表单字段',
  check_form_settings: '验证表单设置',
  check_linked_record: '验证关联记录',
  check_record_exists: '验证记录存在',
  check_record_value: '验证记录值',
  check_record_count: '验证记录数',
};

function formatParams(params: Record<string, any>): string {
  const entries = Object.entries(params).filter(([k]) => k !== 'score');
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
}

// ============================================================
// 组件
// ============================================================

export function DemoPage() {
  const [questions, setQuestions] = useState<DemoQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [mockMode, setMockMode] = useState<'full' | 'partial'>('full');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<GradingResponse | null>(null);
  const [loadingQuestions, setLoadingQuestions] = useState(true);

  // 加载题目
  useEffect(() => {
    api.get('/demo/questions')
      .then(res => {
        setQuestions(res.data);
        if (res.data.length > 0) {
          setSelectedId(res.data[0].id);
        }
      })
      .catch(() => message.error('加载题目失败'))
      .finally(() => setLoadingQuestions(false));
  }, []);

  const currentQuestion = questions.find(q => q.id === selectedId);

  // 提交判分
  const handleSubmit = useCallback(async () => {
    if (!selectedId) return;
    setGrading(true);
    setResult(null);
    try {
      const res = await api.post('/demo/grade', { questionId: selectedId, mockMode });
      setResult(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.message || '判分请求失败');
    } finally {
      setGrading(false);
    }
  }, [selectedId, mockMode]);

  // 切换题目时重置结果
  const handleQuestionChange = useCallback((id: string) => {
    setSelectedId(id);
    setResult(null);
  }, []);

  // 渲染规则参数
  const renderRuleParams = (rule: AnswerRule) => {
    const params = rule.params;
    if (rule.action === 'check_table_exists') {
      return <>表名: <Text code>{params.tableName}</Text></>;
    }
    if (rule.action === 'check_field') {
      return <>字段 <Text code>{params.fieldName}</Text>（类型: {params.type || '任意'}），表: <Text code>{params.tableName}</Text></>;
    }
    if (rule.action === 'check_view_exists') {
      return <>视图 <Text code>{params.viewName}</Text>，表: <Text code>{params.tableName}</Text></>;
    }
    if (rule.action === 'check_view_type') {
      return <>视图 <Text code>{params.viewName}</Text> 类型为 <Tag>{params.viewType}</Tag></>;
    }
    if (rule.action === 'check_form_exists') {
      return <>表单: <Text code>{params.formName || '（任意）'}</Text>，表: <Text code>{params.tableName}</Text></>;
    }
    if (rule.action === 'check_linked_record') {
      return <>关联到 <Text code>{params.targetTable}</Text>，表: <Text code>{params.tableName}</Text></>;
    }
    return <Text type="secondary">{formatParams(params)}</Text>;
  };

  // ============================================================
  // 渲染
  // ============================================================

  if (loadingQuestions) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载 Demo 题目中..." />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ExperimentOutlined style={{ fontSize: 28, color: '#fff' }} />
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0 }}>WPS 多维表格考试系统 Demo</Title>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13 }}>
              左侧考题 + 右侧表格操作 → 自动判分
            </Text>
          </div>
        </div>
        <Tag color="warning" style={{ fontSize: 13, padding: '4px 12px' }}>
          <ThunderboltOutlined /> Demo 模式（Mock 数据）
        </Tag>
      </div>

      {/* Main Content */}
      <div style={{
        display: 'flex',
        height: 'calc(100vh - 80px)',
        padding: '16px 24px',
        gap: 16,
      }}>
        {/* ======== 左侧面板：题目 + 判分结果 ======== */}
        <div style={{ width: '42%', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          {/* 题目选择 + 模式切换 */}
          <Card size="small" style={{ flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text strong>选择题目：</Text>
              <Select
                value={selectedId}
                onChange={handleQuestionChange}
                style={{ minWidth: 220 }}
                options={questions.map(q => ({
                  value: q.id,
                  label: `${q.title} (${q.score}分)`,
                }))}
              />
              <Divider type="vertical" />
              <Text strong>模拟模式：</Text>
              <Segmented
                value={mockMode}
                onChange={v => { setMockMode(v as 'full' | 'partial'); setResult(null); }}
                options={[
                  { label: '✅ 完整作答', value: 'full' },
                  { label: '⚠️ 部分作答', value: 'partial' },
                ]}
              />
            </div>
          </Card>

          {/* 题目详情 */}
          {currentQuestion && (
            <Card
              title={
                <Space>
                  <FileTextOutlined />
                  <Text strong style={{ fontSize: 16 }}>{currentQuestion.title}</Text>
                  <Tag color={difficultyLabels[currentQuestion.difficulty]?.color}>
                    {difficultyLabels[currentQuestion.difficulty]?.text || currentQuestion.difficulty}
                  </Tag>
                  <Tag>{currentQuestion.score} 分</Tag>
                </Space>
              }
              style={{ flexShrink: 0 }}
            >
              <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 14, marginBottom: 12 }}>
                {currentQuestion.description}
              </Paragraph>

              {currentQuestion.hints && (
                <div style={{
                  background: '#fffbe6', border: '1px solid #ffe58f',
                  borderRadius: 6, padding: '8px 12px', marginBottom: 12,
                }}>
                  <Text type="warning"><BulbOutlined /> {currentQuestion.hints}</Text>
                </div>
              )}

              {currentQuestion.tags && currentQuestion.tags.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  {currentQuestion.tags.map(t => <Tag key={t}>{t}</Tag>)}
                </div>
              )}
            </Card>
          )}

          {/* 要求清单 */}
          {currentQuestion && (
            <Card title={<><CheckCircleOutlined /> 验证要求清单</>} size="small" style={{ flexShrink: 0 }}>
              <List
                size="small"
                dataSource={currentQuestion.answerRules}
                renderItem={(rule, i) => (
                  <List.Item>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <Tag color="processing" style={{ minWidth: 28, textAlign: 'center' }}>#{i + 1}</Tag>
                      <Text style={{ flex: 1 }}>
                        <Text strong>{actionLabels[rule.action] || rule.action}</Text>
                        {' — '}
                        {renderRuleParams(rule)}
                      </Text>
                      <Tag>{rule.score} 分</Tag>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          )}

          {/* 判分结果 */}
          {result && (
            <Card
              title={
                <Space>
                  <TrophyOutlined style={{ color: result.pass ? '#52c41a' : '#ff4d4f' }} />
                  <Text strong>判分结果</Text>
                  <Tag color={result.pass ? 'success' : 'error'}>
                    {result.pass ? '通过' : '未通过'}
                  </Tag>
                </Space>
              }
              style={{ flexShrink: 0, borderColor: result.pass ? '#b7eb8f' : '#ffa39e' }}
            >
              {/* 总分 */}
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <Progress
                  type="circle"
                  percent={Math.round((result.totalScore / result.maxScore) * 100)}
                  format={() => `${result.totalScore}/${result.maxScore}`}
                  status={result.pass ? 'success' : 'exception'}
                  size={100}
                />
                <div style={{ marginTop: 8 }}>
                  <Text type="secondary">
                    得分 {result.totalScore} / 满分 {result.maxScore}
                  </Text>
                </div>
              </div>

              <Divider style={{ margin: '12px 0' }} />

              {/* 逐条结果 */}
              <List
                size="small"
                dataSource={result.results}
                renderItem={(rule, i) => (
                  <List.Item style={{ padding: '8px 0' }}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {rule.passed ? (
                          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                        ) : rule.needsReview ? (
                          <QuestionCircleOutlined style={{ color: '#faad14', fontSize: 16 }} />
                        ) : (
                          <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 16 }} />
                        )}
                        <Text strong>#{i + 1} {rule.actionLabel}</Text>
                        <Tag color={rule.passed ? 'success' : rule.needsReview ? 'warning' : 'error'}>
                          {rule.passed ? '通过' : rule.needsReview ? '需复核' : '未通过'}
                        </Tag>
                        <Text style={{ marginLeft: 'auto' }}>
                          {rule.score}/{rule.maxScore} 分
                        </Text>
                      </div>

                      {/* 预期 vs 实际 */}
                      {!rule.passed && (
                        <Collapse
                          ghost
                          size="small"
                          style={{ marginTop: 4 }}
                          items={[{
                            key: 'detail',
                            label: <Text type="secondary" style={{ fontSize: 12 }}>查看详情</Text>,
                            children: (
                              <div style={{ fontSize: 12 }}>
                                <div style={{ marginBottom: 4 }}>
                                  <Text type="secondary">预期：</Text>
                                  <pre style={{
                                    background: '#f6ffed', padding: '4px 8px', borderRadius: 4,
                                    margin: '2px 0', fontSize: 11, maxHeight: 80, overflow: 'auto',
                                  }}>
                                    {JSON.stringify(rule.expected, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <Text type="secondary">实际：</Text>
                                  <pre style={{
                                    background: '#fff2f0', padding: '4px 8px', borderRadius: 4,
                                    margin: '2px 0', fontSize: 11, maxHeight: 80, overflow: 'auto',
                                  }}>
                                    {JSON.stringify(rule.actual, null, 2)}
                                  </pre>
                                </div>
                                {rule.errorMessage && (
                                  <Text type="danger" style={{ fontSize: 12 }}>
                                    错误：{rule.errorMessage}
                                  </Text>
                                )}
                              </div>
                            ),
                          }]}
                        />
                      )}
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          )}
        </div>

        {/* ======== 右侧面板：WPS 表格嵌入区 ======== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 操作区 */}
          <Card
            title={
              <Space>
                <EyeOutlined />
                <Text strong>WPS 多维表格操作区</Text>
              </Space>
            }
            extra={
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSubmit}
                loading={grading}
                size="large"
              >
                提交验证
              </Button>
            }
            style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            bodyStyle={{ flex: 1, display: 'flex', flexDirection: 'column' }}
          >
            {/* WPS 真实表格 iframe 嵌入 */}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden',
              minHeight: 0,
            }}>
              {/* iframe Tab 切换 */}
              <div style={{
                background: '#fafafa', padding: '4px 12px',
                borderBottom: '1px solid #e8e8e8',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Badge status="processing" />
                <Text strong style={{ fontSize: 13 }}>
                  真实 WPS 多维表格
                </Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  (ctQzvOvixFUo)
                </Text>
                <div style={{ flex: 1 }} />
                {result && (
                  <Tag color={result.pass ? 'success' : 'error'}>
                    判分: {result.totalScore}/{result.maxScore}
                  </Tag>
                )}
              </div>

              <iframe
                src="https://www.kdocs.cn/l/ctQzvOvixFUo"
                style={{
                  flex: 1, width: '100%', border: 'none',
                  minHeight: 300,
                }}
                title="WPS 多维表格"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            </div>

            {/* 判分结果下拉面板 */}
            {result && (
              <div style={{
                flexShrink: 0, maxHeight: result ? 320 : 0,
                overflow: 'auto', transition: 'max-height 0.3s',
              }}>
                <Divider style={{ margin: '8px 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Space>
                    <Badge status="processing" />
                    <Text strong>判分详情</Text>
                    <Tag color="blue">{result.schemaKey}</Tag>
                    <Tag color={result.mockMode === 'full' ? 'success' : 'warning'}>
                      {result.mockMode === 'full' ? '完整作答' : '部分作答'}
                    </Tag>
                  </Space>
                  <Text style={{
                    color: result.pass ? '#52c41a' : '#ff4d4f',
                    fontSize: 16, fontWeight: 'bold',
                  }}>
                    {result.totalScore} / {result.maxScore} 分
                    （{Math.round((result.totalScore / result.maxScore) * 100)}%）
                    {result.pass ? ' ✅ 通过' : ' ❌ 未通过'}
                  </Text>
                </div>

                {/* 逐条结果 */}
                {result.results.map((r, i) => (
                  <Card
                    key={r.ruleId}
                    size="small"
                    style={{
                      marginBottom: 6,
                      borderLeft: `3px solid ${r.passed ? '#52c41a' : r.needsReview ? '#faad14' : '#ff4d4f'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Space size={4}>
                        {r.passed ? (
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        ) : r.needsReview ? (
                          <QuestionCircleOutlined style={{ color: '#faad14' }} />
                        ) : (
                          <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                        )}
                        <Text style={{ fontSize: 13 }}><Text strong>#{i + 1}</Text> {r.actionLabel}</Text>
                      </Space>
                      <Tag color={r.passed ? 'success' : r.needsReview ? 'warning' : 'error'}>
                        {r.score}/{r.maxScore} 分
                      </Tag>
                    </div>
                    {r.errorMessage && (
                      <Paragraph type={r.needsReview ? 'warning' : 'danger'} style={{ fontSize: 12, margin: '4px 0 0 16px' }}>
                        {r.errorMessage}
                      </Paragraph>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Card>

          {/* 底部提示 */}
          <Card size="small" style={{ flexShrink: 0, background: '#f6ffed', border: '1px solid #b7eb8f' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ThunderboltOutlined style={{ color: '#52c41a' }} />
                <Text style={{ fontSize: 13 }}>
                  <Text strong>真实表格已嵌入：</Text>
                  右侧 iframe 嵌入了
                  <a href="https://www.kdocs.cn/l/ctQzvOvixFUo" target="_blank" rel="noopener noreferrer">
                    kdocs.cn/l/ctQzvOvixFUo
                  </a>
                  ，登录 WPS 后可直接操作表格，然后点击「提交验证」测试判分流程。
                </Text>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 13, color: '#8c8c8c' }}>
                  📌 判分目前使用 Mock Schema（<Text code>demo_q1</Text>），真实 API 对接需要
                  <Text code>KINGSOFT_API_KEY</Text> 配置 WPS-3 签名。
                </Text>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
