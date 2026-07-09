import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Button, Card, Typography, Tag, message, Spin, Alert, Space, Result, List, Empty,
} from 'antd';
import {
  ArrowLeftOutlined, CheckOutlined, LinkOutlined, ReloadOutlined, RightOutlined,
} from '@ant-design/icons';
import { practiceApi } from '../../services/api';
import type { RuleResult } from '../../types';

const { Text, Title, Paragraph } = Typography;

interface PracticeQuestion {
  questionId: string; sortOrder: number; title: string; description: string;
  type: string; difficulty: string; score: number; hints: string | null;
}

interface StartPayload {
  recordId: string;
  questions: PracticeQuestion[];
  maxScore: number;
  shareUrl: string | null;
}

interface QuestionResult {
  questionId: string;
  questionTitle: string;
  difficulty: string;
  type: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  ruleResults: RuleResult[];
  analysis: string | null;
}

interface GradingResult {
  recordId: string;
  score: number;
  maxScore: number;
  passed: boolean;
  details: QuestionResult[];
}

const difficultyLabels: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'success' },
  medium: { label: '中等', color: 'warning' },
  hard: { label: '困难', color: 'error' },
};

const typeLabels: Record<string, string> = {
  create_table: '建表',
  add_field: '加字段',
  config_view: '配视图',
  create_form: '建表单',
  comprehensive: '综合',
};

export function PracticeDoing() {
  const { recordId } = useParams<{ recordId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const payload = (location.state as StartPayload | null);

  const [questions] = useState<PracticeQuestion[]>(payload?.questions || []);
  const [shareUrl, setShareUrl] = useState<string | null>(payload?.shareUrl || null);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(!payload);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeTimeout, setIframeTimeout] = useState(false);

  // 若无 state（如刷新页面），仅能恢复 shareUrl；questions 快照需后端补 GET /practice/:recordId 接口
  useEffect(() => {
    if (payload) return;
    (async () => {
      try {
        const assignment = await practiceApi.getAssignment();
        setShareUrl(assignment?.shareUrl || null);
        message.warning('刷新后题目无法恢复，请返回重新开练');
      } catch {
        message.error('加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [payload]);

  const iframeUrl = shareUrl ? `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}embed=1` : '';
  const openInNewTab = () => {
    if (shareUrl) window.open(shareUrl, '_blank');
  };
  // 加载遮罩是否展示：onLoad 触发 / 报错 / 超时 三者任一发生即撤下
  const showSpinner = !!shareUrl && !iframeLoaded && !iframeError && !iframeTimeout;

  // iframe 加载超时兜底：WPS 多维表格为重型 SPA（常驻 WebSocket + 懒加载），
  // 其 load 事件可能迟迟不触发，导致 onLoad 永不回调、转圈遮罩永久盖住 iframe。
  // 10s 后强制撤下遮罩，露出 iframe 实际内容并提供「新标签页打开」逃生口。
  useEffect(() => {
    if (!shareUrl) return;
    setIframeLoaded(false);
    setIframeError(false);
    setIframeTimeout(false);
    const t = setTimeout(() => setIframeTimeout(true), 10000);
    return () => clearTimeout(t);
  }, [iframeUrl]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res: GradingResult = await practiceApi.submit(recordId!);
      setResult(res);
    } catch (err: any) {
      message.error(err.response?.data?.message || '判分失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  // ───── 结果态 ─────
  if (result) {
    const passRate = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
    return (
      <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
        <Result
          status={result.passed ? 'success' : 'warning'}
          title={`${result.score} / ${result.maxScore} 分`}
          subTitle={`正确率 ${passRate}% · ${result.passed ? '通过' : '未通过'}`}
          extra={[
            <Button key="again" type="primary" icon={<ReloadOutlined />}
              onClick={() => navigate('/student/practice')}>
              再练一次
            </Button>,
            <Button key="back" onClick={() => navigate('/student/practice')}>返回列表</Button>,
          ]}
        />

        <Card title="判分明细" style={{ marginTop: 16 }}>
          <List
            dataSource={result.details}
            renderItem={(d, idx) => (
              <List.Item>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <Text strong>第 {idx + 1} 题</Text>
                    <Tag color={difficultyLabels[d.difficulty]?.color}>
                      {difficultyLabels[d.difficulty]?.label || d.difficulty}
                    </Tag>
                    <Tag>{typeLabels[d.type] || d.type}</Tag>
                    <Text>{d.score} / {d.maxScore} 分</Text>
                    <Tag color={d.isCorrect ? 'success' : 'error'}>
                      {d.isCorrect ? '正确' : '错误'}
                    </Tag>
                  </Space>
                  <Text strong>{d.questionTitle}</Text>

                  {/* 规则判分明细 */}
                  {d.ruleResults.length > 0 && (
                    <List
                      size="small" split
                      dataSource={d.ruleResults}
                      renderItem={(r: RuleResult, ri) => (
                        <List.Item>
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Space>
                              <Tag color={r.passed ? 'success' : 'error'}>{r.passed ? '✓' : '✗'}</Tag>
                              <Text type="secondary" style={{ fontSize: 12 }}>规则 {ri + 1}: {r.action}</Text>
                              {r.score > 0 && <Text type="secondary" style={{ fontSize: 12 }}>+{r.score}</Text>}
                            </Space>
                            {r.expected !== undefined && r.actual !== undefined && (
                              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                                预期: {JSON.stringify(r.expected)}{'\n'}实际: {JSON.stringify(r.actual)}
                              </Text>
                            )}
                            {r.errorMessage && (
                              <Text type="danger" style={{ fontSize: 12 }}>{r.errorMessage}</Text>
                            )}
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}

                  {/* 解析 */}
                  {d.analysis && (
                    <Alert
                      type="info" showIcon
                      style={{ marginTop: 8 }}
                      message="解析"
                      description={<Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{d.analysis}</Paragraph>}
                    />
                  )}
                </Space>
              </List.Item>
            )}
          />
        </Card>
      </div>
    );
  }

  // ───── 答题态 ─────
  const currentQuestion = questions[currentStep];
  const hasShareUrl = !!shareUrl;
  const leftWidth = hasShareUrl ? 420 : '100%';

  if (questions.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Empty description="题目未加载，请返回重新开练" />
        <Button style={{ marginTop: 16 }} onClick={() => navigate('/student/practice')}>返回列表</Button>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0',
      }}>
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/practice')}>
            返回
          </Button>
          <Title level={5} style={{ margin: 0 }}>题库练习</Title>
        </Space>
        <Space size={16}>
          <Text style={{ fontSize: 13, color: '#666' }}>
            第 {currentStep + 1}/{questions.length} 题
          </Text>
          <Button type="primary" icon={<CheckOutlined />} loading={submitting} onClick={handleSubmit}>
            提交练习
          </Button>
        </Space>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧题目 */}
        <div style={{
          width: leftWidth, minWidth: hasShareUrl ? 420 : undefined,
          display: 'flex', flexDirection: 'column', background: '#fff',
          borderRight: hasShareUrl ? '1px solid #f0f0f0' : 'none', overflow: 'hidden',
        }}>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {currentQuestion && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <Space>
                    <Text style={{ fontSize: 13, fontWeight: 600, color: '#1890ff' }}>
                      第 {currentStep + 1} 题
                    </Text>
                    <Tag color={difficultyLabels[currentQuestion.difficulty]?.color}>
                      {difficultyLabels[currentQuestion.difficulty]?.label || currentQuestion.difficulty}
                    </Tag>
                    <Tag>{typeLabels[currentQuestion.type] || currentQuestion.type}</Tag>
                    <Text style={{ fontWeight: 600, color: '#1890ff' }}>{currentQuestion.score} 分</Text>
                  </Space>
                </div>
                <Title level={4} style={{ margin: '0 0 12px', fontSize: 16 }}>
                  {currentQuestion.title}
                </Title>
                {currentQuestion.description && (
                  <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                    <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.8, margin: 0 }}>
                      {currentQuestion.description}
                    </Paragraph>
                  </Card>
                )}
                {currentQuestion.hints && (
                  <Alert type="info" showIcon message="操作提示" description={currentQuestion.hints} />
                )}
              </>
            )}

            {/* 答题卡 */}
            <Card title="答题卡" size="small" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {questions.map((q, i) => (
                  <Button
                    key={q.questionId}
                    type={i === currentStep ? 'primary' : 'default'}
                    shape="round" size="small"
                    onClick={() => setCurrentStep(i)}
                    style={{ minWidth: 36 }}
                  >{i + 1}</Button>
                ))}
              </div>
            </Card>
          </div>

          {/* 底部导航 */}
          <div style={{ display: 'flex', gap: 12, padding: '12px 20px', borderTop: '1px solid #f0f0f0', background: '#fff' }}>
            <Button size="large" disabled={currentStep === 0}
              onClick={() => setCurrentStep(s => s - 1)} style={{ flex: 1, height: 44 }}>
              上一题
            </Button>
            {currentStep < questions.length - 1 ? (
              <Button type="primary" size="large"
                onClick={() => setCurrentStep(s => s + 1)} icon={<RightOutlined />}
                style={{ flex: 1, height: 44 }}>
                下一题
              </Button>
            ) : (
              <Button type="primary" size="large" icon={<CheckOutlined />}
                loading={submitting} onClick={handleSubmit} style={{ flex: 1, height: 44 }}>
                提交练习
              </Button>
            )}
          </div>
        </div>

        {/* 右侧 WPS iframe */}
        {hasShareUrl && (
          <div style={{ flex: 1, position: 'relative', background: '#f0f2f5' }}>
            {/* 右上角逃生口：始终可用，内嵌失败时可改在新标签页打开 */}
            <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 10 }}>
              <Button size="small" icon={<LinkOutlined />} onClick={openInNewTab}>
                在新标签页打开
              </Button>
            </div>

            {/* 加载遮罩：onLoad 触发 / 报错 / 10s 超时 三者任一发生即撤下，避免永久转圈 */}
            {showSpinner && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5', zIndex: 5 }}>
                <Spin tip="正在加载 WPS 多维表格..." />
              </div>
            )}

            {/* 超时/错误提示：iframe 迟迟未触发 onLoad，提示学生用新标签页打开 */}
            {(iframeTimeout || iframeError) && !iframeLoaded && (
              <div style={{ position: 'absolute', top: 44, left: 12, right: 12, zIndex: 6 }}>
                <Alert
                  type="warning" showIcon banner
                  message="WPS 表格加载较慢或被浏览器拦截"
                  description="若上方区域长时间空白，请点击右上角「在新标签页打开」在新窗口操作，完成后返回本页交卷。"
                />
              </div>
            )}

            <iframe
              src={iframeUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              title="WPS 多维表格练习"
              onLoad={() => setIframeLoaded(true)}
              onError={() => setIframeError(true)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
