import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Table, Tag, Spin, message, Button, Space } from 'antd';
import { ArrowLeftOutlined, TrophyOutlined, CheckCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import api from '../../services/api';

interface StudentProfileData {
  student: { id: string; username: string; realName: string | null };
  totalExams: number;
  avgScore: number;
  passedExams: number;
  passRate: number;
  submissions: {
    examTitle: string;
    mode: string;
    score: number | null;
    passScore: number | null;
    passed: boolean | null;
    submittedAt: string | null;
  }[];
  abilityRadar: { type: string; rate: number }[];
}

export function StudentProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<StudentProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/statistics/student/${id}`).then(res => setData(res.data)).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!data) return null;

  // Trend data: score over time
  const trendData = data.submissions
    .filter(s => s.score !== null && s.submittedAt)
    .map(s => ({
      date: new Date(s.submittedAt!).toLocaleDateString('zh-CN'),
      score: s.score!,
    }))
    .reverse();

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)} />
          <h2 style={{ margin: 0 }}>{data.student.realName || data.student.username} — 能力画像</h2>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="参加考试" value={data.totalExams} prefix={<FileTextOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均分" value={data.avgScore} prefix={<TrophyOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="通过考试" value={data.passedExams} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="通过率" value={data.passRate} suffix="%" valueStyle={{ color: data.passRate >= 60 ? '#52c41a' : '#ff4d4f' }} /></Card></Col>
      </Row>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="能力雷达图（按题型）">
            {data.abilityRadar.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <RadarChart data={data.abilityRadar}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="type" />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} />
                  <Radar name="正确率" dataKey="rate" stroke="#1890ff" fill="#1890ff" fillOpacity={0.3} />
                  <Tooltip formatter={(value) => `${value}%`} />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无数据</div>
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="成绩趋势">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="score" stroke="#1890ff" strokeWidth={2} dot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无数据</div>
            )}
          </Card>
        </Col>
      </Row>

      <Card title="考试记录">
        <Table
          dataSource={data.submissions}
          rowKey={(r, i) => `${r.examTitle}-${i}`}
          pagination={false}
          columns={[
            { title: '考试', dataIndex: 'examTitle', key: 'examTitle' },
            { title: '模式', dataIndex: 'mode', key: 'mode', width: 80, render: (v: string) => <Tag>{v}</Tag> },
            {
              title: '分数', dataIndex: 'score', key: 'score', width: 80,
              render: (v: number | null) => v !== null ? v : '—',
            },
            {
              title: '结果', key: 'passed', width: 80,
              render: (_: any, r: any) => r.passed === null ? '—' : (
                <Tag color={r.passed ? 'success' : 'error'}>{r.passed ? '通过' : '未通过'}</Tag>
              ),
            },
            {
              title: '时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 140,
              render: (v: string) => v ? new Date(v).toLocaleDateString('zh-CN') : '—',
            },
          ]}
        />
      </Card>
    </div>
  );
}
