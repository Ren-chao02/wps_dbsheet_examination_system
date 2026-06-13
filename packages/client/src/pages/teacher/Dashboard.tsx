import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Table, Spin, message } from 'antd';
import { UserOutlined, FileTextOutlined, BookOutlined, CheckCircleOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { OverviewStats } from '../../types';

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

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}><Card><Statistic title="学生数" value={stats.totalStudents} prefix={<UserOutlined />} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="题目数" value={stats.totalQuestions} prefix={<BookOutlined />} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="考试数" value={stats.totalExams} prefix={<FileTextOutlined />} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="评分率" value={stats.gradingRate} suffix="%" prefix={<CheckCircleOutlined />} /></Card></Col>
      </Row>

      <Card title="最近考试">
        <Table
          dataSource={stats.recentExams}
          rowKey="id"
          pagination={false}
          columns={[
            { title: '考试名称', dataIndex: 'title', key: 'title' },
            { title: '模式', dataIndex: 'mode', key: 'mode', render: (v: string) => ({ practice: '练习', quiz: '测验', exam: '正式考试' }[v]) },
            { title: '提交数', key: 'submissions', render: (_: any, r: any) => r._count?.submissions ?? 0 },
            { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => ({ draft: '草稿', published: '已发布', in_progress: '进行中', ended: '已结束', archived: '已归档' }[v]) },
            {
              title: '操作', key: 'actions', render: (_: any, r: any) => (
                <a onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}>查看统计</a>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
