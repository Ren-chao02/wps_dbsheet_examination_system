import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Tag, Button, Empty, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { TrophyOutlined } from '@ant-design/icons';
import api from '../../services/api';

const { Title } = Typography;

interface HistoryItem {
  id: string;
  status: string;
  totalScore: number | null;
  submittedAt: string | null;
  gradedAt: string | null;
  graderComment: string | null;
  exam: {
    id: string;
    title: string;
    totalScore: number;
    passScore: number | null;
    startTime: string | null;
    endTime: string | null;
  };
}

function formatTime(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ExamHistory() {
  const navigate = useNavigate();
  const [data, setData] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/my-exams/history')
      .then((res) => setData(res.data))
      .catch(() => {
        message.error('加载失败');
        setData([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const columns: ColumnsType<HistoryItem> = [
    {
      title: '考试名称',
      dataIndex: ['exam', 'title'],
      key: 'title',
      ellipsis: true,
    },
    {
      title: '提交时间',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 180,
      render: formatTime,
    },
    {
      title: '评分时间',
      dataIndex: 'gradedAt',
      key: 'gradedAt',
      width: 180,
      render: formatTime,
    },
    {
      title: '得分',
      key: 'score',
      width: 180,
      render: (_, r) => {
        const score = r.totalScore ?? 0;
        const pass = r.exam.passScore;
        const passed = pass !== null && pass !== undefined ? score >= pass : null;
        return (
          <span>
            <span style={{ fontWeight: 600 }}>{score}</span>
            <span style={{ color: '#999' }}> / {r.exam.totalScore}</span>
            {passed !== null && (
              <Tag color={passed ? 'success' : 'error'} style={{ marginLeft: 8 }}>
                {passed ? '通过' : '未通过'}
              </Tag>
            )}
          </span>
        );
      },
    },
    {
      title: '及格线',
      key: 'passScore',
      width: 100,
      render: (_, r) => (r.exam.passScore !== null && r.exam.passScore !== undefined ? r.exam.passScore : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 110,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => navigate(`/student/exam/${r.exam.id}/result`)}>
          查看详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <TrophyOutlined />
        <Title level={4} style={{ marginBottom: 0 }}>
          成绩查询
        </Title>
      </div>
      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无已出分的成绩" /> }}
        />
      </Card>
    </div>
  );
}
