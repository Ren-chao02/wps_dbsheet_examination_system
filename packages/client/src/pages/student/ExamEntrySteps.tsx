import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Checkbox, Spin, message, Modal, Steps, Avatar } from 'antd';
import {
  UserOutlined,
  LogoutOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { exitFullscreen } from '../../components/exam/FullscreenGuard';

const RULES_TEXT = `考场开放
1. 各科考试考场开放时间（包括考场开放开始时间及考场入口关闭时间）将公布在"WPS实训室-考试系统-首页-我的待考科目"中；
2. 考场开放后考生可以登录并进入相应考场，请考生务必在考场入口关闭前进入考场，并完成考生信息确认、阅读考规（每次重新进入考场时均需重新完成信息确认等工作），完成后保持登录状态等候考试开始；
3. 考场入口：WPS 365教育版 - WPS教学平台 应用 - WPS实训室 - 我的考试；
4. 若系统界面显示过小/过大（如"下一步"等按钮未显示出等），请前往电脑的显示设置-屏幕中，调整缩放比例/显示器分辨率至合适值；
5. 相应科目的考场入口关闭后，未按照本条第2款的约定完成相应考前工作的考生不得再进入考场。

考试纪律
1. 考生应本人参加考试，严禁由他人替代考试或替代他人考试；
2. 考试过程中，考生不得离开考试页面、切换屏幕、打开其他软件或网页，不得查阅资料、使用通讯工具或接受他人协助；
3. 考生须在规定时间内完成答卷，考试时间结束后系统将自动提交；
4. 考生须在指定的 WPS 多维表格中进行操作，所有作答将被系统自动记录并评分；
5. 考生应自觉遵守考场纪律，服从监考人员管理，违者将按相关规定处理。`;

/** WPS 多维表格题型中文映射 */
const QUESTION_TYPE_LABELS: Record<string, string> = {
  create_table: '创建表格',
  add_field: '添加字段',
  config_view: '配置视图',
  create_form: '创建表单',
  comprehensive: '综合操作',
};

function formatCountdown(ms: number) {
  if (ms <= 0) return '00分00秒';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
  }
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

export function ExamEntrySteps() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [readRemaining, setReadRemaining] = useState(0);

  // 是否跳过规则阅读（继续答题场景：已有进行中的答题记录）
  const skipRules = submission?.status === 'in_progress';

  const rulesContent = exam?.batch?.rulesContent || RULES_TEXT;
  const rulesReadSeconds = exam?.batch?.rulesReadSeconds ?? 15;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (step === 1) {
      setReadRemaining(rulesReadSeconds);
      setAgreed(false);
      const timer = setInterval(() => {
        setReadRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [step, rulesReadSeconds]);

  useEffect(() => {
    Promise.all([
      api.get(`/my-exams/${id}`).then((res) => {
        setExam(res.data.exam);
        setSubmission(res.data.submission);
        setQuestions(res.data.questions || []);
      }),
      api.get('/student-profile/me').then((res) => setProfile(res.data)),
    ])
      .catch(() => message.error('加载考试信息失败'))
      .finally(() => setLoading(false));
  }, [id]);

  // 校验是否通过了环境检测，防止直接 URL 跳过
  useEffect(() => {
    if (!loading && !sessionStorage.getItem(`env_check_passed_${id}`)) {
      message.warning('请先完成考前环境检测');
      navigate(`/student/exam/${id}/check`, { replace: true });
    }
  }, [loading, id, navigate]);

  // 考试模式信息
  const examMode = exam?.batch?.examMode || 'unified';

  // 考试自身时间（批次时间仅作考试周期参考，不作为回退）
  const modeEffectiveStart = useMemo(() => {
    return exam?.startTime ? new Date(exam.startTime).getTime() : null;
  }, [exam]);

  const modeEffectiveEnd = useMemo(() => {
    return exam?.endTime ? new Date(exam.endTime).getTime() : null;
  }, [exam]);

  const modeEffectiveDuration = useMemo(() => {
    return exam?.batch?.examDuration || exam?.durationMinutes || 0;
  }, [exam]);

  const deadline = useMemo(() => {
    if (!exam) return null;
    if (modeEffectiveEnd) return modeEffectiveEnd;
    if (modeEffectiveStart && modeEffectiveDuration) {
      return modeEffectiveStart + modeEffectiveDuration * 60 * 1000;
    }
    return null;
  }, [exam, modeEffectiveStart, modeEffectiveEnd, modeEffectiveDuration]);

  const remaining = useMemo(() => {
    if (!deadline) return null;
    return deadline - now;
  }, [deadline, now]);

  // 集中统一模式：距离开考倒计时（含候考窗口）
  const waitingTime = exam?.batch?.waitingTime || 0;
  const lateTolerance = exam?.batch?.lateTolerance || 0;

  const untilStart = useMemo(() => {
    if (examMode !== 'unified' || !modeEffectiveStart) return null;
    // 候考窗口未到：返回距候考开始的时间
    const waitingStart = modeEffectiveStart - waitingTime * 60 * 1000;
    if (now < waitingStart) return waitingStart - now;
    // 候考窗口内但未到开考时间：返回距开考的时间
    if (now < modeEffectiveStart) return modeEffectiveStart - now;
    return null;
  }, [examMode, modeEffectiveStart, now, waitingTime]);

  // Step 2 中是否可以开始作答
  const canStart = useMemo(() => {
    if (examMode === 'flexible') return true;
    // unified: 到达开考时间后方可开始，但不能超过迟到截止时间
    if (!modeEffectiveStart) return true;
    const lateCutoff = modeEffectiveStart + lateTolerance * 60 * 1000;
    return now >= modeEffectiveStart && now <= lateCutoff;
  }, [examMode, modeEffectiveStart, now, lateTolerance]);

  // 迟到截止提示
  const isLate = useMemo(() => {
    if (examMode !== 'unified' || !modeEffectiveStart) return false;
    const lateCutoff = modeEffectiveStart + lateTolerance * 60 * 1000;
    return now > lateCutoff;
  }, [examMode, modeEffectiveStart, now, lateTolerance]);

  const timeLabel = step === 2 && examMode === 'unified' && untilStart !== null && untilStart > 0
    ? '距离开考'
    : isLate
      ? '已过迟到截止'
      : step === 2
        ? '最晚进入考场时间'
        : '考试剩余时间';
  const timeColor = step === 2 && examMode === 'unified' && untilStart !== null && untilStart > 0 ? '#1890ff' : isLate ? '#ff4d4f' : step === 2 ? '#ff4d4f' : '#52c41a';

  const handleExit = () => {
    Modal.confirm({
      title: '确认退出考场',
      content: '退出后将返回考试列表，是否继续？',
      okText: '确认退出',
      cancelText: '取消',
      onOk: () => {
        exitFullscreen();
        navigate('/student/dashboard');
      },
    });
  };

  const handleLogout = () => {
    Modal.confirm({
      title: '确认切换账号',
      content: '切换账号将退出当前登录，是否继续？',
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        exitFullscreen();
        logout();
        navigate('/login');
      },
    });
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await api.post(`/my-exams/${id}/start-wps`);
      navigate(`/student/exam/${id}/wps`);
    } catch (err: any) {
      message.error(err.response?.data?.message || '开始作答失败');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Spin size="large" />
      </div>
    );
  }

  const studentName = user?.realName || user?.username || '—';
  const studentId = profile?.studentId || '—';
  const examTitle = exam?.title || '—';
  const timeRange =
    exam?.startTime && exam?.endTime
      ? `${dayjs(exam.startTime).format('YYYY-MM-DD HH:mm')} - ${dayjs(exam.endTime).format('YYYY-MM-DD HH:mm')}`
      : '—';
  const durationText = exam?.durationMinutes ? `${exam.durationMinutes} 分钟` : '不限时';

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header
        style={{
          height: 64,
          background: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: '#1890ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            W
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>WPS教学平台</div>
            <div style={{ fontSize: 12, color: '#999', lineHeight: 1.2 }}>考试系统</div>
          </div>
        </div>

        <div style={{ fontSize: 18, fontWeight: 700 }}>{examTitle}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar size="small" icon={<UserOutlined />} />
          {remaining !== null && (
            <div
              style={{
                background: timeColor,
                color: '#fff',
                padding: '4px 12px',
                borderRadius: 4,
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              <ClockCircleOutlined />
              <span>{timeLabel}</span>
              <span style={{ fontWeight: 700 }}>
                {step === 2 && examMode === 'unified' && untilStart !== null && untilStart > 0
                  ? formatCountdown(untilStart)
                  : remaining !== null
                    ? formatCountdown(remaining)
                    : '—'}
              </span>
            </div>
          )}
          <Button danger icon={<LogoutOutlined />} onClick={handleExit}>
            退出考场
          </Button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, padding: '24px 32px', overflow: 'auto' }}>
        <div
          style={{
            maxWidth: 1000,
            margin: '0 auto',
            background: '#fff',
            borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            minHeight: 'calc(100vh - 64px - 48px - 60px)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '24px 48px 0' }}>
            <Steps
              current={step}
              titlePlacement="horizontal"
              items={[
                { title: '核对考生信息' },
                { title: '阅读考场规则' },
                { title: '开始作答' },
              ]}
            />
          </div>

          <div style={{ flex: 1, padding: '32px 48px 24px' }}>
            {step === 0 && (
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>确认考生信息</h3>
                <p style={{ color: '#666', marginBottom: 40 }}>请仔细核对您的考生信息是否正确</p>

                <div style={{ maxWidth: 480, lineHeight: 2.2 }}>
                  <div style={{ display: 'flex' }}>
                    <span style={{ color: '#666', width: 90 }}>考生姓名：</span>
                    <span style={{ fontWeight: 500 }}>{studentName}</span>
                  </div>
                  <div style={{ display: 'flex' }}>
                    <span style={{ color: '#666', width: 90 }}>学号：</span>
                    <span style={{ fontWeight: 500 }}>{studentId}</span>
                  </div>
                  <div style={{ display: 'flex' }}>
                    <span style={{ color: '#666', width: 90 }}>考试名称：</span>
                    <span style={{ fontWeight: 500 }}>{examTitle}</span>
                  </div>
                  <div style={{ display: 'flex' }}>
                    <span style={{ color: '#666', width: 90 }}>考试时间：</span>
                    <span style={{ fontWeight: 500 }}>{timeRange}</span>
                  </div>
                  <div style={{ display: 'flex' }}>
                    <span style={{ color: '#666', width: 90 }}>考试时长：</span>
                    <span style={{ fontWeight: 500 }}>{durationText}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 80 }}>
                  <Button size="large" style={{ minWidth: 140 }} onClick={handleLogout}>
                    切换考试账号
                  </Button>
                  <Button type="primary" size="large" style={{ minWidth: 140 }} onClick={() => setStep(skipRules ? 2 : 1)}>
                    下一步
                  </Button>
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>阅读考场规则</h3>
                <p style={{ color: '#666', marginBottom: 24 }}>为保证考试顺利进行，请仔细阅读并同意以下考场规则</p>

                <div
                  style={{
                    border: '1px solid #e8e8e8',
                    borderRadius: 8,
                    padding: '16px 20px',
                    maxHeight: 360,
                    overflow: 'auto',
                    background: '#fafafa',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.8,
                    color: '#333',
                    marginBottom: 24,
                  }}
                >
                  {rulesContent}
                </div>

                <div style={{ marginBottom: 32 }}>
                  <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={readRemaining > 0}>
                    我同意，并承诺题目作答由个人独立完成，答题中不会获取网络、书籍、他人等帮助
                    {readRemaining > 0 && (
                      <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                        需再阅读 {readRemaining} 秒
                      </span>
                    )}
                  </Checkbox>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <Button
                    type="primary"
                    size="large"
                    style={{ minWidth: 200 }}
                    disabled={!agreed || readRemaining > 0}
                    onClick={() => setStep(2)}
                  >
                    同意并承诺遵守考规
                  </Button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                {examMode === 'unified' && untilStart !== null && untilStart > 0 ? (
                  <>
                    <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>等候开考</h3>
                    <p style={{ color: '#666', marginBottom: 24 }}>
                      考试将在 {dayjs(modeEffectiveStart).format('HH:mm:ss')} 统一开始，请耐心等候
                    </p>

                    <div
                      style={{
                        background: '#e6f7ff',
                        border: '1px solid #91d5ff',
                        borderRadius: 8,
                        padding: '16px 24px',
                        marginBottom: 28,
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>距离开考还有</div>
                      <div style={{ fontSize: 32, fontWeight: 700, color: '#1890ff', fontFamily: 'monospace' }}>
                        {formatCountdown(untilStart)}
                      </div>
                    </div>
                  </>
                ) : isLate ? (
                  <>
                    <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: '#ff4d4f' }}>已超过入场截止时间</h3>
                    <p style={{ color: '#666', marginBottom: 24 }}>
                      您已超过迟到容忍时间（{lateTolerance} 分钟），无法进入考试
                    </p>
                  </>
                ) : (
                  <>
                    <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
                      {examMode === 'flexible' ? '开始作答' : '准备作答'}
                    </h3>
                    <p style={{ color: '#666', marginBottom: 24 }}>
                      {examMode === 'flexible'
                        ? '随到随考模式，点击下方按钮即可开始考试'
                        : '考试已开始，请点击下方按钮进入作答'}
                    </p>
                  </>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#52c41a', marginBottom: 28 }}>
                  <CheckCircleOutlined />
                  <span style={{ fontWeight: 500 }}>试卷下载成功</span>
                </div>

                <div style={{ marginBottom: 28 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>题型介绍</h4>
                  <ul style={{ paddingLeft: 20, color: '#333', lineHeight: 2 }}>
                    <li>卷面总分：{exam?.totalScore || 100}分</li>
                    <li>答题总时长：{durationText}</li>
                    <li>题目数量：{questions.length} 题</li>
                    {(() => {
                      // 按题型分组统计
                      const typeGroups: Record<string, { label: string; count: number; totalScore: number }> = {};
                      for (const q of questions) {
                        const type = q.type || 'comprehensive';
                        const label = QUESTION_TYPE_LABELS[type] || type;
                        if (!typeGroups[type]) {
                          typeGroups[type] = { label, count: 0, totalScore: 0 };
                        }
                        typeGroups[type].count++;
                        typeGroups[type].totalScore += q.score || q.scoreOverride || 0;
                      }
                      return Object.values(typeGroups).map((g, i) => (
                        <li key={i}>{g.label}：{g.count} 题（共{g.totalScore}分）</li>
                      ));
                    })()}
                  </ul>
                </div>

                <div>
                  <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>作答须知</h4>
                  <ol style={{ paddingLeft: 20, color: '#333', lineHeight: 2 }}>
                    <li>本考试基于 WPS 多维表格进行操作，您将在指定的多维表格中完成所有题目；</li>
                    <li>系统会自动获取您的多维表格 Schema 数据，并对您的操作进行实时记录和评分；</li>
                    <li>作答过程中请勿关闭或切换多维表格页面，保持网络连接稳定；</li>
                    <li>考试时间结束后系统将自动提交答卷，请合理分配作答时间；</li>
                    <li>
                      请仔细阅读
                      <a style={{ color: '#1890ff', marginLeft: 4 }}>作答提示</a>
                      ，了解各题型的操作要求
                    </li>
                  </ol>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 60 }}>
                  <Button size="large" style={{ minWidth: 140 }} onClick={() => setStep(1)}>
                    上一步
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    style={{ minWidth: 140 }}
                    loading={starting}
                    disabled={!canStart}
                    onClick={handleStart}
                  >
                    {!canStart && untilStart !== null && untilStart > 0
                      ? `请等待 ${formatCountdown(untilStart)}`
                      : isLate
                        ? '已超过入场截止时间'
                        : '开始作答'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer helpers */}
      <footer
        style={{
          height: 48,
          background: '#fff',
          borderTop: '1px solid #e8e8e8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 24,
          padding: '0 32px',
          flexShrink: 0,
        }}
      >
        <a style={{ color: '#999', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <QuestionCircleOutlined />
          问题解答
        </a>
        <a style={{ color: '#999', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <FileTextOutlined />
          作答提示
        </a>
        <a style={{ color: '#999', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <MessageOutlined />
          意见反馈
        </a>
      </footer>
    </div>
  );
}
