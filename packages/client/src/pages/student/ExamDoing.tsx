import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Steps, Button, Modal, message, Spin, Typography, Tag, Divider, Statistic, Alert } from 'antd';
import { CheckOutlined, LinkOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { io } from 'socket.io-client';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { Question } from '../../types';

const { Text, Paragraph } = Typography;
const { Countdown } = Statistic;

export function ExamDoingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [deadline, setDeadline] = useState<number | null>(null);
  const submittedRef = useRef(false);
  const socketRef = useRef<any>(null);
  const { user } = useAuthStore();

  // Socket.IO connection for real-time monitoring
  useEffect(() => {
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('exam:join', { examId: id, studentId: user?.id, studentName: user?.realName || user?.username });
    });

    // Heartbeat every 10s via socket
    const heartbeatInterval = setInterval(() => {
      socket.emit('exam:heartbeat', { examId: id, studentId: user?.id, currentQuestion, tabSwitchCount });
    }, 10000);

    return () => { clearInterval(heartbeatInterval); socket.disconnect(); };
  }, [id, user, currentStep, tabSwitchCount]);

  useEffect(() => {
    api.get(`/my-exams/${id}`).then(res => {
      const d = res.data;
      setData(d);

      // Calculate deadline from startedAt + durationMinutes
      if (d.submission?.startedAt && d.exam?.durationMinutes) {
        const start = new Date(d.submission.startedAt).getTime();
        const duration = d.exam.durationMinutes * 60 * 1000;
        setDeadline(start + duration);
      }
    }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  // Tab switch detection (anti-cheat)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setTabSwitchCount(c => {
          const newCount = c + 1;
          // Report to server
          api.post(`/my-exams/${id}/heartbeat`, { tabSwitchCount: newCount }).catch(() => {});
          return newCount;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [id]);

  // Heartbeat every 30s
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
      await api.post(`/my-exams/${id}/submit`);
      // Notify via socket
      if (socketRef.current?.connected) {
        socketRef.current.emit('exam:submit', { examId: id, studentId: user?.id, studentName: user?.realName || user?.username });
      }
      if (auto) {
        message.warning('考试时间已到，已自动提交答卷');
      } else {
        message.success('提交成功！');
      }
      navigate(`/student/exam/${id}/result`);
    } catch (err: any) {
      message.error(err.response?.data?.message || '提交失败');
      submittedRef.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [id, navigate]);

  const handleSubmit = () => {
    Modal.confirm({
      title: '确认提交',
      content: '提交后将无法修改，确定要提交答卷吗？',
      okText: '确认提交',
      cancelText: '再检查一下',
      onOk: () => doSubmit(false),
    });
  };

  // Timer finish callback (auto-submit)
  const handleTimerFinish = useCallback(() => {
    if (!submittedRef.current) {
      doSubmit(true);
    }
  }, [doSubmit]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!data) return null;

  const questions: Question[] = data.questions || [];
  const currentQuestion = questions[currentStep];
  const hasTimeLimit = !!deadline;

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      {/* Header with timer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>{data.exam?.title || '答题'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {hasTimeLimit && deadline && (
            <div style={{
              background: '#fff',
              padding: '4px 16px',
              borderRadius: 8,
              border: '2px solid #1890ff',
              display: 'flex',
              alignItems: 'center',
            }}>
              <Countdown
                title={<span style={{ fontSize: 12 }}><ClockCircleOutlined /> 剩余时间</span>}
                value={deadline}
                format="HH:mm:ss"
                onFinish={handleTimerFinish}
                valueStyle={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#1890ff',
                }}
              />
            </div>
          )}
          <Button type="primary" danger onClick={handleSubmit} loading={submitting} icon={<CheckOutlined />}>
            提交答卷
          </Button>
        </div>
      </div>

      {/* Tab switch warning */}
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

      <Steps
        current={currentStep}
        onChange={setCurrentStep}
        size="small"
        style={{ marginBottom: 24 }}
        items={questions.map((q, i) => ({ title: `第${i + 1}题` }))}
      />

      {currentQuestion && (
        <Card
          title={
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Text strong>第 {currentStep + 1} 题</Text>
              <Tag>{currentQuestion.difficulty === 'easy' ? '简单' : currentQuestion.difficulty === 'medium' ? '中等' : '困难'}</Tag>
              <Text type="secondary">{currentQuestion.score} 分</Text>
            </div>
          }
        >
          <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, marginBottom: 16 }}>
            {currentQuestion.description}
          </Paragraph>

          {currentQuestion.hints && (
            <Card type="inner" size="small" title="提示" style={{ marginBottom: 16, background: '#fffbe6' }}>
              <Text type="warning">{currentQuestion.hints}</Text>
            </Card>
          )}

          <Divider />

          <div style={{ background: '#f0f5ff', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              <LinkOutlined /> 操作指引
            </Text>
            <Text type="secondary">
              请打开金山多维表格，根据上述要求完成操作。完成后请确认无误再提交。
            </Text>
          </div>

          <div style={{ marginTop: 16, background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              验证规则（共 {currentQuestion.answerRules.length} 项）：
            </Text>
            {currentQuestion.answerRules.map((rule, i) => (
              <Tag key={rule.id} style={{ marginBottom: 4 }}>
                {rule.action}: {JSON.stringify(rule.params).slice(0, 60)}
                {JSON.stringify(rule.params).length > 60 ? '...' : ''}
                ({rule.score}分)
              </Tag>
            ))}
          </div>
        </Card>
      )}

      <div style={{ textAlign: 'center', marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Button disabled={currentStep === 0} onClick={() => setCurrentStep(s => s - 1)}>
          上一题
        </Button>
        <Button type="primary" onClick={() => {
          if (currentStep < questions.length - 1) setCurrentStep(s => s + 1);
          else handleSubmit();
        }}>
          {currentStep < questions.length - 1 ? '下一题' : '提交答卷'}
        </Button>
      </div>
    </div>
  );
}
