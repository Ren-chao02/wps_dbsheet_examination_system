import { useEffect, useRef, useCallback, useState } from 'react';
import { message, Modal } from 'antd';
import { io, Socket } from 'socket.io-client';
import api from '../services/api';
import { useAuthStore } from '../stores/auth';
import { getSocketURL } from '../config/socket-url';
import { exitFullscreen } from '../components/exam/FullscreenGuard';

function recordBehavior(
  examId: string | undefined,
  studentId: string | undefined,
  behaviorType: string,
  metadata: Record<string, any> = {}
) {
  if (!examId || !studentId) return;
  api.post('/behaviors/record', { examId, studentId, behaviorType, metadata }).catch(() => {});
}

interface UseExamSessionOptions {
  examId: string | undefined;
  onNavigateToResult: (examId: string) => void;
}

export function useExamSession({ examId, onNavigateToResult }: UseExamSessionOptions) {
  const user = useAuthStore((s) => s.user);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);

  // Socket.IO connection for real-time monitoring
  useEffect(() => {
    const socket = io(getSocketURL(), { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('exam:join', {
        examId,
        studentId: user?.id,
        studentName: user?.realName || user?.username,
      });
    });

    // Heartbeat every 10s via socket
    const heartbeatInterval = setInterval(() => {
      socket.emit('exam:heartbeat', {
        examId,
        studentId: user?.id,
        tabSwitchCount,
      });
    }, 10000);

    return () => {
      clearInterval(heartbeatInterval);
      socket.disconnect();
    };
  }, [examId, user, tabSwitchCount]);

  // Tab switch detection (anti-cheat)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setTabSwitchCount((c) => {
          const newCount = c + 1;
          api.post(`/my-exams/${examId}/heartbeat`, { tabSwitchCount: newCount }).catch(() => {});
          recordBehavior(examId, user?.id, 'TAB_SWITCH', { tabSwitch: { count: newCount } });
          return newCount;
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [examId, user?.id]);

  // Heartbeat every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      api.post(`/my-exams/${examId}/heartbeat`, { tabSwitchCount }).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [examId, tabSwitchCount]);

  const doSubmit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      try {
        // Notify via socket first
        if (socketRef.current?.connected) {
          socketRef.current.emit('exam:submit', {
            examId,
            studentId: user?.id,
            studentName: user?.realName || user?.username,
          });
        }
        await api.post(`/my-exams/${examId}/submit`);
        if (auto) {
          message.warning('考试时间已到，已自动提交答卷');
        } else {
          message.success('提交成功！');
        }
        exitFullscreen();
        onNavigateToResult(examId!);
      } catch (err: any) {
        message.error(err.response?.data?.message || '提交失败');
        submittedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [examId, user, onNavigateToResult],
  );

  const handleSubmit = useCallback(() => {
    Modal.confirm({
      title: '确认提交',
      content: '提交后将无法修改，确定要提交答卷吗？',
      okText: '确认提交',
      cancelText: '再检查一下',
      onOk: () => doSubmit(false),
    });
  }, [doSubmit]);

  // Timer finish callback (auto-submit)
  const handleTimerFinish = useCallback(() => {
    if (!submittedRef.current) {
      doSubmit(true);
    }
  }, [doSubmit]);

  const handleFullscreenExit = useCallback(() => {
    recordBehavior(examId, user?.id, 'FULLSCREEN_EXIT', {
      reason: 'student exited fullscreen',
    });
    if (socketRef.current?.connected) {
      socketRef.current.emit('exam:fullscreen-exit', {
        examId,
        studentId: user?.id,
        studentName: user?.realName || user?.username,
      });
    }
  }, [examId, user?.id, user?.realName, user?.username]);

  return {
    tabSwitchCount,
    submitting,
    socketRef,
    doSubmit,
    handleSubmit,
    handleTimerFinish,
    handleFullscreenExit,
  };
}
