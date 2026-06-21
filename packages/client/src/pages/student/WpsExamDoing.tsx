import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Statistic, Typography, Tag, Modal, message, Spin, Alert, Space } from 'antd';
import { CheckOutlined, ClockCircleOutlined, WarningOutlined, LinkOutlined } from '@ant-design/icons';
import { io } from 'socket.io-client';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { Question } from '../../types';
import { FullscreenGuard, exitFullscreen } from '../../components/exam/FullscreenGuard';

declare global {
  interface Window {
    WebOfficeSDK?: any;
  }
}

const { Text, Paragraph } = Typography;
const { Countdown } = Statistic;

function recordBehavior(
  examId: string | undefined,
  studentId: string | undefined,
  behaviorType: string,
  metadata: Record<string, any> = {}
) {
  if (!examId || !studentId) return;
  api.post('/behaviors/record', { examId, studentId, behaviorType, metadata }).catch(() => {});
}

export function WpsExamDoingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [iframeError, setIframeError] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const sdkRef = useRef<any>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);
  const submittedRef = useRef(false);
  const socketRef = useRef<any>(null);

  useEffect(() => {
    api.post(`/my-exams/${id}/start-wps`).then(res => {
      const d = res.data;
      setData(d);
      if (d.submission?.startedAt && d.exam?.durationMinutes) {
        const start = new Date(d.submission.startedAt).getTime();
        setDeadline(start + d.exam.durationMinutes * 60 * 1000);
      }
      loadWpsSdk(d.shareUrl);
    }).catch((err) => {
      message.error(err.response?.data?.message || '加载失败');
    }).finally(() => setLoading(false));

    return () => {
      if (sdkRef.current?.destroy) {
        try { sdkRef.current.destroy(); } catch {}
      }
      if (scriptRef.current && scriptRef.current.parentNode) {
        scriptRef.current.parentNode.removeChild(scriptRef.current);
      }
    };
  }, [id]);

  const loadWpsSdk = (shareUrl: string) => {
    if (!shareUrl) return;
    if (!window.WebOfficeSDK) {
      const script = document.createElement('script');
      script.src = 'https://open.wps.cn/js/sdk/weboffice-sdk-v1.1.8.umd.js';
      script.async = true;
      script.onload = () => initSdk(shareUrl);
      script.onerror = () => setIframeError(true);
      scriptRef.current = script;
      document.body.appendChild(script);
    } else {
      initSdk(shareUrl);
    }
  };

  const initSdk = (shareUrl: string) => {
    try {
      const mount = document.getElementById('wps-table-container');
      if (!mount) return;
      const url = new URL(shareUrl);
      url.searchParams.set('embed', '1');
      url.searchParams.set('disablePlugins', 'true');
      sdkRef.current = window.WebOfficeSDK.config({
        url: url.toString(),
        mount,
        commonOptions: {
          isEnableChangeDocumentTitle: false,
          isShowHeader: false,
        },
      });
    } catch {
      setIframeError(true);
    }
  };

  useEffect(() => {
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('exam:join', { examId: id, studentId: user?.id, studentName: user?.realName || user?.username });
    });

    const heartbeatInterval = setInterval(() => {
      socket.emit('exam:heartbeat', { examId: id, studentId: user?.id, currentQuestion: currentStep, tabSwitchCount });
    }, 10000);

    return () => {
      clearInterval(heartbeatInterval);
      socket.disconnect();
    };
  }, [id, user, currentStep, tabSwitchCount]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setTabSwitchCount(c => {
          const newCount = c + 1;
          api.post(`/my-exams/${id}/heartbeat`, { tabSwitchCount: newCount }).catch(() => {});
          recordBehavior(id, user?.id, 'TAB_SWITCH', { tabSwitch: { count: newCount } });
          return newCount;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [id, user?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      api.post(`/my-exams/${id}/heartbeat`, { tabSwitchCount }).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [id, tabSwitchCount]);

  const doSubmit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      if (socketRef.current?.connected) {
        socketRef.current.emit('exam:submit', { examId: id, studentId: user?.id, studentName: user?.realName || user?.username });
      }
      await api.post(`/my-exams/${id}/submit`);
      message.success(auto ? '考试时间已到，已自动提交' : '提交成功！');
      exitFullscreen();
      navigate(`/student/exam/${id}/result`);
    } catch (err: any) {
      message.error(err.response?.data?.message || '提交失败');
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [id, navigate, user]);

  const handleTimerFinish = useCallback(() => {
    if (!submittedRef.current) doSubmit(true);
  }, [doSubmit]);

  const handleSubmit = () => {
    Modal.confirm({
      title: '确认提交',
      content: '提交后将无法修改，确定要提交答卷吗？',
      okText: '确认提交',
      cancelText: '再检查一下',
      onOk: () => doSubmit(false),
    });
  };

  const handleFullscreenExit = useCallback(() => {
    recordBehavior(id, user?.id, 'FULLSCREEN_EXIT', { reason: 'student exited fullscreen' });
    if (socketRef.current?.connected) {
      socketRef.current.emit('exam:fullscreen-exit', { examId: id, studentId: user?.id, studentName: user?.realName || user?.username });
    }
  }, [id, user?.id, user?.realName, user?.username]);

  const openInNewTab = () => {
    if (data?.shareUrl) window.open(data.shareUrl, '_blank');
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!data) return null;

  const questions: Question[] = data.questions || [];
  const currentQuestion = questions[currentStep];

  return (
    <FullscreenGuard active={true} onExit={handleFullscreenExit}>
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0'
        }}>
          <h2 style={{ margin: 0 }}>{data.exam?.title || 'WPS 实操考试'}</h2>
          <Space>
            {deadline && (
              <div style={{
                background: '#fff', padding: '4px 16px', borderRadius: 8,
                border: '2px solid #1890ff', display: 'flex', alignItems: 'center'
              }}>
                <Countdown
                  title={<span style={{ fontSize: 12 }}><ClockCircleOutlined /> 剩余时间</span>}
                  value={deadline}
                  format="HH:mm:ss"
                  onFinish={handleTimerFinish}
                  valueStyle={{ fontSize: 20, fontWeight: 700, color: '#1890ff' }}
                />
              </div>
            )}
            <Button type="primary" danger onClick={handleSubmit} loading={submitting} icon={<CheckOutlined />}>
              提交答卷
            </Button>
          </Space>
        </div>

        {tabSwitchCount > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={`检测到 ${tabSwitchCount} 次切屏行为，请注意考试纪律`}
            style={{ marginBottom: 16 }}
            closable
          />
        )}

        {/* Main */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left: questions */}
          <div style={{ width: 420, borderRight: '1px solid #f0f0f0', overflow: 'auto', padding: 16, background: '#f5f5f5' }}>
            {currentQuestion ? (
              <Card title={`第 ${currentStep + 1} 题`} size="small" style={{ marginBottom: 16 }}>
                <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, marginBottom: 16 }}>
                  {currentQuestion.description}
                </Paragraph>
                {currentQuestion.hints && (
                  <Alert type="warning" showIcon message="提示" description={currentQuestion.hints} style={{ marginBottom: 16 }} />
                )}
                <div>
                  <Tag>{currentQuestion.difficulty === 'easy' ? '简单' : currentQuestion.difficulty === 'medium' ? '中等' : '困难'}</Tag>
                  <Text type="secondary">{currentQuestion.score} 分</Text>
                </div>
              </Card>
            ) : null}

            <Card title="答题卡" size="small">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {questions.map((q, i) => (
                  <Button
                    key={q.id}
                    type={i === currentStep ? 'primary' : 'default'}
                    size="small"
                    onClick={() => setCurrentStep(i)}
                  >
                    {i + 1}
                  </Button>
                ))}
              </div>
            </Card>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Button disabled={currentStep === 0} onClick={() => setCurrentStep(s => s - 1)}>上一题</Button>
              <Button
                type="primary"
                onClick={() => currentStep < questions.length - 1 ? setCurrentStep(s => s + 1) : handleSubmit()}
              >
                {currentStep < questions.length - 1 ? '下一题' : '提交答卷'}
              </Button>
            </div>
          </div>

          {/* Right: WPS iframe */}
          <div style={{ flex: 1, position: 'relative', background: '#f0f2f5' }}>
            {iframeError ? (
              <div style={{ textAlign: 'center', paddingTop: 100 }}>
                <WarningOutlined style={{ fontSize: 48, color: '#faad14' }} />
                <h3>WPS 表格无法在当前页面内嵌打开</h3>
                <Text type="secondary">请点击下方按钮在新标签页打开表格，操作完成后返回本页面交卷。</Text>
                <div style={{ marginTop: 16 }}>
                  <Button type="primary" icon={<LinkOutlined />} onClick={openInNewTab}>
                    在新标签页打开 WPS 表格
                  </Button>
                </div>
              </div>
            ) : (
              <div id="wps-table-container" style={{ width: '100%', height: '100%' }} />
            )}
          </div>
        </div>
      </div>
    </FullscreenGuard>
  );
}
