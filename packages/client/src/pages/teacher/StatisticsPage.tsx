import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Statistic, Row, Col, Table, Tag, Spin, message, Button, Space, Tabs, Dropdown, Tooltip } from 'antd';
import { TrophyOutlined, TeamOutlined, RiseOutlined, DownloadOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Cell } from 'recharts';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import api from '../../services/api';
import { useNavigate } from 'react-router-dom';
import type { ExamStatistics, StudentScoreItem } from '../../types';

/** 成绩单里的状态文案（absent 是并集名单里的缺考，不在提交状态机上） */
const SCORE_STATUS_TEXT: Record<string, string> = {
  absent: '缺考',
  in_progress: '答题中',
  submitted: '已交卷',
  grading: '评分中',
  graded: '已判分',
};

const COLORS = ['#ff4d4f', '#faad14', '#1890ff', '#52c41a', '#13c2c2'];

export function StatisticsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [stats, setStats] = useState<ExamStatistics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/statistics/exam/${id}`).then(res => {
      setStats(res.data);
    }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  const handleExportExcel = async () => {
    try {
      const res = await api.get(`/statistics/exam/${id}/export`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stats?.examTitle || '成绩'}_成绩分析.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err: any) {
      let msg = '导出失败';
      try {
        if (err.response?.data instanceof Blob) {
          const text = await err.response.data.text();
          msg = JSON.parse(text).message || msg;
        }
      } catch {}
      message.error(msg);
    }
  };

  /**
   * 导出成绩单（客户端 xlsx）：简化版 = 姓名/学号/状态/成绩/是否及格；
   * 标准版加列 考场/高危行为/提交时间。与"导出分析报告"（服务端三 Sheet）互补：
   * 成绩单给班主任/教务归档，分析报告给任课教师复盘。
   */
  const handleExportScores = (kind: 'simple' | 'standard') => {
    if (!stats) return;
    const rows = stats.submissions.map((r: StudentScoreItem) => {
      const base: Record<string, unknown> = {
        '姓名': r.studentName,
        '学号': r.studentId,
        '状态': SCORE_STATUS_TEXT[r.status] || r.status,
        '成绩': r.score ?? '',
        '是否及格': r.passed === null ? '' : r.passed ? '是' : '否',
      };
      if (kind === 'simple') return base;
      return {
        ...base,
        '考场': r.roomName ?? '',
        '高危行为次数': r.riskCount || 0,
        '提交时间': r.submittedAt ? dayjs(r.submittedAt).format('YYYY-MM-DD HH:mm:ss') : '',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '成绩单');
    XLSX.writeFile(wb, `${stats.examTitle || '成绩'}（${kind === 'simple' ? '简化版' : '标准版'}）_${dayjs().format('YYYYMMDD-HHmm')}.xlsx`);
    message.success(`已导出${kind === 'simple' ? '简化版' : '标准版'}成绩单`);
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
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0 }}>{stats.examTitle} — 成绩分析</h2>
        <Space>
          <Dropdown
            menu={{
              items: [
                { key: 'simple', label: '简化版（姓名/学号/状态/成绩/是否及格）' },
                { key: 'standard', label: '标准版（含考场/高危行为/提交时间）' },
              ],
              onClick: ({ key }) => handleExportScores(key as 'simple' | 'standard'),
            }}
          >
            <Button icon={<DownloadOutlined />}>导出成绩单</Button>
          </Dropdown>
          <Button icon={<DownloadOutlined />} onClick={handleExportExcel}>导出分析报告</Button>
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
                <RTooltip />
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
                {/* Y 轴宽度需容纳截断后的题目名（≤12 个中文字+省略号），否则文本会溢出图边界 */}
                <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12 }} tickMargin={8} />
                <RTooltip formatter={(value) => `${value}%`} />
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
            label: `学生成绩${stats.absentCount > 0 ? `（缺考 ${stats.absentCount}）` : ''}`,
            children: (
              <Table
                dataSource={stats.submissions}
                rowKey="id"
                pagination={false}
                scroll={{ x: 900 }}
                columns={[
                  { title: '学生', dataIndex: 'studentName', key: 'studentName' },
                  {
                    title: '状态', dataIndex: 'status', key: 'status', width: 90,
                    render: (v: string) => {
                      const cfg: Record<string, { color: string; text: string }> = {
                        absent: { color: 'error', text: '缺考' },
                        in_progress: { color: 'processing', text: '答题中' },
                        submitted: { color: 'warning', text: '已交卷' },
                        grading: { color: 'processing', text: '评分中' },
                        graded: { color: 'success', text: '已判分' },
                      };
                      const c = cfg[v] || { color: 'default', text: v };
                      return <Tag color={c.color}>{c.text}</Tag>;
                    },
                  },
                  {
                    title: '分数', dataIndex: 'score', key: 'score', width: 90,
                    render: (v: number | null, r: StudentScoreItem) => v !== null ? (
                      <span style={{ fontWeight: 600, color: r.passed === false ? '#ff4d4f' : r.passed ? '#52c41a' : undefined }}>{v}</span>
                    ) : '—',
                  },
                  {
                    title: '得分率', key: 'rate', width: 120,
                    render: (_: any, r: StudentScoreItem) => r.score !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, background: '#f0f0f0', borderRadius: 4, height: 6, maxWidth: 60 }}>
                          <div style={{ width: `${(r.score / stats.totalScore) * 100}%`, background: '#1890ff', borderRadius: 4, height: '100%' }} />
                        </div>
                        <span style={{ fontSize: 12, color: '#666' }}>{Math.round((r.score / stats.totalScore) * 100)}%</span>
                      </div>
                    ) : '—',
                  },
                  {
                    // 及格结论只在已判分时给；未判分/缺考显示 —，不替教师下结论
                    title: '是否及格', key: 'passed', width: 90,
                    render: (_: any, r: StudentScoreItem) =>
                      r.passed === null ? <span style={{ color: '#999' }}>—</span> : r.passed ? <Tag color="success">是</Tag> : <Tag color="error">否</Tag>,
                  },
                  {
                    // 风险标记：只给"证据量"（该场高危行为次数），是否作弊由人工复核判定
                    title: '风险标记', key: 'risk', width: 100,
                    render: (_: any, r: StudentScoreItem) =>
                      r.riskCount > 0 ? (
                        <Tooltip title="该场考试触发高危行为（如退出全屏、可疑快捷键）的次数，仅作复核线索">
                          <Tag icon={<WarningOutlined />} color="volcano">高危 {r.riskCount}</Tag>
                        </Tooltip>
                      ) : (
                        <span style={{ color: '#999' }}>—</span>
                      ),
                  },
                  { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', width: 150, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—' },
                  {
                    title: '操作', key: 'action', width: 100,
                    render: (_: any, r: StudentScoreItem) => <Button type="link" size="small" icon={<UserOutlined />} onClick={() => navigate(`/teacher/students/${r.studentId}/profile`)}>画像</Button>,
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
