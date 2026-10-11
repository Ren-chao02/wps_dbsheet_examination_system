import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Table, Spin, message } from 'antd';
import {
  UserOutlined,
  BookOutlined,
  FileTextOutlined,
  SendOutlined,
  CheckCircleOutlined,
  PercentageOutlined,
  PlusOutlined,
  FormOutlined,
  FundProjectionScreenOutlined,
  TeamOutlined,
  CloudUploadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import { StatCard } from '../../components/common/StatCard';
import { EmptyState } from '../../components/common/EmptyState';
import { NotificationListCard } from '../../components/common/NotificationListCard';
import type { OverviewStats } from '../../types';

/** 快捷入口：教师最高频的六个动作 */
const QUICK_ACTIONS = [
  { label: '创建考试', icon: <PlusOutlined />, path: '/teacher/exams/new/wizard' },
  { label: '新建题目', icon: <FormOutlined />, path: '/teacher/questions/new' },
  { label: '组卷', icon: <FundProjectionScreenOutlined />, path: '/teacher/papers/new' },
  { label: '自动阅卷', icon: <ThunderboltOutlined />, path: '/teacher/auto-grading' },
  { label: '学生管理', icon: <TeamOutlined />, path: '/teacher/students' },
  { label: '数据导出', icon: <CloudUploadOutlined />, path: '/teacher/export-center' },
];

export function TeacherDashboard() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/statistics/overview').then(res => setStats(res.data)).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!stats) return null;

  return (
    <div className="page-container">
      <div className="page-header"><h2>工作台</h2></div>

      {/* 指标卡：颜色只区分类别，数字保持醒目；学生/题目/考试可点击进入对应管理页 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={4}>
          <StatCard title="学生数" value={stats.totalStudents} icon={<UserOutlined />} tone="blue"
            onClick={() => navigate('/teacher/students')} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard title="题目数" value={stats.totalQuestions} icon={<BookOutlined />} tone="purple"
            onClick={() => navigate('/teacher/questions')} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard title="考试数" value={stats.totalExams} icon={<FileTextOutlined />} tone="cyan"
            onClick={() => navigate('/teacher/exams')} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard title="提交数" value={stats.totalSubmissions} icon={<SendOutlined />} tone="green"
            onClick={() => navigate('/teacher/auto-grading')} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard title="已阅卷" value={stats.gradedSubmissions} icon={<CheckCircleOutlined />} tone="orange"
            onClick={() => navigate('/teacher/auto-grading')} />
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <StatCard title="评分率" value={stats.gradingRate} suffix="%" icon={<PercentageOutlined />} tone="pink"
            onClick={() => navigate('/teacher/statistics')} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card
            title="最近考试"
            extra={<a onClick={() => navigate('/teacher/exams')}>全部考试</a>}
          >
            <Table
              dataSource={stats.recentExams}
              rowKey="id"
              pagination={false}
              locale={{
                emptyText: (
                  <EmptyState
                    title="还没有考试"
                    description="创建第一场考试后，这里会显示最近动态"
                    actionText="创建考试"
                    onAction={() => navigate('/teacher/exams/new/wizard')}
                  />
                ),
              }}
              columns={[
                { title: '考试名称', dataIndex: 'title', key: 'title' },
                { title: '模式', dataIndex: 'mode', key: 'mode', width: 100, render: (v: string) => ({ practice: '练习', quiz: '测验', exam: '正式考试' }[v]) },
                { title: '提交数', key: 'submissions', width: 90, render: (_: any, r: any) => r._count?.submissions ?? 0 },
                { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (v: string) => ({ draft: '草稿', published: '已发布', scheduled: '已排期', in_progress: '进行中', ended: '已结束', cancelled: '已取消', archived: '已归档' }[v]) },
                {
                  title: '操作', key: 'actions', width: 100, render: (_: any, r: any) => (
                    <a onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}>查看统计</a>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="快捷入口" style={{ marginBottom: 16 }} styles={{ body: { padding: 16 } }}>
            <Row gutter={[10, 10]}>
              {QUICK_ACTIONS.map((a) => (
                <Col span={12} key={a.path}>
                  <div className="quick-action" onClick={() => navigate(a.path)}>
                    <span className="quick-action__icon">{a.icon}</span>
                    <span className="quick-action__label">{a.label}</span>
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
          <NotificationListCard pageSize={6} />
        </Col>
      </Row>
    </div>
  );
}
