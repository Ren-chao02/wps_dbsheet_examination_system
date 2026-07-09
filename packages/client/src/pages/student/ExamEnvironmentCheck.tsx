import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Spin, message, Steps, Tag, Result, Space, Typography } from 'antd';
import {
  DesktopOutlined,
  WifiOutlined,
  ToolOutlined,
  FullscreenOutlined,
  ReloadOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { FullscreenGuard } from '../../components/exam/FullscreenGuard';

const { Title, Text } = Typography;

type CheckStatus = 'pending' | 'checking' | 'pass' | 'fail';

interface CheckItem {
  key: string;
  title: string;
  icon: React.ReactNode;
  description: string;
  status: CheckStatus;
  message?: string;
}

export function ExamEnvironmentCheck() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);
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

  useEffect(() => {
    api
      .get(`/my-exams/${id}`)
      .then((res) => setExam(res.data.exam))
      .catch(() => message.error('加载考试信息失败'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && exam) {
      runChecks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, exam]);

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
    const doc: any = document;
    const fullscreenOk = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );
    updateCheck('fullscreen', fullscreenOk ? 'pass' : 'fail', fullscreenOk ? undefined : '请先点击"进入全屏"按钮');
  };

  const allPassed = useMemo(() => checks.every((c) => c.status === 'pass'), [checks]);

  // 计算是否允许进入考场（匹配 ExamEntrySteps 的 canStart 逻辑）
  const canEnter = useMemo(() => {
    if (!exam) return false;
    const examMode = exam?.batch?.examMode || 'unified';
    const now = Date.now();

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
  }, [exam]);

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
      <FullscreenGuard active={true}>
        <div style={{ textAlign: 'center', padding: 100 }}>
          <Spin size="large" />
        </div>
      </FullscreenGuard>
    );
  }

  return (
    <FullscreenGuard active={true}>
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
                    const now = Date.now();

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
            <Steps direction="vertical" current={-1} items={checks.map((item) => {
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
                  </div>
                ),
              };
            })} />

            {!allPassed && (
              <div style={{ marginTop: 16, textAlign: 'center' }}>
                <Text type="secondary">请修复未通过项后点击“重新检测”</Text>
              </div>
            )}
          </Card>
        </div>
      </div>
    </FullscreenGuard>
  );
}
