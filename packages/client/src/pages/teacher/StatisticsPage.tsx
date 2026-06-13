import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Statistic, Row, Col, Table, Tag, Spin, message } from 'antd';
import { TrophyOutlined, TeamOutlined, RiseOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { ExamStatistics } from '../../types';

export function StatisticsPage() {
  const { id } = useParams<{ id: string }>();
  const [stats, setStats] = useState<ExamStatistics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/statistics/exam/${id}`).then(res => setStats(res.data)).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!stats) return null;

  return (
    <div className="page-container">
      <div className="page-header"><h2>{stats.examTitle} — 成绩分析</h2></div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8}><Card><Statistic title="答卷数" value={stats.submissionCount} prefix={<TeamOutlined />} /></Card></Col>
        <Col xs={12} sm={8}><Card><Statistic title="平均分" value={stats.avgScore} suffix={`/ ${stats.totalScore}`} prefix={<RiseOutlined />} /></Card></Col>
        <Col xs={12} sm={8}><Card><Statistic title="最高分" value={stats.maxScore} prefix={<TrophyOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}><Card><Statistic title="最低分" value={stats.minScore} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
        {stats.passRate !== null && <Col xs={12} sm={6}><Card><Statistic title="通过率" value={stats.passRate} suffix="%" valueStyle={{ color: stats.passRate >= 60 ? '#52c41a' : '#ff4d4f' }} /></Card></Col>}
        <Col xs={12} sm={6}><Card><Statistic title="90-100" value={stats.distribution['90-100'] || 0} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="0-59" value={stats.distribution['0-59'] || 0} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="题目分析" style={{ marginBottom: 16 }}>
            <Table
              dataSource={stats.questionStats}
              rowKey="questionId"
              pagination={false}
              size="small"
              columns={[
                { title: '题目', dataIndex: 'title', key: 'title', ellipsis: true },
                { title: '类型', dataIndex: 'type', key: 'type', width: 60, render: (v: string) => <Tag>{v}</Tag> },
                { title: '正确率', dataIndex: 'correctRate', key: 'correctRate', width: 80, render: (v: number) => <span style={{ color: v >= 70 ? '#52c41a' : v >= 40 ? '#faad14' : '#ff4d4f' }}>{v}%</span> },
                { title: '均分', dataIndex: 'avgScore', key: 'avgScore', width: 60 },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="学生成绩" style={{ marginBottom: 16 }}>
            <Table
              dataSource={stats.submissions}
              rowKey="id"
              pagination={false}
              size="small"
              columns={[
                { title: '学生', dataIndex: 'studentName', key: 'studentName' },
                { title: '分数', dataIndex: 'score', key: 'score', width: 80, render: (v: number | null) => v !== null ? v : '—' },
                { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 140, render: (v: string) => v ? new Date(v).toLocaleDateString('zh-CN') : '—' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
