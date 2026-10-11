import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Typography, Tag, message, Spin, Alert, Progress, Space } from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import type { Question } from '../../types';
import { FullscreenGuard } from '../../components/exam/FullscreenGuard';
import { WpsTablePanel } from '../../components/wps/WpsTablePanel';
import { useExamSession } from '../../hooks/useExamSession';
import { computeExamDeadline, serverNow, syncServerTime } from '../../utils/exam-time';

const { Text, Paragraph, Title } = Typography;

const difficultyLabels: Record<string, { label: string; color: string }> = {
  easy: { label: '简单', color: 'success' },
  medium: { label: '中等', color: 'warning' },
  hard: { label: '困难', color: 'error' },
};

export function WpsExamDoingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // 加载失败进入错误态（Alert + 重新加载 + 联系监考老师），而不是白屏卡死
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  // 倒计时用服务端时间（serverNow）：机房电脑 CMOS 漂移会导致本机 Date.now()
  // 与服务端 deadline 错位 —— 钟快 10 分钟的学生会被提前自动交卷。见 utils/exam-time。
  const [now, setNow] = useState(() => Date.now());

  const {
    tabSwitchCount,
    submitting,
    handleSubmit,
    handleTimerFinish,
    handleFullscreenExit,
    handleFullscreenUnavailable,
    autoSubmitExhausted,
    setTabSwitchExempt,
  } = useExamSession({
    examId: id,
    onNavigateToResult: (examId) => navigate(`/student/exam/${examId}/result`),
  });
  // 表格独立窗口打开期间：豁免切屏计数、挂起全屏守护（切到表格窗口是预期行为）。
  // 注意豁免已收紧：只有「学生确实正在表格窗口里」才回调 true（见 useWpsEmbed）。
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const handleWorkbenchChange = useCallback(
    (open: boolean) => {
      setWorkbenchOpen(open);
      setTabSwitchExempt(open);
    },
    [setTabSwitchExempt],
  );

  const loadExam = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get(`/my-exams/${id}`).then(res => {
      const d = res.data;
      setData(d);
      // 优先用服务端下发的时间戳：随到随考模式下每人截止时间不同（开考时刻 + 时长，
      // 且不越过批次窗口），只有服务端算得准；本地推算仅作为老接口/字段缺失时的兜底。
      const dl = typeof d.deadline === 'number' ? d.deadline : computeExamDeadline(d.exam);
      if (dl !== null) setDeadline(dl);
    }).catch((err) => {
      setLoadError(err.response?.data?.message || '网络异常，请稍后重试');
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  // Countdown（每秒刷新服务端时间；同步失败时 serverNow 自动退回本机时间）
  useEffect(() => {
    void syncServerTime();
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = deadline ? Math.max(0, deadline - now) : 0;
  const remTotalSec = Math.floor(remainingMs / 1000);
  const remHours = Math.floor(remTotalSec / 3600);
  const remMinutes = Math.floor((remTotalSec % 3600) / 60);
  const remSeconds = remTotalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeStr = `${pad(remHours)}:${pad(remMinutes)}:${pad(remSeconds)}`;
  const isTimeLow = deadline ? remainingMs < 5 * 60 * 1000 : false;

  useEffect(() => {
    // 到点判定同样用服务端时间：本机钟快了也不提前收卷，钟慢了也不拖延收卷
    if (deadline && serverNow() >= deadline) {
      handleTimerFinish();
    }
  }, [now, deadline, handleTimerFinish]);

  const wpsTable = data?.wpsTable || null;
  const hasWpsTable = !!wpsTable?.shareUrl;
  // 右侧表格面板（内嵌 / 独立窗口两种展示方式）见 components/wps/WpsTablePanel：
  // kdocs 对未登录访客强制登录，内嵌 iframe 能否拿到登录态取决于三方 Cookie 策略，
  // 因此失败时必须有出路 —— 面板内置「独立窗口」模式与实时数据面板。

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    );
  }

  // 加载失败（或响应异常）时的错误态：保留页面框架，给出重试与求助出路。
  // 此前这里 `return null` 是纯白屏 —— 学生既看不到题，也找不到任何操作入口。
  if (loadError || !data) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
        <div style={{ padding: '10px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
          <Title level={5} style={{ margin: 0 }}>答题</Title>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 560, width: '100%' }}>
            <Alert
              type="error"
              showIcon
              message="试卷加载失败"
              description={`${loadError || '响应异常'}。请点击「重新加载」重试；若多次失败，请举手联系监考老师处理，不要关闭本页。`}
              style={{ marginBottom: 16 }}
            />
            <Space>
              <Button type="primary" icon={<ReloadOutlined />} onClick={loadExam}>
                重新加载
              </Button>
              <Button onClick={() => navigate('/student/dashboard')}>返回我的考试</Button>
            </Space>
          </div>
        </div>
      </div>
    );
  }

  const questions: Question[] = data.questions || [];
  const currentQuestion = questions[currentStep];
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round(((currentStep + 1) / totalQuestions) * 100) : 0;

  const leftWidth = hasWpsTable ? 420 : '100%';

  return (
    <FullscreenGuard
      active={true}
      onExit={handleFullscreenExit}
      onForceContinue={handleFullscreenUnavailable}
      suspended={workbenchOpen}
    >
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>

        {/* ═══════════ HEADER ═══════════ */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}>
          <Title level={5} style={{ margin: 0 }}>{data.exam?.title || '答题'}</Title>

          <Space size={16}>
            {/* Progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>
                第 {currentStep + 1}/{totalQuestions} 题
              </Text>
              <Progress
                percent={progressPercent}
                showInfo={false}
                strokeColor="#1890ff"
                trailColor="#f0f0f0"
                size="small"
                style={{ width: 80, margin: 0 }}
              />
            </div>

            {/* Timer */}
            {deadline && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '5px 18px', borderRadius: 6,
                border: `1.5px solid ${isTimeLow ? '#ff4d4f' : '#1890ff'}`,
                background: isTimeLow ? '#fff2f0' : '#fff',
              }}>
                <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>
                  <ClockCircleOutlined style={{ marginRight: 6 }} />剩余时间
                </span>
                <span style={{
                  fontSize: 20, fontWeight: 700,
                  color: isTimeLow ? '#ff4d4f' : '#1890ff',
                }}>
                  {timeStr}
                </span>
              </div>
            )}

            <Button type="primary" danger icon={<CheckOutlined />} onClick={handleSubmit} loading={submitting}>
              交卷
            </Button>
          </Space>
        </div>

        {/* Tab switch warning */}
        {tabSwitchCount > 0 && (
          <Alert
            type="warning" showIcon icon={<WarningOutlined />}
            message={`检测到 ${tabSwitchCount} 次切屏行为，请注意考试纪律`}
            banner closable
          />
        )}

        {/* 自动交卷重试耗尽：给出去成绩页的入口，学生不会被困在答题页 */}
        {autoSubmitExhausted && (
          <Alert
            type="error" showIcon banner
            message="自动交卷多次失败，请点击「前往成绩页」确认交卷状态，或联系监考老师"
            action={
              <Button size="small" type="primary" onClick={() => navigate(`/student/exam/${id}/result`)}>
                前往成绩页
              </Button>
            }
          />
        )}

        {/* ═══════════ MAIN ═══════════ */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left panel */}
          <div style={{
            width: leftWidth, minWidth: hasWpsTable ? 420 : undefined,
            display: 'flex', flexDirection: 'column',
            background: '#fff',
            borderRight: hasWpsTable ? '1px solid #f0f0f0' : 'none',
            overflow: 'hidden',
          }}>
            {/* Question area */}
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              {currentQuestion ? (
                <>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 13, fontWeight: 600, color: '#1890ff' }}>
                          第 {currentStep + 1} 题
                        </Text>
                        <Tag color={difficultyLabels[currentQuestion.difficulty]?.color}>
                          {difficultyLabels[currentQuestion.difficulty]?.label || currentQuestion.difficulty}
                        </Tag>
                      </div>
                      <Text style={{ fontSize: 14, fontWeight: 600, color: '#1890ff' }}>
                        {currentQuestion.score} 分
                      </Text>
                    </div>
                    <Title level={4} style={{ margin: '0 0 12px', fontSize: 16 }}>
                      {currentQuestion.title}
                    </Title>
                  </div>

                  <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
                    <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.8, margin: 0 }}>
                      {currentQuestion.description}
                    </Paragraph>
                  </Card>

                  {currentQuestion.hints && (
                    <Alert type="info" showIcon message="操作提示" description={currentQuestion.hints} style={{ marginBottom: 16 }} />
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>暂无题目</div>
              )}

              {/* Answer Sheet */}
              <Card title="答题卡" size="small">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {questions.map((q, i) => (
                    <Button
                      key={q.id}
                      type={i === currentStep ? 'primary' : 'default'}
                      shape="round"
                      size="small"
                      onClick={() => setCurrentStep(i)}
                      style={{ minWidth: 36 }}
                    >
                      {i + 1}
                    </Button>
                  ))}
                </div>
              </Card>
            </div>

            {/* Bottom nav */}
            <div style={{
              display: 'flex', gap: 12, padding: '12px 20px',
              borderTop: '1px solid #f0f0f0', background: '#fff',
            }}>
              <Button
                size="large"
                disabled={currentStep === 0}
                onClick={() => setCurrentStep(s => s - 1)}
                icon={<LeftOutlined />}
                style={{ flex: 1, height: 44 }}
              >
                上一题
              </Button>
              {currentStep < totalQuestions - 1 ? (
                <Button
                  type="primary"
                  size="large"
                  onClick={() => setCurrentStep(s => s + 1)}
                  icon={<RightOutlined />}
                  style={{ flex: 1, height: 44 }}
                >
                  下一题
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  onClick={handleSubmit}
                  loading={submitting}
                  icon={<CheckOutlined />}
                  style={{ flex: 1, height: 44 }}
                >
                  提交答卷
                </Button>
              )}
            </div>
          </div>

          {/* Right: WPS 多维表格面板（内嵌 / 独立窗口工作台 + 实时数据面板） */}
          {hasWpsTable && (
            <WpsTablePanel
              shareUrl={wpsTable!.shareUrl}
              storageKey={`exam:${id}`}
              previewEndpoint={`/my-exams/${id}/wps-preview`}
              onWorkbenchChange={handleWorkbenchChange}
            />
          )}
        </div>
      </div>
    </FullscreenGuard>
  );
}
