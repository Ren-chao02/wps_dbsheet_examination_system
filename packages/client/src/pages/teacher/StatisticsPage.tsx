import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Statistic, Row, Col, Table, Tag, Spin, message, Button, Space, Tabs } from 'antd';
import { TrophyOutlined, TeamOutlined, RiseOutlined, DownloadOutlined, RadarChartOutlined, UserOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';
import type { ExamStatistics } from '../../types';

const COLORS = ['#ff4d4f', '#faad14', '#1890ff', '#52c41a', '#13c2c2'];

export function StatisticsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ExamStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentStats, setStudentStats] = useState<any[]>([]);

  useEffect(() => {
    api.get(`/statistics/exam/${id}`).then(res => {
      setStats(res.data);
      // Load individual student stats for radar chart
      if (res.data.submissions?.length > 0) {
        const studentData = res.data.submissions.map((s: any) => ({
          name: s.studentName,
          score: s.score,
        }));
        setStudentStats(studentData);
      }
    }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  const handleExportCSV = async () => {
    try {
      const res = await api.get(`/statistics/exam/${id}/export`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stats?.examTitle || '成绩'}_分析报告.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch {
      message.error('导出失败');
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!stats) return null;

  // Prepare chart data
  const distributionData = Object.entries(stats.distribution).map(([range, count]) => ({
    range,
    count,
  }));

  const questionChartData = stats.questionStats.map(q => ({
    name: q.title.length > 12 ? q.title.slice(0, 12) + '…' : q.title,
    correctRate: q.correctRate,
    avgScore: q.avgScore,
    maxScore: q.maxScore,
  }));

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{stats.examTitle} — 成绩分析</h2>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={handleExportCSV}>导出 CSV</Button>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}><Card><Statistic title="答卷数" value={stats.submissionCount} prefix={<TeamOutlined />} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="平均分" value={stats.avgScore} suffix={`/ ${stats.totalScore}`} prefix={<RiseOutlined />} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="最高分" value={stats.maxScore} prefix={<TrophyOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={12} sm={6}><Card><Statistic title="通过率" value={stats.passRate ?? '—'} suffix={stats.passRate !== null ? '%' : ''} valueStyle={{ color: (stats.passRate ?? 0) >= 60 ? '#52c41a' : '#ff4d4f' }} /></Card></Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="分数段分布">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={distributionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="人数" radius={[4, 4, 0, 0]}>
                  {distributionData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="题目正确率">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={questionChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} unit="%" />
                <YAxis type="category" dataKey="name" width={100} />
                <Tooltip formatter={(value) => `${value}%`} />
                <Bar dataKey="correctRate" name="正确率" fill="#1890ff" radius={[0, 4, 4, 0]}>
                  {questionChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.correctRate >= 70 ? '#52c41a' : entry.correctRate >= 40 ? '#faad14' : '#ff4d4f'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Tabs
        defaultActiveKey="questions"
        items={[
          {
            key: 'questions',
            label: '题目分析',
            children: (
              <Table
                dataSource={stats.questionStats}
                rowKey="questionId"
                pagination={false}
                columns={[
                  { title: '题目', dataIndex: 'title', key: 'title', ellipsis: true },
                  { title: '类型', dataIndex: 'type', key: 'type', width: 80, render: (v: string) => <Tag>{v}</Tag> },
                  { title: '满分', dataIndex: 'maxScore', key: 'maxScore', width: 60 },
                  { title: '答题数', dataIndex: 'answerCount', key: 'answerCount', width: 80 },
                  { title: '正确数', dataIndex: 'correctCount', key: 'correctCount', width: 80 },
                  {
                    title: '正确率', dataIndex: 'correctRate', key: 'correctRate', width: 100,
                    render: (v: number) => (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 4, height: 8 }}>
                          <div style={{ width: `${v}%`, background: v >= 70 ? '#52c41a' : v >= 40 ? '#faad14' : '#ff4d4f', borderRadius: 4, height: '100%' }} />
                        </div>
                        <span style={{ color: v >= 70 ? '#52c41a' : v >= 40 ? '#faad14' : '#ff4d4f', minWidth: 40 }}>{v}%</span>
                      </div>
                    ),
                  },
                  { title: '均分', dataIndex: 'avgScore', key: 'avgScore', width: 60 },
                ]}
              />
            ),
          },
          {
            key: 'students',
            label: '学生成绩',
            children: (
              <Table
                dataSource={stats.submissions}
                rowKey="id"
                pagination={false}
                columns={[
                  { title: '学生', dataIndex: 'studentName', key: 'studentName' },
                  {
                    title: '分数', dataIndex: 'score', key: 'score', width: 100,
                    render: (v: number | null) => v !== null ? (
                      <span style={{ fontWeight: 600, color: v >= (stats.passScore || 0) ? '#52c41a' : '#ff4d4f' }}>{v}</span>
                    ) : '—',
                  },
                  {
                    title: '得分率', key: 'rate', width: 120,
                    render: (_: any, r: any) => r.score !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 4, height: 6, maxWidth: 60 }}>
                          <div style={{ width: `${(r.score / stats.totalScore) * 100}%`, background: '#1890ff', borderRadius: 4, height: '100%' }} />
                        </div>
                        <span style={{ fontSize: 12, color: '#666' }}>{Math.round((r.score / stats.totalScore) * 100)}%</span>
                      </div>
                    ) : '—',
                  },
                  { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 140, render: (v: string) => v ? new Date(v).toLocaleDateString('zh-CN') : '—' },
                  {
                    title: '操作', key: 'action', width: 100,
                    render: (_: any, r: any) => <Button type="link" size="small" icon={<UserOutlined />} onClick={() => navigate(`/teacher/students/${r.studentId}/profile`)}>画像</Button>,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
