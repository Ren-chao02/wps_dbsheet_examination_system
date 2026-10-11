import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Button, Spin, message, Avatar, Typography, Space, Tag } from 'antd';
import {
  BookOutlined,
  FileTextOutlined,
  TrophyOutlined,
  StarOutlined,
  UserOutlined,
  TeamOutlined,
  BankOutlined,
  ProfileOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  RightOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { enterFullscreen } from '../../components/exam/FullscreenGuard';
import { EmptyState } from '../../components/common/EmptyState';
import { NotificationListCard } from '../../components/common/NotificationListCard';
import { isExamWindowClosed, type ExamWithSubmission } from './Dashboard';

const { Title, Text } = Typography;

interface StudentProfile {
  realName: string | null;
  username: string;
  studentId: string | null;
  department?: string;
  major?: string;
  classRoom?: string;
  academicYear?: string;
  stats: {
    examCount: number;
    gradedCount: number;
    practiceCount: number;
    favoriteCount: number;
    wrongCount: number;
  };
}

/** 待办考试的时间文案（口径与「我的考试」一致：随到随考看批次窗口，统一考试看自身时间） */
function examTimeText(exam: ExamWithSubmission): string {
  const isFlexible = exam.batch?.examMode === 'flexible';
  if (isFlexible) {
    const start = exam.batch?.startTime ? dayjs(exam.batch.startTime).format('MM-DD HH:mm') : null;
    const end = exam.batch?.endTime ? dayjs(exam.batch.endTime).format('MM-DD HH:mm') : null;
    return start ? `随到随考 ${start}${end ? ` ~ ${end}` : ''}` : '批次时间待定';
  }
  const start = exam.startTime ? dayjs(exam.startTime).format('MM-DD HH:mm') : null;
  const end = exam.endTime ? dayjs(exam.endTime).format('MM-DD HH:mm') : null;
  return start ? `${start}${end ? ` ~ ${end}` : ''}` : '考试时间待定';
}

export function StudentHome() {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [exams, setExams] = useState<ExamWithSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([
      api.get('/student-profile/me'),
      // 待办聚合依赖考试列表；失败不阻塞个人资料展示
      api.get('/my-exams').catch(() => ({ data: [] })),
    ])
      .then(([profileRes, examsRes]) => {
        setProfile(profileRes.data);
        setExams(examsRes.data || []);
      })
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  // 待办 = 还没出成绩、窗口未关闭的考试；考试中的排最前，其余按开始时间升序（越快开的越靠前）
  const todoExams = exams
    .filter((exam) => {
      const status = exam.mySubmission?.status ?? 'pending';
      if (status === 'submitted' || status === 'graded') return false;
      return !isExamWindowClosed(exam);
    })
    .sort((a, b) => {
      const aLive = a.mySubmission?.status === 'in_progress' ? 0 : 1;
      const bLive = b.mySubmission?.status === 'in_progress' ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      const ta = new Date(a.startTime || a.batch?.startTime || 0).getTime();
      const tb = new Date(b.startTime || b.batch?.startTime || 0).getTime();
      return ta - tb;
    })
    .slice(0, 3);

  const goExam = async (examId: string) => {
    await enterFullscreen();
    navigate(`/student/exam/${examId}/check`);
  };

  return (
    <div className="page-container">
      <Card style={{ marginBottom: 16 }}>
        <Space align="start" size="large">
          <Avatar size={80} icon={<UserOutlined />} />
          <div>
            <Title level={3} style={{ marginBottom: 8 }}>
              {profile.realName || profile.username}
            </Title>
            <Space wrap>
              {profile.studentId && <Text type="secondary">学号：{profile.studentId}</Text>}
              {profile.classRoom && (
                <Text type="secondary">
                  <TeamOutlined /> {profile.classRoom}
                </Text>
              )}
              {profile.major && (
                <Text type="secondary">
                  <BankOutlined /> {profile.major}
                </Text>
              )}
              {profile.department && (
                <Text type="secondary">
                  <ProfileOutlined /> {profile.department}
                </Text>
              )}
            </Space>
          </div>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          {/* 待完成的考试：首页第一优先级，进行中的考试直接给「继续答题」入口 */}
          <Card
            title={`待完成的考试${todoExams.length > 0 ? `（${todoExams.length}）` : ''}`}
            extra={<a onClick={() => navigate('/student/dashboard')}>我的考试</a>}
            style={{ marginBottom: 16 }}
          >
            {todoExams.length === 0 ? (
              <EmptyState
                title="暂无待完成的考试"
                description="新的考试安排会显示在这里，也可以先去题库练习"
                actionText="去题库练习"
                onAction={() => navigate('/student/practice')}
              />
            ) : (
              todoExams.map((exam) => {
                const inProgress = exam.mySubmission?.status === 'in_progress';
                return (
                  <div className="todo-exam" key={exam.id}>
                    <div className="todo-exam__info">
                      <div className="todo-exam__title" title={exam.title}>
                        {exam.title}
                      </div>
                      <div className="todo-exam__meta">
                        <Tag color={inProgress ? 'processing' : 'blue'} style={{ margin: 0 }}>
                          {inProgress ? '考试中' : '待入场'}
                        </Tag>
                        <span>
                          <ClockCircleOutlined /> {examTimeText(exam)}
                        </span>
                        {exam.roomName && (
                          <span>
                            <EnvironmentOutlined /> {exam.roomName}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button type="primary" onClick={() => goExam(exam.id)}>
                      {inProgress ? '继续答题' : '进入考试'}
                    </Button>
                  </div>
                );
              })
            )}
          </Card>

          <NotificationListCard pageSize={6} />
        </Col>

        <Col xs={24} lg={8}>
          <Card title="我的数据" style={{ marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
            {/* 行列表而非 2×2 宫格：右栏宽度随视口变化，行列表在任何宽度下都不会挤压标签 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: '我的考试', value: profile.stats.examCount, icon: <FileTextOutlined />, color: '#3b82f6', path: '/student/dashboard' },
                { label: '练习次数', value: profile.stats.practiceCount, icon: <BookOutlined />, color: '#8b5cf6', path: '/student/practice' },
                { label: '已出成绩', value: profile.stats.gradedCount, icon: <TrophyOutlined />, color: '#22a06b', path: '/student/history' },
                { label: '收藏题目', value: profile.stats.favoriteCount, icon: <StarOutlined />, color: '#e8890c', path: '/student/favorites' },
              ].map((m) => (
                <div key={m.label} className="quick-action" onClick={() => navigate(m.path)}>
                  <span className="quick-action__icon" style={{ color: m.color }}>{m.icon}</span>
                  <span className="quick-action__label" style={{ flex: 1 }}>{m.label}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--apple-text-h1)', fontVariantNumeric: 'tabular-nums' }}>
                    {m.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="快捷入口" styles={{ body: { padding: 16 } }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="quick-action" onClick={() => navigate('/student/dashboard')}>
                <span className="quick-action__icon"><FileTextOutlined /></span>
                <span className="quick-action__label" style={{ flex: 1 }}>进入考试</span>
                <RightOutlined style={{ fontSize: 11, color: '#aeaeb2' }} />
              </div>
              <div className="quick-action" onClick={() => navigate('/student/practice')}>
                <span className="quick-action__icon"><BookOutlined /></span>
                <span className="quick-action__label" style={{ flex: 1 }}>题库练习</span>
                <RightOutlined style={{ fontSize: 11, color: '#aeaeb2' }} />
              </div>
              <div className="quick-action" onClick={() => navigate('/student/history')}>
                <span className="quick-action__icon"><TrophyOutlined /></span>
                <span className="quick-action__label" style={{ flex: 1 }}>成绩查询</span>
                <RightOutlined style={{ fontSize: 11, color: '#aeaeb2' }} />
              </div>
              <div className="quick-action" onClick={() => navigate('/student/favorites')}>
                <span className="quick-action__icon"><StarOutlined /></span>
                <span className="quick-action__label" style={{ flex: 1 }}>我的题集</span>
                <RightOutlined style={{ fontSize: 11, color: '#aeaeb2' }} />
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
