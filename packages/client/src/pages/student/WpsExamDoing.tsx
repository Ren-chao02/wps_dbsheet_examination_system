import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Typography, Tag, message, Spin, Alert, Progress, Tooltip, Space } from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  LinkOutlined,
  LeftOutlined,
  RightOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import type { Question } from '../../types';
import { FullscreenGuard } from '../../components/exam/FullscreenGuard';
import { useExamSession } from '../../hooks/useExamSession';

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
  const [currentStep, setCurrentStep] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [iframeTimeout, setIframeTimeout] = useState(false);
  const [now, setNow] = useState(Date.now());

  const {
    tabSwitchCount,
    submitting,
    handleSubmit,
    handleTimerFinish,
    handleFullscreenExit,
  } = useExamSession({
    examId: id,
    onNavigateToResult: (examId) => navigate(`/student/exam/${examId}/result`),
  });

  useEffect(() => {
    api.get(`/my-exams/${id}`).then(res => {
      const d = res.data;
      setData(d);
      if (d.submission?.startedAt && d.exam?.durationMinutes) {
        const start = new Date(d.submission.startedAt).getTime();
        setDeadline(start + d.exam.durationMinutes * 60 * 1000);
      }
    }).catch((err) => {
      message.error(err.response?.data?.message || '加载失败');
    }).finally(() => setLoading(false));
  }, [id]);

  // Countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
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
    if (deadline && Date.now() >= deadline) {
      handleTimerFinish();
    }
  }, [now, deadline, handleTimerFinish]);

  const wpsTable = data?.wpsTable || null;
  const hasWpsTable = !!wpsTable?.shareUrl;
  const iframeUrl = hasWpsTable
    ? `${wpsTable.shareUrl}${wpsTable.shareUrl.includes('?') ? '&' : '?'}embed=1`
    : '';
  const openInNewTab = () => {
    if (wpsTable?.shareUrl) window.open(wpsTable.shareUrl, '_blank');
  };
  // 加载遮罩是否展示：onLoad 触发 / 报错 / 超时 三者任一发生即撤下
  const showSpinner = hasWpsTable && !iframeLoaded && !iframeError && !iframeTimeout;

  // iframe 加载超时兜底：WPS 多维表格为重型 SPA（常驻 WebSocket + 懒加载），
  // 其 load 事件可能迟迟不触发，导致 onLoad 永不回调、转圈遮罩永久盖住 iframe。
  // 10s 后强制撤下遮罩，露出 iframe 实际内容并提供「新标签页打开」逃生口。
  useEffect(() => {
    if (!hasWpsTable) return;
    setIframeLoaded(false);
    setIframeError(false);
    setIframeTimeout(false);
    const t = setTimeout(() => setIframeTimeout(true), 10000);
    return () => clearTimeout(t);
  }, [iframeUrl]);

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!data) return null;

  const questions: Question[] = data.questions || [];
  const currentQuestion = questions[currentStep];
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round(((currentStep + 1) / totalQuestions) * 100) : 0;

  const leftWidth = hasWpsTable ? 420 : '100%';

  return (
    <FullscreenGuard active={true} onExit={handleFullscreenExit}>
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

          {/* Right: WPS iframe */}
          {hasWpsTable && (
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
                title="WPS 多维表格"
                onLoad={() => setIframeLoaded(true)}
                onError={() => setIframeError(true)}
              />
            </div>
          )}
        </div>
      </div>
    </FullscreenGuard>
  );
}
