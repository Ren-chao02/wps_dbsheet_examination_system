import { useEffect, useRef, useCallback, useState } from 'react';
import { message, Modal } from 'antd';
import { io, Socket } from 'socket.io-client';
import api from '../services/api';
import { useAuthStore } from '../stores/auth';
import { createAuthedSocket } from '../config/socket-url';
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

/** 自动交卷失败后的重试间隔（倒计时每秒触发一次调用，失败时按此节流） */
const AUTO_SUBMIT_RETRY_MS = 15_000;
/**
 * 自动交卷最大重试次数。
 * 耗尽后停止自动重试，改由页面展示「前往成绩页」入口（见 WpsExamDoing），
 * 避免无限重试 + 红色报错刷屏把学生困在答题页。
 */
const AUTO_SUBMIT_MAX_RETRIES = 10;

export function useExamSession({ examId, onNavigateToResult }: UseExamSessionOptions) {
  const user = useAuthStore((s) => s.user);
  const [tabSwitchCount, setTabSwitchCountState] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  /** 自动交卷重试耗尽：停止自动重试，UI 显示「前往成绩页」入口 */
  const [autoSubmitExhausted, setAutoSubmitExhausted] = useState(false);
  const submittedRef = useRef(false);
  const lastAutoAttemptAtRef = useRef(0);
  const autoAttemptCountRef = useRef(0);
  const autoSubmitExhaustedRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  /**
   * 切屏豁免：学生按系统指引打开「表格独立窗口」期间，离开本页是预期行为，
   * 不应计入切屏违规（否则每看一眼表格就 +1 次违规）。
   * 用 ref 而非 state —— 打开窗口会立刻抢焦点并触发 visibilitychange，
   * 豁免必须在 window.open 之前同步生效。
   */
  const tabSwitchExemptRef = useRef(false);
  const setTabSwitchExempt = useCallback((exempt: boolean) => {
    tabSwitchExemptRef.current = exempt;
  }, []);
  /**
   * tabSwitchCount 的最新值镜像到 ref：
   * 若把 state 放进 socket / 心跳 effect 的依赖数组，每切一次屏就会 disconnect +
   * 重连 + 重新 join + 重启定时器（切屏重连风暴）。心跳改用 ref 读最新值，
   * effect 只随 examId / user 变化而重建。
   */
  const tabSwitchCountRef = useRef(0);
  const setTabSwitchCount = useCallback((next: number) => {
    tabSwitchCountRef.current = next;
    setTabSwitchCountState(next);
  }, []);

  // Socket.IO connection for real-time monitoring
  useEffect(() => {
    const socket = createAuthedSocket({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('exam:join', {
        examId,
        studentId: user?.id,
        studentName: user?.realName || user?.username,
      });
    });

    // Heartbeat every 10s via socket（用 ref 读最新切屏数，避免依赖 state 导致切屏重连）
    const heartbeatInterval = setInterval(() => {
      socket.emit('exam:heartbeat', {
        examId,
        studentId: user?.id,
        tabSwitchCount: tabSwitchCountRef.current,
      });
    }, 10000);

    return () => {
      clearInterval(heartbeatInterval);
      socket.disconnect();
    };
  }, [examId, user]);

  // Tab switch detection (anti-cheat)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (tabSwitchExemptRef.current) return; // 表格窗口已打开且学生在其中：属于预期离开
        const newCount = tabSwitchCountRef.current + 1;
        setTabSwitchCount(newCount);
        api.post(`/my-exams/${examId}/heartbeat`, { tabSwitchCount: newCount }).catch(() => {});
        recordBehavior(examId, user?.id, 'TAB_SWITCH', { tabSwitch: { count: newCount } });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [examId, user?.id, setTabSwitchCount]);

  // Heartbeat every 30s（HTTP 兜底；同样用 ref 读最新值，避免每次切屏重启定时器）
  useEffect(() => {
    const interval = setInterval(() => {
      api.post(`/my-exams/${examId}/heartbeat`, { tabSwitchCount: tabSwitchCountRef.current }).catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [examId]);

  const doSubmit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      // 自动交卷重试已耗尽：停止自动重试（手动「交卷」仍可继续尝试）
      if (auto && autoSubmitExhaustedRef.current) return;
      // 自动交卷由倒计时每秒触发，失败必须节流，否则会每秒打一次接口并弹一次错误提示
      if (auto && Date.now() - lastAutoAttemptAtRef.current < AUTO_SUBMIT_RETRY_MS) return;
      lastAutoAttemptAtRef.current = Date.now();
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
        autoAttemptCountRef.current = 0;
        if (auto) {
          message.warning('考试时间已到，已自动提交答卷');
        } else {
          message.success('提交成功！');
        }
        exitFullscreen();
        onNavigateToResult(examId!);
      } catch (err: any) {
        const errMessage: string = err.response?.data?.message || '';
        // 服务端 400「已提交，无法重复提交」表示答卷其实已交上（手点交卷、到点自动交卷、
        // 服务端收卷三者并发时，后到者会拿到这个响应）。此时必须按成功处理：
        // 正常提示并去成绩页 —— 否则会每 15 秒重试、红错刷屏，学生已交卷却以为自己
        // 没交上，页面又没有任何去成绩页的按钮，被永久卡在答题页。
        if (err.response?.status === 400 && errMessage.includes('已提交')) {
          message.info('答卷已提交，正在前往成绩页');
          exitFullscreen();
          onNavigateToResult(examId!);
          return;
        }
        if (auto) {
          autoAttemptCountRef.current += 1;
          const attempt = autoAttemptCountRef.current;
          if (attempt >= AUTO_SUBMIT_MAX_RETRIES) {
            // 重试耗尽：停止自动重试，页面展示「前往成绩页」入口，由学生手动确认
            autoSubmitExhaustedRef.current = true;
            setAutoSubmitExhausted(true);
            message.error({
              content: '自动交卷多次失败，请点击「前往成绩页」确认交卷状态或联系监考老师',
              key: 'auto-submit-exhausted',
            });
          } else {
            // 同一 key 的提示会就地更新，保持「仍在重试」的语义且不刷屏
            message.error({
              content: `自动交卷失败，正在重试（第 ${attempt}/${AUTO_SUBMIT_MAX_RETRIES} 次）：${errMessage || '网络异常'}`,
              key: 'auto-submit-error',
            });
          }
        } else {
          message.error(errMessage || '提交失败');
        }
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
    // 重试耗尽后不再自动触发（页面已有「前往成绩页」入口）
    if (!submittedRef.current && !autoSubmitExhaustedRef.current) {
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

  /**
   * 浏览器/系统策略导致无法进入全屏（企业 GPO、电子教室软件、退全屏后的冷却期）：
   * 学生在全屏弹窗点「无法全屏，继续考试（会记录）」后走到这里 —— 记一笔行为
   * （FULLSCREEN_EXIT + metadata.reason: unsupported），守护组件挂起全屏检查，
   * 考试继续，异常留痕供监考复盘。
   */
  const handleFullscreenUnavailable = useCallback(() => {
    recordBehavior(examId, user?.id, 'FULLSCREEN_EXIT', {
      reason: 'unsupported',
    });
  }, [examId, user?.id]);

  return {
    tabSwitchCount,
    submitting,
    socketRef,
    doSubmit,
    handleSubmit,
    handleTimerFinish,
    handleFullscreenExit,
    handleFullscreenUnavailable,
    autoSubmitExhausted,
    setTabSwitchExempt,
  };
}
