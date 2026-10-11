/**
 * 学情总览 - 成绩统计分析入口页
 *
 * 结构 = 学情总览（跨场汇总 KPI + 趋势）→ 单场成绩分析（/teacher/exams/:id/statistics）→ 学生画像。
 * 借鉴 WPS 教学平台的「总览学情」：同一页给出应参考/到考/缺考/通过率与逐场趋势，
 * 教师不必逐场点开才能判断"哪一场出了问题"。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, message, Card, Input, Row, Col, Spin } from 'antd';
import { BarChartOutlined, SearchOutlined } from '@ant-design/icons';
import {
  TeamOutlined, CheckCircleOutlined, UserDeleteOutlined, TrophyOutlined,
  RiseOutlined, PercentageOutlined,
} from '@ant-design/icons';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend } from 'recharts';
import api from '../../services/api';
import { StatCard } from '../../components/common/StatCard';
import { EmptyState } from '../../components/common/EmptyState';
import type { Exam, PaginatedResponse } from '../../types';

const statusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'blue', text: '已发布' },
  scheduled: { color: 'cyan', text: '已排期' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'blue', text: '已结束' },
  cancelled: { color: 'red', text: '已取消' },
  archived: { color: 'orange', text: '已归档' },
};

/** 后端 /exams 列表为监考/学情场景附加的四数统计 */
interface ExamWithStats extends Exam {
  submissionStats?: { assigned: number; attended: number; submitted: number; absent: number };
}

interface TeachingSummary {
  overview: {
    examCount: number;
    assigned: number;
    attended: number;
    absent: number;
    submitted: number;
    graded: number;
    attendRate: number | null;
    submitRate: number | null;
    passRate: number | null;
  };
  exams: Array<{
    examId: string;
    title: string;
    endTime: string | null;
    assigned: number;
    attended: number;
    absent: number;
    submitted: number;
    gradedCount: number;
    avgScore: number | null;
    avgScoreRate: number | null;
    passRate: number | null;
  }>;
}

export function StatisticsList() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<ExamWithStats>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [summary, setSummary] = useState<TeachingSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchExams = async (page = 1, searchVal = '') => {
    setLoading(true);
    try {
      const res = await api.get(`/exams?page=${page}&pageSize=20${searchVal ? `&search=${searchVal}` : ''}`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => {
    fetchExams();
    api.get('/statistics/teaching-summary')
      .then((res) => setSummary(res.data))
      .catch(() => { /* 汇总失败不阻塞考试列表 */ })
      .finally(() => setSummaryLoading(false));
  }, []);

  const trendData = (summary?.exams || []).map((e) => ({
    name: e.title.length > 10 ? e.title.slice(0, 10) + '…' : e.title,
    得分率: e.avgScoreRate,
    通过率: e.passRate,
  }));

  const columns = [
    { title: '考试名称', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '应参考', key: 'assigned', width: 90, align: 'center' as const,
      render: (_: any, r: ExamWithStats) => r.submissionStats?.assigned ?? '-',
    },
    {
      title: '到考', key: 'attended', width: 90, align: 'center' as const,
      render: (_: any, r: ExamWithStats) => {
        const v = r.submissionStats?.attended;
        return v === undefined ? '-' : <span style={{ color: v > 0 ? '#22a06b' : undefined }}>{v}</span>;
      },
    },
    {
      title: '缺考', key: 'absent', width: 90, align: 'center' as const,
      render: (_: any, r: ExamWithStats) => {
        const v = r.submissionStats?.absent;
        return v === undefined ? '-' : v > 0 ? <Tag color="error">{v}</Tag> : <span style={{ color: '#999' }}>0</span>;
      },
    },
    {
      title: '操作', key: 'actions', width: 130,
      render: (_: any, r: Exam) => (
        <Button
          size="small"
          type="primary"
          icon={<BarChartOutlined />}
          onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}
        >
          成绩分析
        </Button>
      ),
    },
  ];

  const ov = summary?.overview;

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>学情总览</h2>
        <Input
          placeholder="搜索考试名称"
          prefix={<SearchOutlined />}
          style={{ width: 250 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => fetchExams(1, search)}
        />
      </div>

      {/* 跨场汇总（近 12 场已结束考试）：无数据时整块不渲染，避免一排 0 误导 */}
      {summaryLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : ov && ov.examCount > 0 ? (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={8} lg={4}>
              <StatCard title="应参考" value={ov.assigned} icon={<TeamOutlined />} tone="blue" />
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <StatCard title="到考" value={ov.attended} icon={<CheckCircleOutlined />} tone="green" />
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <StatCard title="缺考" value={ov.absent} icon={<UserDeleteOutlined />} tone="orange" />
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <StatCard title="已判分" value={ov.graded} icon={<TrophyOutlined />} tone="purple" />
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <StatCard
                title="参加率"
                value={ov.attendRate ?? '—'}
                suffix={ov.attendRate !== null ? '%' : ''}
                icon={<RiseOutlined />}
                tone="cyan"
              />
            </Col>
            <Col xs={12} sm={8} lg={4}>
              <StatCard
                title="通过率"
                value={ov.passRate ?? '—'}
                suffix={ov.passRate !== null ? '%' : ''}
                icon={<PercentageOutlined />}
                tone="pink"
              />
            </Col>
          </Row>

          <Card title="近 12 场考试趋势" style={{ marginBottom: 16 }}>
            {trendData.some((d) => d.得分率 !== null || d.通过率 !== null) ? (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} unit="%" />
                  <RTooltip formatter={(value) => (value === null || value === undefined ? '—' : `${value}%`)} />
                  <Legend />
                  <Line type="monotone" dataKey="得分率" stroke="#1890ff" strokeWidth={2} connectNulls />
                  <Line type="monotone" dataKey="通过率" stroke="#52c41a" strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="暂无判分数据" description="考试完成判分后，这里会显示逐场得分率与通过率趋势" />
            )}
          </Card>
        </>
      ) : (
        <Card style={{ marginBottom: 16 }}>
          <EmptyState
            title="暂无已结束的考试"
            description="考试结束并完成判分后，这里会汇总应参考、到考、缺考与通过率"
          />
        </Card>
      )}

      <Card styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={data.data}
          columns={columns}
          rowKey="id"
          loading={loading}
          locale={{
            emptyText: <EmptyState title="暂无考试" description="创建并发布考试后，可在这里查看学情" />,
          }}
          pagination={{
            current: data.page,
            total: data.total,
            pageSize: data.pageSize,
            onChange: (page) => fetchExams(page, search),
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
          }}
        />
      </Card>
    </div>
  );
}
