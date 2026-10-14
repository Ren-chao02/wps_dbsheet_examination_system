import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Button, Card, Typography, Tag, message, Spin, Alert, Space, Result, List, Empty, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, CheckOutlined, ReloadOutlined, RightOutlined,
  StarFilled, StarOutlined,
} from '@ant-design/icons';
import { practiceApi } from '../../services/api';
import type { RuleResult } from '../../types';
import { WpsTablePanel } from '../../components/wps/WpsTablePanel';

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

  const [questions, setQuestions] = useState<PracticeQuestion[]>(payload?.questions || []);
  const [shareUrl, setShareUrl] = useState<string | null>(payload?.shareUrl || null);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(!payload);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradingResult | null>(null);
  // ── 收藏（个人题集）：星标状态全局共享（作答页 + 结果页） ──
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favPendingId, setFavPendingId] = useState<string | null>(null);

  // 进入作答页即拉取已收藏集合，保证星标初始态正确
  useEffect(() => {
    practiceApi
      .favorites()
      .then((items: any[]) => setFavoriteIds(new Set(items.map((it) => it.question.id))))
      .catch(() => { /* 拉取失败静默：星标默认未收藏，不影响作答 */ });
  }, []);

  /** 切换单题收藏（乐观更新，失败回滚） */
  const handleToggleFavorite = async (questionId: string) => {
    if (favPendingId === questionId) return;
    const wasFavorited = favoriteIds.has(questionId);
    setFavPendingId(questionId);
    setFavoriteIds(prev => {
      const next = new Set(prev);
      if (wasFavorited) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
    try {
      const res = await practiceApi.toggleFavorite(questionId);
      message.success(res.favorited ? '已收藏，可在「我的题集」查看' : '已取消收藏');
    } catch {
      setFavoriteIds(prev => {
        const next = new Set(prev);
        if (wasFavorited) next.add(questionId);
        else next.delete(questionId);
        return next;
      });
      message.error('收藏操作失败，请重试');
    } finally {
      setFavPendingId(null);
    }
  };

  /** 收藏按钮（作答页/结果页统一渲染） */
  const renderStar = (questionId: string, size: 'small' | 'middle' = 'small') => {
    const fav = favoriteIds.has(questionId);
    return (
      <Tooltip title={fav ? '取消收藏' : '收藏本题'}>
        <Button
          type="text"
          size={size}
          loading={favPendingId === questionId}
          icon={fav
            ? <StarFilled style={{ color: '#faad14' }} />
            : <StarOutlined style={{ color: '#8c8c8c' }} />}
          onClick={() => handleToggleFavorite(questionId)}
        />
      </Tooltip>
    );
  };

  // 无 state（刷新 / 换设备 / 从「继续」进来）：按 recordId 拉快照恢复。
  // 链式练习十几步，一次误刷新就全废是不可接受的。
  useEffect(() => {
    if (payload) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await practiceApi.getRecord(recordId!);
        if (cancelled) return;
        if (res.data.status === 'graded') {
          // details 是数组才进结果态：提交后判分中的窗口里 status 已置 graded、
          // details 还没写回，此时进结果页会因 details 为 null 白屏
          if (Array.isArray(res.data.details)) {
            setResult(res.data as unknown as GradingResult);
          } else {
            message.info('判分进行中，请稍后刷新查看结果');
          }
          return;
        }
        setQuestions(res.data.questions ?? []);
        setShareUrl(res.data.shareUrl ?? null);
        // 步骤记忆：同一台设备上回到上次作答的那一步（换设备则从头开始翻，不影响作答内容）。
        // 读取单独 try/catch：存储被禁用时别把整条恢复流程带进下面的错误分支。
        let saved = 0;
        try { saved = Number(localStorage.getItem(`practice_step:${recordId}`) ?? '0'); } catch { /* 隐私模式忽略 */ }
        // 越界（脏值/题目被删）回落到第一题，避免 currentQuestion 为 undefined
        const maxStep = Math.max((res.data.questions?.length ?? 0) - 1, 0);
        setCurrentStep(Number.isFinite(saved) && saved > 0 ? Math.min(saved, maxStep) : 0);
      } catch {
        message.error('练习记录加载失败，请返回重新开始');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [payload, recordId]);

  /** 切题：更新当前步并写入步骤记忆（刷新后回到这一步） */
  const gotoStep = (n: number) => {
    setCurrentStep(n);
    try { localStorage.setItem(`practice_step:${recordId}`, String(n)); } catch { /* 隐私模式忽略 */ }
  };

  // 按 demo-wps-embed.html「全部显示」模式加载：直接使用分享链接，不带 embed 参数；
  // iframe 加载状态/超时/重载/新标签登录后自动刷新由 useWpsEmbed 统一管理。

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
    // 「收藏全部错题」目标：未通过且尚未收藏的题
    const wrongToFavorite = result.details
      .filter(d => !d.isCorrect && !favoriteIds.has(d.questionId))
      .map(d => d.questionId);

    const handleCollectWrong = async () => {
      if (wrongToFavorite.length === 0) {
        message.info('错题已全部收藏');
        return;
      }
      for (const qid of wrongToFavorite) {
        setFavoriteIds(prev => {
          const next = new Set(prev);
          next.add(qid);
          return next;
        });
        try {
          await practiceApi.toggleFavorite(qid);
        } catch {
          setFavoriteIds(prev => {
            const next = new Set(prev);
            next.delete(qid);
            return next;
          });
        }
      }
      message.success(`已将 ${wrongToFavorite.length} 道错题加入收藏，可在「我的题集」查看`);
    };

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

        <Card
          title="判分明细"
          style={{ marginTop: 16 }}
          extra={
            <Button
              size="small" icon={<StarOutlined />}
              disabled={wrongToFavorite.length === 0}
              onClick={handleCollectWrong}
            >
              收藏全部错题{wrongToFavorite.length > 0 ? `（${wrongToFavorite.length}）` : ''}
            </Button>
          }
        >
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
                    {renderStar(d.questionId)}
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
                    {renderStar(currentQuestion.questionId)}
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
                    onClick={() => gotoStep(i)}
                    style={{ minWidth: 36 }}
                  >{i + 1}</Button>
                ))}
              </div>
            </Card>
          </div>

          {/* 底部导航 */}
          <div style={{ display: 'flex', gap: 12, padding: '12px 20px', borderTop: '1px solid #f0f0f0', background: '#fff' }}>
            <Button size="large" disabled={currentStep === 0}
              onClick={() => gotoStep(currentStep - 1)} style={{ flex: 1, height: 44 }}>
              上一题
            </Button>
            {currentStep < questions.length - 1 ? (
              <Button type="primary" size="large"
                onClick={() => gotoStep(currentStep + 1)} icon={<RightOutlined />}
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

        {/* 右侧：WPS 多维表格面板（内嵌 / 独立窗口工作台 + 实时数据面板） */}
        {hasShareUrl && (
          <WpsTablePanel
            shareUrl={shareUrl}
            storageKey="practice"
            previewEndpoint="/practice/wps-preview"
          />
        )}
      </div>
    </div>
  );
}
