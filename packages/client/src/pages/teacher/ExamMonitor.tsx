import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Table, Tag, Card, Statistic, Row, Col, Spin, message } from 'antd';
import api from '../../services/api';

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'warning', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
};

export function ExamMonitor() {
  const { id } = useParams<{ id: string }>();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await api.get(`/exams/${id}/submissions`);
      setSubmissions(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); const interval = setInterval(fetchData, 10000); return () => clearInterval(interval); }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  const counts = {
    total: submissions.length,
    inProgress: submissions.filter((s: any) => s.status === 'in_progress').length,
    submitted: submissions.filter((s: any) => s.status === 'submitted').length,
    graded: submissions.filter((s: any) => s.status === 'graded').length,
  };

  return (
    <div className="page-container">
      <div className="page-header"><h2>考场监控</h2></div>
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="总考生" value={counts.total} /></Card></Col>
        <Col span={6}><Card><Statistic title="答题中" value={counts.inProgress} valueStyle={{ color: '#1890ff' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已提交" value={counts.submitted} valueStyle={{ color: '#faad14' }} /></Card></Col>
        <Col span={6}><Card><Statistic title="已评分" value={counts.graded} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>
      <Card title="考生状态">
        <Table
          dataSource={submissions}
          rowKey="id"
          pagination={false}
          columns={[
            { title: '学生', key: 'student', render: (_: any, r: any) => r.student?.realName || r.student?.username || '—' },
            { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = statusMap[v] || { color: 'default', text: v }; return <Tag color={s.color}>{s.text}</Tag>; } },
            { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
            { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
            { title: '得分', dataIndex: 'totalScore', key: 'totalScore', render: (v: number | null) => v !== null ? v : '—' },
          ]}
        />
      </Card>
    </div>
  );
}
