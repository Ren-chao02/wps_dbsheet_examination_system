import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Spin, message, Steps, Tag, Result, Space, Typography } from 'antd';
import {
  DesktopOutlined,
  WifiOutlined,
  ToolOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  ArrowRightOutlined,
  CloudOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { FullscreenGuard } from '../../components/exam/FullscreenGuard';
import { useWpsEmbed } from '../../hooks/useWpsEmbed';
import { serverNow, syncServerTime } from '../../utils/exam-time';

const { Title, Text } = Typography;

type CheckStatus = 'pending' | 'checking' | 'pass' | 'fail';

interface CheckItem {
  key: string;
  title: string;
  icon: React.ReactNode;
  description: React.ReactNode;
  status: CheckStatus;
  message?: string;
}

export function ExamEnvironmentCheck() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);
  // 可入场时段判定用服务端时间（serverNow）：机房电脑 CMOS 漂移时本机 Date.now()
  // 与服务端时间戳错位，会导致「未到候考/已过迟到」判错。每秒刷新一次，
  // 也让 canEnter 随考试窗口开放自动变可入（此前只算一次，早到的学生需刷新页面）。
  const [now, setNow] = useState(() => Date.now());
  // 全屏项连续失败计数：连续失败后允许「跳过并标记」（见 handleSkipFullscreen）
  const [fullscreenFailCount, setFullscreenFailCount] = useState(0);
  // 已跳过全屏检查：重新检测时保持通过态，不因「文档确实没在全屏」反复报失败
  const fullscreenSkippedRef = useRef(false);
  // ── WPS 登录检测（仅在本场考试分配了多维表格时出现）──
  // 部分分配表会跳 WPS 登录页，内嵌 iframe 又受三方 Cookie 策略限制，
  // 因此把「登录 WPS」提前到考前做掉：学生只需登录一次，整场考试都不再被登录墙拦住。
  const [wpsShareUrl, setWpsShareUrl] = useState<string | null>(null);
  const [wpsStatus, setWpsStatus] = useState<CheckStatus>('pending');
  // 登录窗口打开期间挂起全屏守护（切到 WPS 登录窗口是预期行为）
  const [guardSuspended, setGuardSuspended] = useState(false);
  const [checks, setChecks] = useState<CheckItem[]>([
    {
      key: 'browser',
      title: '浏览器兼容性',
      icon: <DesktopOutlined />,
      description: '检查浏览器是否支持全屏等必要 API',
      status: 'pending',
    },
    {
      key: 'network',
      title: '网络连通性',
      icon: <WifiOutlined />,
      description: '检查网络连接及服务器可达性',
      status: 'pending',
    },
    {
      key: 'system',
      title: '系统资源',
      icon: <ToolOutlined />,
      description: '检查屏幕分辨率、CPU 核心数等硬件资源',
      status: 'pending',
    },
    {
      key: 'fullscreen',
      title: '全屏模式',
      icon: <FullscreenOutlined />,
      description: '检查当前是否处于全屏状态',
      status: 'pending',
    },
  ]);

  // 打开 WPS 登录窗口（顶层窗口，登录/扫码均正常；能复用已打开的窗口）
  const { openWorkbench, focusWorkbench, workbenchOpen, popupBlocked } = useWpsEmbed(wpsShareUrl, {
    storageKey: `envcheck:${id}`,
    onWorkbenchChange: setGuardSuspended,
  });

  useEffect(() => {
    api
      .get(`/my-exams/${id}`)
      .then((res) => {
        setExam(res.data.exam);
        setWpsShareUrl(res.data.wpsTable?.shareUrl || null);
      })
      .catch(() => message.error('加载考试信息失败'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && exam) {
      runChecks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, exam]);

  // 每秒刷新服务端时间：canEnter 与页面上的时段提示随之重算
  useEffect(() => {
    void syncServerTime();
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);

  const updateCheck = (key: string, status: CheckStatus, message?: string) => {
    setChecks((prev) =>
      prev.map((item) => (item.key === key ? { ...item, status, message } : item))
    );
  };

  const runChecks = async () => {
    setChecks((prev) => prev.map((item) => ({ ...item, status: 'checking' })));

    // 1. 浏览器兼容性
    const browserOk = 'requestFullscreen' in document.documentElement;
    updateCheck('browser', browserOk ? 'pass' : 'fail', browserOk ? undefined : '当前浏览器不支持全屏 API，请使用最新版 Chrome/Edge/Firefox');

    // 2. 网络连通性
    try {
      const online = navigator.onLine;
      if (!online) throw new Error('网络未连接');
      await api.get('/health', { timeout: 5000 });
      updateCheck('network', 'pass');
    } catch (err: any) {
      updateCheck('network', 'fail', err.message || '无法连接到服务器');
    }

    // 3. 系统资源
    const memory = (navigator as any).deviceMemory;
    const cores = navigator.hardwareConcurrency || 1;
    const screenOk = window.screen.width >= 1024 && window.screen.height >= 600;
    const memoryOk = memory === undefined || memory >= 2;
    const systemOk = screenOk && cores >= 2 && memoryOk;
    updateCheck(
      'system',
      systemOk ? 'pass' : 'fail',
      systemOk ? undefined : '屏幕分辨率或硬件资源不满足最低要求'
    );

    // 4. 全屏状态
    // 已被学生「跳过并标记」（无法全屏）：保持通过态并保留说明，不因重新检测反复报失败
    if (fullscreenSkippedRef.current) {
      updateCheck('fullscreen', 'pass', '已跳过全屏检查（无法进入全屏，已记录）');
      return;
    }
    const doc: any = document;
    const fullscreenOk = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );
    // 连续失败计数：企业 GPO / 电子教室软件拒绝全屏时，连续失败后放行「跳过并标记」
    setFullscreenFailCount((c) => (fullscreenOk ? 0 : c + 1));
    updateCheck(
      'fullscreen',
      fullscreenOk ? 'pass' : 'fail',
      fullscreenOk
        ? undefined
        : '未能进入全屏（可能被企业策略或电子教室软件限制）。请点弹窗中的「重新进入全屏」重试；连续失败后可「跳过并标记」继续入场'
    );
  };

  /**
   * 全屏检查「跳过并标记」：requestFullscreen 被浏览器策略拒绝（企业 GPO、
   * 电子教室软件等）时，学生不能因此永远进不了考场。跳过时记一笔行为
   * （FULLSCREEN_EXIT + metadata.reason: 'unsupported'），并把该项标记为通过
   * （附带说明），不再阻塞入场 —— 异常留痕，监考可查。
   */
  const handleSkipFullscreen = useCallback(() => {
    fullscreenSkippedRef.current = true;
    setFullscreenFailCount(0);
    updateCheck('fullscreen', 'pass', '已跳过全屏检查（无法进入全屏，已记录）');
    // 环境检测页没有考试会话，直接走 behavior 上报通道
    api
      .post('/behaviors/record', {
        examId: id,
        studentId: user?.id,
        behaviorType: 'FULLSCREEN_EXIT',
        metadata: { reason: 'unsupported', source: 'env-check' },
      })
      .catch(() => {});
    message.info('已跳过全屏检查并已记录，考试中请保持考试页面在最前');
  }, [id, user?.id]);

  // WPS 登录检测项：只有本场考试分配了多维表格时才出现，且需学生手动确认（无法跨域自动探测登录态）
  const wpsCheckItem: CheckItem = useMemo(
    () => ({
      key: 'wps',
      title: 'WPS 账号登录',
      icon: <CloudOutlined />,
      description: (
        <div style={{ lineHeight: 1.9 }}>
          <div>本场考试需在 WPS 多维表格中作答，请先登录 WPS 账号（登录一次，整场考试无需重复登录）。</div>
          <Space style={{ marginTop: 8 }} wrap>
            {workbenchOpen ? (
              <Button size="small" icon={<ExportOutlined />} onClick={focusWorkbench}>
                回到 WPS 登录窗口
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={openWorkbench}>
                打开 WPS 登录窗口
              </Button>
            )}
            <Button
              size="small"
              disabled={wpsStatus === 'pass'}
              onClick={() => setWpsStatus('pass')}
            >
              我已完成登录
            </Button>
          </Space>
          {popupBlocked && (
            <div style={{ color: '#ff4d4f', marginTop: 6 }}>
              窗口被浏览器拦截：请允许本站弹出窗口后重试
            </div>
          )}
          {wpsStatus !== 'pass' && (
            <div style={{ color: '#999', marginTop: 6 }}>
              登录方式：手机号 / 微信 / QQ 扫码均可。登录成功后回到本页点「我已完成登录」。
            </div>
          )}
        </div>
      ),
      status: wpsStatus,
      message: wpsStatus === 'pass' ? undefined : '未确认登录',
    }),
    [wpsStatus, workbenchOpen, popupBlocked, openWorkbench, focusWorkbench],
  );

  const allChecks = useMemo(
    () => (wpsShareUrl ? [...checks, wpsCheckItem] : checks),
    [checks, wpsCheckItem, wpsShareUrl],
  );

  const allPassed = useMemo(() => allChecks.every((c) => c.status === 'pass'), [allChecks]);

  // 计算是否允许进入考场（匹配 ExamEntrySteps 的 canStart 逻辑）。
  // now 为服务端时间（每秒刷新）：机房电脑时钟漂移时不会误判可入场时段。
  const canEnter = useMemo(() => {
    if (!exam) return false;
    const examMode = exam?.batch?.examMode || 'unified';

    if (examMode === 'flexible') {
      const winStart = exam?.batch?.startTime ? new Date(exam.batch.startTime).getTime() : null;
      const winEnd = exam?.batch?.endTime ? new Date(exam.batch.endTime).getTime() : null;
      if (winStart && now < winStart) return false;
      if (winEnd && now > winEnd) return false;
      return true;
    }

    // unified mode
    const examStart = exam?.startTime ? new Date(exam.startTime).getTime() : null;
    const examEnd = exam?.endTime ? new Date(exam.endTime).getTime() : null;
    const batch = exam?.batch;

    if (!examStart) return false; // 无开考时间，不允许进入

    const waitingMs = (batch?.waitingTime || 0) * 60 * 1000;
    const lateMs = (batch?.lateTolerance || 0) * 60 * 1000;

    // 候考窗口未到
    if (now < examStart - waitingMs) return false;
    // 已超过迟到截止时间
    if (lateMs > 0 && now > examStart + lateMs) return false;
    // 考试已结束
    if (examEnd && now > examEnd) return false;

    return true;
  }, [exam, now]);

  const handleEnterExamRoom = async () => {
    if (!allPassed) {
      message.warning('请先完成环境检测并通过所有项目');
      return;
    }
    if (!canEnter) {
      message.warning('当前不在可入场时段');
      return;
    }
    setEntering(true);
    try {
      // 标记环境检测已通过，防止直接 URL 跳过检测
      sessionStorage.setItem(`env_check_passed_${id}`, '1');
      navigate(`/student/exam/${id}/entry`);
    } finally {
      setEntering(false);
    }
  };

  if (loading) {
    return (
      <FullscreenGuard active={true} onForceContinue={handleSkipFullscreen}>
        <div style={{ textAlign: 'center', padding: 100 }}>
          <Spin size="large" />
        </div>
      </FullscreenGuard>
    );
  }

  return (
    <FullscreenGuard active={true} suspended={guardSuspended} onForceContinue={handleSkipFullscreen}>
      <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
        <div style={{ background: '#1890ff', padding: '32px 24px', textAlign: 'center', color: '#fff' }}>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>WPS教学平台-考前环境检测</Title>
          <p style={{ marginTop: 8, opacity: 0.9 }}>请各位考生务必完成“设备检测”等考前环境检测，以免影响正常考试</p>
        </div>

        <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
          <Card title="我的考试" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: '#f0f0f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 32,
                  color: '#999',
                }}
              >
                考
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <Text strong>考试名称：</Text>{exam?.title}
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Text strong>考试时间：</Text>
                  {(() => {
                    const examMode = exam?.batch?.examMode || 'unified';
                    if (examMode === 'flexible') {
                      const winStart = exam?.batch?.startTime;
                      const winEnd = exam?.batch?.endTime;
                      if (winStart && winEnd) {
                        return `${dayjs(winStart).format('YYYY-MM-DD HH:mm')} ~ ${dayjs(winEnd).format('YYYY-MM-DD HH:mm')}（随到随考）`;
                      }
                      return '随到随考（时间窗口未设置）';
                    }
                    // unified mode: use exam's own start/end time
                    const st = exam?.startTime;
                    const et = exam?.endTime;
                    return st ? `${dayjs(st).format('YYYY-MM-DD HH:mm')} - ${et ? dayjs(et).format('YYYY-MM-DD HH:mm') : '—'}` : '—';
                  })()}
                </div>
                <div style={{ marginBottom: 8 }}>
                  <Text strong>考试时长：</Text>{exam?.durationMinutes ? `${exam.durationMinutes} 分钟` : '不限时'}
                </div>
                <div style={{ color: '#ff4d4f' }}>
                  {(() => {
                    const examMode = exam?.batch?.examMode || 'unified';
                    // now 为服务端时间（见顶部 ticker）：时段提示与 canEnter 口径一致

                    // ── 随到随考模式 ──
                    if (examMode === 'flexible') {
                      const winStart = exam?.batch?.startTime ? new Date(exam.batch.startTime).getTime() : null;
                      const winEnd = exam?.batch?.endTime ? new Date(exam.batch.endTime).getTime() : null;

                      if (winStart && now < winStart) {
                        return `考试窗口将于 ${dayjs(winStart).format('YYYY-MM-DD HH:mm')} 开放，请耐心等待`;
                      }
                      if (winEnd && now > winEnd) {
                        return '考试窗口已关闭';
                      }
                      return '随到随考窗口已开放，请及时入场';
                    }

                    // ── 集中统一模式 ──
                    // 使用考试自身的 startTime（不回退到批次时间）
                    const examStart = exam?.startTime ? new Date(exam.startTime).getTime() : null;
                    const examEnd = exam?.endTime ? new Date(exam.endTime).getTime() : null;
                    const batch = exam?.batch;
                    const waitingMs = (batch?.waitingTime || 0) * 60 * 1000;
                    const lateMs = (batch?.lateTolerance || 0) * 60 * 1000;

                    if (examStart) {
                      // 考试尚未开始
                      if (now < examStart) {
                        const waitingStart = examStart - waitingMs;
                        if (now < waitingStart) {
                          return `考试将于 ${dayjs(examStart).format('YYYY-MM-DD HH:mm')} 开始，候考 ${dayjs(waitingStart).format('YYYY-MM-DD HH:mm')} 起可入场`;
                        }
                        // 候考窗口内
                        return `距开考还有 ${Math.ceil((examStart - now) / 60000)} 分钟，请耐心等待`;
                      }
                      // 考试已开始，检查迟到
                      if (lateMs > 0) {
                        const lateCutoff = examStart + lateMs;
                        if (now > lateCutoff) {
                          return '已超过迟到时间，无法进入考试';
                        }
                      }
                    }

                    // 考试已结束
                    if (examEnd && now > examEnd) {
                      return '考试已结束';
                    }

                    // 开考中
                    if (examStart) {
                      return '已开考，请及时入场';
                    }

                    // 无考试时间信息
                    return '待开考';
                  })()}
                </div>
              </div>
              <Button
                type="primary"
                size="large"
                icon={<ArrowRightOutlined />}
                disabled={!allPassed || !canEnter}
                loading={entering}
                onClick={handleEnterExamRoom}
              >
                进入考场
              </Button>
            </div>
          </Card>

          <Card
            title="环境检测"
            extra={
              <Button icon={<ReloadOutlined />} onClick={runChecks} loading={checks.some((c) => c.status === 'checking')}>
                重新检测
              </Button>
            }
          >
            <Steps direction="vertical" current={-1} items={allChecks.map((item) => {
              let statusIcon: React.ReactNode;
              if (item.status === 'pass') statusIcon = <Tag color="success">通过</Tag>;
              else if (item.status === 'fail') statusIcon = <Tag color="error">未通过</Tag>;
              else if (item.status === 'checking') statusIcon = <Tag color="processing">检测中</Tag>;
              else statusIcon = <Tag>待检测</Tag>;

              return {
                title: (
                  <Space>
                    {item.icon}
                    <span>{item.title}</span>
                    {statusIcon}
                  </Space>
                ),
                description: (
                  <div>
                    <div>{item.description}</div>
                    {item.message && <Text type="danger">{item.message}</Text>}
                    {/* 全屏项连续失败后放行「跳过并标记」：企业策略限制全屏时不能把学生永久挡在考场外 */}
                    {item.key === 'fullscreen' && item.status === 'fail' && fullscreenFailCount >= 2 && (
                      <div style={{ marginTop: 8 }}>
                        <Button size="small" type="primary" onClick={handleSkipFullscreen}>
                          无法全屏，跳过并标记（已记录）
                        </Button>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          仅当浏览器被企业策略/电子教室软件限制全屏时使用
                        </Text>
                      </div>
                    )}
                  </div>
                ),
              };
            })} />

            {!allPassed && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <Text type="secondary">
                  请逐项完成检测；「WPS 账号登录」需完成登录后点「我已完成登录」，其余项目点「重新检测」
                </Text>
              </div>
            )}
          </Card>
        </div>
      </div>
    </FullscreenGuard>
  );
}
