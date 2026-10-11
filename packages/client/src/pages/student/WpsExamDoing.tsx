import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Typography, Tag, message, Spin, Alert, Progress, Space, Modal, Tooltip } from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import type { ObjectiveAnswerValue, StudentExamQuestion } from '../../types';
import { FullscreenGuard } from '../../components/exam/FullscreenGuard';
import {
  ObjectiveAnswer,
  hasObjectiveAnswer,
  isObjectiveQuestion,
  restoreObjectiveAnswers,
} from '../../components/exam/ObjectiveAnswer';
import { WpsTablePanel } from '../../components/wps/WpsTablePanel';
import { useExamSession } from '../../hooks/useExamSession';
import { computeExamDeadline, serverNow, syncServerTime } from '../../utils/exam-time';
import { groupByQuestionType, toChineseIndex } from '../../utils/questionLabels';

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
  // 最早交卷时刻（服务端下发，未配置为 null）：本地只负责禁用按钮与提示，校验以服务端为准
  const [submitAllowedAt, setSubmitAllowedAt] = useState<number | null>(null);
  // 底部帮助位弹窗：'tips' 作答提示 / 'troubleshoot' 遇到问题
  const [helpModal, setHelpModal] = useState<'tips' | 'troubleshoot' | null>(null);
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

  // ── 客观题作答与自动保存 ────────────────────────────────────────────
  // 客观题在页面内直接作答，必须随时落库：机房断电、浏览器崩溃、误刷新都不该丢答案
  // （与 server 端 PUT /my-exams/:id/answers 的「自动保存、可反复调用」口径一致）。
  const questions: StudentExamQuestion[] = data?.questions || [];
  const hasObjectiveQuestions = questions.some((q) => isObjectiveQuestion(q.type));
  // 答题卡按题型分组（顺序 = 题型在卷面中首次出现的顺序）；题号仍是全卷连续序号
  const questionGroups = useMemo(() => groupByQuestionType(questions), [questions]);
  const questionIndexById = useMemo(() => {
    const map = new Map<string, number>();
    questions.forEach((q, i) => map.set(q.id, i));
    return map;
  }, [questions]);

  // answers：各题最新作答。state 驱动 UI 回显；ref 供 debounce/卸载等时机读最新值，
  // 避免回调闭包里拿到过期值。
  const [answers, setAnswers] = useState<Record<string, ObjectiveAnswerValue>>({});
  const answersRef = useRef<Record<string, ObjectiveAnswerValue>>({});
  // dirty：改过但还没确认落库的题。保存成功后只清掉「发出后没再被改动」的题。
  const dirtyRef = useRef<Set<string>>(new Set());
  // 串行保存队列：所有 PUT 按序排队，避免并发请求乱序、旧值覆盖新值。
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  // 800ms debounce：连续改选只在停手后发一次请求，不每点一下打一次接口。
  const debounceTimerRef = useRef<number | null>(null);
  // 到点自动交卷前的兜底 flush 节流（3 秒一次）：网络故障时不每秒刷一次失败请求。
  const lastAutoFlushAtRef = useRef(0);
  // 保存状态：驱动题内轻量提示（已保存 HH:mm / 保存中 / 失败）与顶部失败横幅。
  const [saveStatus, setSaveStatus] = useState<{
    state: 'idle' | 'saving' | 'saved' | 'error';
    savedAt?: string;
    error?: string;
  }>({ state: 'idle' });

  /** 实际发出一次保存请求：取当时的 dirty 快照，成功后只清掉值没再变的题 */
  const runFlush = useCallback(async () => {
    const dirtyIds = Array.from(dirtyRef.current);
    if (dirtyIds.length === 0) return;
    setSaveStatus({ state: 'saving' });
    const payload = dirtyIds.map((qid) => ({ questionId: qid, answer: answersRef.current[qid] ?? null }));
    // 记录本次发出的值：请求飞行期间学生又改了某题时，成功后不能把新改动误清掉
    const sent = new Map(dirtyIds.map((qid, i) => [qid, payload[i].answer]));
    try {
      const res = await api.put(`/my-exams/${id}/answers`, { answers: payload });
      dirtyIds.forEach((qid) => {
        if (Object.is(answersRef.current[qid] ?? null, sent.get(qid))) dirtyRef.current.delete(qid);
      });
      setSaveStatus({ state: 'saved', savedAt: res.data?.savedAt ?? new Date().toISOString() });
    } catch (err: any) {
      // 失败不清 dirty：作答仍留在页面与待保存队列里，横幅 + 重试按钮可再次保存，不会静默丢失
      setSaveStatus({ state: 'error', error: err.response?.data?.message || '网络异常，请稍后重试' });
    }
  }, [id]);

  /**
   * 把待保存的作答立即落库（改选 debounce 到期 / 切题 / 切后台 / 卸载 / 交卷前都会调用）。
   * keepalive 模式只用于 beforeunload：页面马上销毁，axios 来不及完成，
   * 改用 fetch keepalive 尽力发出最新作答（此时 dirty 是否清掉已无意义）。
   */
  const flushSave = useCallback(
    (opts?: { keepalive?: boolean }): Promise<void> => {
      // flush 就是 debounce 定时器的「到期」行为：先把未触发的定时器清掉
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (opts?.keepalive) {
        const dirtyIds = Array.from(dirtyRef.current);
        if (dirtyIds.length === 0) return Promise.resolve();
        const payload = dirtyIds.map((qid) => ({ questionId: qid, answer: answersRef.current[qid] ?? null }));
        const token = localStorage.getItem('token');
        try {
          // keepalive 请求走原生 fetch（axios 拦截器带不了 keepalive），手动带上 token
          fetch(`/api/my-exams/${id}/answers`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ answers: payload }),
            keepalive: true,
          }).catch(() => { /* 页面即将卸载，失败也无法提示；常规保存链已兜底过大部分作答 */ });
        } catch {
          // 浏览器不支持 keepalive 时忽略：debounce / 切题 flush 已兜底
        }
        return Promise.resolve();
      }
      if (dirtyRef.current.size === 0) {
        // 没有待保存的：等已有队列收尾，保证调用方（交卷前检查）等到最终保存结果
        return chainRef.current;
      }
      // 串行排队：执行时再读 dirtyRef，拿到的永远是当时的最新值
      const next = chainRef.current.then(() => {
        if (dirtyRef.current.size > 0) return runFlush();
      });
      chainRef.current = next.catch(() => { /* runFlush 内部已捕获错误；兜底不让队列断链 */ });
      return next;
    },
    [id, runFlush],
  );

  /** 学生改选客观题：更新本地作答 → 800ms debounce 后自动保存 */
  const handleObjectiveChange = useCallback(
    (questionId: string) => (value: ObjectiveAnswerValue) => {
      // 多选清空（取消选择）按服务端契约归一成 null；单选/判断/多选正常值原样保存
      const normalized: ObjectiveAnswerValue = Array.isArray(value) && value.length === 0 ? null : value;
      answersRef.current = { ...answersRef.current, [questionId]: normalized };
      setAnswers((prev) => ({ ...prev, [questionId]: normalized }));
      dirtyRef.current.add(questionId);
      if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = window.setTimeout(() => {
        void flushSave();
      }, 800);
    },
    [flushSave],
  );

  // 切后台 / 关页 / 组件卸载时立即 flush：学生刚改完就切走时，改动还在 800ms debounce 里，
  // 不 flush 就会丢 —— 这是「作答不能静默丢失」的最后防线。
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) void flushSave();
    };
    const onBeforeUnload = () => {
      void flushSave({ keepalive: true });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void flushSave(); // 页面内跳走（卸载）时最后兜底一次
    };
  }, [flushSave]);

  /** 切题前先把仍在 debounce 里的作答 flush 落库，不丢刚选的选项 */
  const switchToStep = useCallback(
    (next: number) => {
      void flushSave();
      setCurrentStep(next);
    },
    [flushSave],
  );

  /**
   * 交卷前置检查：先把最后一笔作答 flush 落库（等保存链完成），再检查客观题未作答情况。
   * 客观题在页面内作答、最容易漏，交卷前明确列出未作答题号让学生确认；
   * 现有交卷确认（Modal.confirm + doSubmit）在 useExamSession.handleSubmit，不动它，这里只做前置检查。
   */
  const confirmSubmit = useCallback(() => {
    // 最早交卷本地兜底：按钮已禁用，这里防御"到点瞬间的竞态点击"，以服务端返回为准
    if (submitAllowedAt !== null && Date.now() < submitAllowedAt) {
      const remainMin = Math.max(1, Math.ceil((submitAllowedAt - Date.now()) / 60000));
      message.warning(`最早交卷时间未到，约 ${remainMin} 分钟后可交卷`);
      return;
    }
    void flushSave().finally(() => {
      const unanswered = questions
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => isObjectiveQuestion(q.type) && !hasObjectiveAnswer(answersRef.current[q.id]))
        .map(({ i }) => i + 1);
      if (unanswered.length > 0) {
        Modal.confirm({
          title: `还有 ${unanswered.length} 道客观题未作答`,
          content: `第 ${unanswered.join('、')} 题尚未作答。客观题提交后无法修改，确定要提交吗？`,
          okText: '仍要提交',
          okButtonProps: { danger: true },
          cancelText: '返回检查',
          onOk: () => handleSubmit(),
        });
        return;
      }
      handleSubmit();
    });
  }, [flushSave, questions, handleSubmit, submitAllowedAt]);

  const loadExam = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.get(`/my-exams/${id}`).then(res => {
      const d = res.data;
      setData(d);
      // 恢复客观题已保存的作答（刷新/断线重进不丢答案）：
      // 服务端存于 submission.details[].answerJson.answer（单选/判断为 string，多选为 string[]）。
      // 本地还有未保存成功（dirty）的作答时优先保留本地值，避免重新拉卷把刚选的答案冲掉。
      const restored = restoreObjectiveAnswers(d.submission?.details);
      const merged = { ...restored, ...answersRef.current };
      answersRef.current = merged;
      setAnswers(merged);
      // 优先用服务端下发的时间戳：随到随考模式下每人截止时间不同（开考时刻 + 时长，
      // 且不越过批次窗口），只有服务端算得准；本地推算仅作为老接口/字段缺失时的兜底。
      const dl = typeof d.deadline === 'number' ? d.deadline : computeExamDeadline(d.exam);
      if (dl !== null) setDeadline(dl);
      setSubmitAllowedAt(typeof d.submitAllowedAt === 'number' ? d.submitAllowedAt : null);
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
  // 最早交卷：未到时刻禁用交卷按钮并给出剩余分钟（配置值用于提示文案「开考 N 分钟内不可交卷」）
  const submitBlocked = submitAllowedAt !== null && now < submitAllowedAt;
  const submitBlockedMinutes = submitBlocked ? Math.max(1, Math.ceil((submitAllowedAt! - now) / 60000)) : 0;
  const earliestSubmitMinutes = Number(data?.exam?.settings?.earliestSubmitMinutes || 0);

  useEffect(() => {
    // 到点判定同样用服务端时间：本机钟快了也不提前收卷，钟慢了也不拖延收卷
    if (deadline && serverNow() >= deadline) {
      // 到点自动交卷前，先把仍在 debounce 里的作答落库（与手动交卷同一口径）。
      // 有待保存内容时最多每 3 秒重试一次，网络故障时不与自动交卷抢着刷失败请求。
      if (dirtyRef.current.size > 0 && Date.now() - lastAutoFlushAtRef.current > 3000) {
        lastAutoFlushAtRef.current = Date.now();
        void flushSave().finally(() => handleTimerFinish());
      } else {
        handleTimerFinish();
      }
    }
  }, [now, deadline, handleTimerFinish, flushSave]);

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

  const currentQuestion = questions[currentStep];
  const totalQuestions = questions.length;
  const progressPercent = totalQuestions > 0 ? Math.round(((currentStep + 1) / totalQuestions) * 100) : 0;

  // 保存成功只显示 HH:mm：轻量反馈，不把 ISO 时间串怼到学生脸上
  const formatSavedTime = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

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

            {/* 最早交卷未到：按钮禁用 + 悬停说明（disabled 的 antd 按钮不触发 Tooltip，需外层 span 承接） */}
            <Tooltip
              title={
                submitBlocked
                  ? earliestSubmitMinutes > 0
                    ? `开考 ${earliestSubmitMinutes} 分钟内不可交卷（约 ${submitBlockedMinutes} 分钟后可交卷）`
                    : `最早交卷时间未到（约 ${submitBlockedMinutes} 分钟后可交卷）`
                  : undefined
              }
            >
              <span>
                <Button type="primary" danger icon={<CheckOutlined />} onClick={confirmSubmit} loading={submitting} disabled={submitBlocked}>
                  交卷
                </Button>
              </span>
            </Tooltip>
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
              {/* 客观题作答保存失败：顶部横幅 + 重试入口（作答保留在页面与待保存队列里，不丢） */}
              {saveStatus.state === 'error' && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="客观题作答保存失败"
                  description={
                    <div>
                      你的作答已保留在本页面，不会丢失。网络恢复后请点击重试。
                      <Button size="small" type="primary" style={{ marginLeft: 8 }} onClick={() => void flushSave()}>
                        重试保存
                      </Button>
                    </div>
                  }
                />
              )}
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

                  {/* 客观题作答区：单选/多选/判断在页面内作答并自动保存；实操题保持原展示（去右侧表格操作） */}
                  {isObjectiveQuestion(currentQuestion.type) ? (
                    <Card size="small" style={{ marginBottom: 16 }}>
                      <ObjectiveAnswer
                        question={currentQuestion}
                        value={answers[currentQuestion.id] ?? null}
                        onChange={handleObjectiveChange(currentQuestion.id)}
                        disabled={submitting}
                      />
                      {/* 轻量保存状态：成功只有一行小字（不弹 message 打扰考试），失败在横幅有重试入口 */}
                      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #f0f0f0', minHeight: 22 }}>
                        {saveStatus.state === 'saving' && (
                          <Text type="secondary" style={{ fontSize: 12 }}>保存中…</Text>
                        )}
                        {saveStatus.state === 'saved' && saveStatus.savedAt && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            <CheckOutlined style={{ color: '#52c41a', marginRight: 4 }} />
                            已保存 {formatSavedTime(saveStatus.savedAt)}
                          </Text>
                        )}
                        {saveStatus.state === 'error' && (
                          <Text type="danger" style={{ fontSize: 12 }}>
                            <WarningOutlined style={{ marginRight: 4 }} />
                            保存失败：{saveStatus.error}
                          </Text>
                        )}
                      </div>
                    </Card>
                  ) : null}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>暂无题目</div>
              )}

              {/* Answer Sheet：按题型分组（组标题带题数与分值合计），题号保持全卷连续序号 */}
              <Card title="答题卡" size="small">
                {questionGroups.map((group, gi) => (
                  <div className="answer-sheet-group" key={group.type}>
                    <div className="answer-sheet-group__title">
                      {toChineseIndex(gi + 1)}、{group.label}（共{group.questions.length}题，共{group.totalScore}分）
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {group.questions.map((q) => {
                        const i = questionIndexById.get(q.id) ?? 0;
                        const isCurrent = i === currentStep;
                        const isObj = isObjectiveQuestion(q.type);
                        // 客观题区分「已作答/未作答」；实操题保持原样式，不强行判断
                        const answered = isObj && hasObjectiveAnswer(answers[q.id]);
                        return (
                          <Button
                            key={q.id}
                            type={isCurrent ? 'primary' : 'default'}
                            shape="round"
                            size="small"
                            onClick={() => switchToStep(i)}
                            style={{
                              minWidth: 36,
                              // 客观题已作答：绿色实线 + 对勾；未作答：灰色虚线
                              ...(isObj && !isCurrent && answered
                                ? { color: '#52c41a', borderColor: '#b7eb8f', background: '#f6ffed' }
                                : {}),
                              ...(isObj && !isCurrent && !answered
                                ? { borderStyle: 'dashed' as const, color: '#bfbfbf' }
                                : {}),
                            }}
                          >
                            {i + 1}
                            {isObj && answered && !isCurrent ? (
                              <CheckOutlined style={{ fontSize: 10, marginLeft: 2 }} />
                            ) : null}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {/* 图例：客观题小题的状态编码，避免学生把绿色/虚线当样式装饰 */}
                {hasObjectiveQuestions && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <span style={{ color: '#52c41a' }}>●</span> 客观题已作答
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <span style={{ color: '#d9d9d9' }}>◌</span> 客观题未作答
                    </Text>
                  </div>
                )}
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
                onClick={() => switchToStep(currentStep - 1)}
                icon={<LeftOutlined />}
                style={{ flex: 1, height: 44 }}
              >
                上一题
              </Button>
              {currentStep < totalQuestions - 1 ? (
                <Button
                  type="primary"
                  size="large"
                  onClick={() => switchToStep(currentStep + 1)}
                  icon={<RightOutlined />}
                  style={{ flex: 1, height: 44 }}
                >
                  下一题
                </Button>
              ) : (
                <Button
                  type="primary"
                  size="large"
                  onClick={confirmSubmit}
                  loading={submitting}
                  disabled={submitBlocked}
                  icon={<CheckOutlined />}
                  style={{ flex: 1, height: 44 }}
                >
                  提交答卷
                </Button>
              )}
            </div>

            {/* 帮助位：考试中两个高频求助入口。必须页内弹窗——跳去帮助文档会离开本页，
                被切屏统计记一次违规（参考产品的帮助位也是页内/客户端内呈现） */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
              padding: '6px 20px', background: '#fff', borderTop: '1px solid #f0f0f0',
            }}>
              <a style={{ fontSize: 12, color: '#666' }} onClick={() => setHelpModal('tips')}>
                <QuestionCircleOutlined style={{ marginRight: 4 }} />作答提示
              </a>
              <a style={{ fontSize: 12, color: '#666' }} onClick={() => setHelpModal('troubleshoot')}>
                <QuestionCircleOutlined style={{ marginRight: 4 }} />遇到问题？
              </a>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#aeaeb2' }}>
                作答自动保存，网络波动无需刷新
              </span>
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

      {/* 帮助弹窗：内容都是本系统的真实兜底能力（独立窗口/自动保存重试/教师续考），不是通用 FAQ */}
      <Modal
        title="作答提示"
        open={helpModal === 'tips'}
        onCancel={() => setHelpModal(null)}
        footer={null}
        width={540}
      >
        <ol style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li>所有操作在右侧的 WPS 多维表格中完成，不需要手动保存——系统会自动读取表格数据判分。</li>
          <li>表格显示不开时，点击表格面板右上角切换到「独立窗口工作台」；切到表格窗口不会计入切屏。</li>
          <li>客观题选择后自动保存（页面会显示「已保存」时间），保存失败会给出重试入口，作答不会丢失。</li>
          <li>考试时间结束后系统自动交卷，请合理分配作答时间。</li>
        </ol>
      </Modal>
      <Modal
        title="遇到问题？"
        open={helpModal === 'troubleshoot'}
        onCancel={() => setHelpModal(null)}
        footer={null}
        width={580}
      >
        <ul style={{ paddingLeft: 20, lineHeight: 2 }}>
          <li><b>表格打不开 / 显示空白：</b>切换到「独立窗口工作台」打开表格；右侧「实时数据」面板可确认表格当前状态。</li>
          <li><b>网络波动：</b>客观题作答自动保存在本机并持续重试上传，网络恢复后自动同步，<b>不需要刷新页面</b>。</li>
          <li><b>误交卷 / 需要继续作答：</b>举手联系监考老师，教师可以为你「允许续考」。</li>
          <li><b>页面卡顿：</b>不要重复刷新或关闭页面，举手联系监考老师处理。</li>
        </ul>
      </Modal>
    </FullscreenGuard>
  );
}
