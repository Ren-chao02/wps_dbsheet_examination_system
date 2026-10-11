/**
 * 实时监控中心 - 考试列表页
 * 展示所有可进行监控的考试，点击进入具体考试的监控页面
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, message, Card, Input } from 'antd';
import { EyeOutlined, SearchOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Exam, PaginatedResponse } from '../../types';

/** 后端 /exams 列表为监考场景附加的四数统计（应参考/到考/交卷/缺考） */
interface ExamWithStats extends Exam {
  submissionStats?: { assigned: number; attended: number; submitted: number; absent: number };
}

const statusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'blue', text: '已发布' },
  scheduled: { color: 'cyan', text: '已排期' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'blue', text: '已结束' },
  cancelled: { color: 'red', text: '已取消' },
  archived: { color: 'orange', text: '已归档' },
};

export function MonitoringList() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Exam>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchExams = async (page = 1, searchVal = '') => {
    setLoading(true);
    try {
      const res = await api.get(`/exams?page=${page}&pageSize=20${searchVal ? `&search=${searchVal}` : ''}`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchExams(); }, []);

  const columns = [
    { title: '考试名称', dataIndex: 'title', key: 'title' },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    // 四数并排：监考者一眼掌握考场规模与进度（缺考 = 应参考 - 到考，由后端统一口径）
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
      title: '交卷', key: 'submitted', width: 90, align: 'center' as const,
      render: (_: any, r: ExamWithStats) => r.submissionStats?.submitted ?? '-',
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
          icon={<EyeOutlined />}
          onClick={() => navigate(`/teacher/exams/${r.id}/monitor`)}
        >
          考试监控
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>实时监控中心</h2>
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
      <Card>
        <Table
          dataSource={data.data}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: data.page,
            total: data.total,
            pageSize: data.pageSize,
            onChange: (page) => fetchExams(page, search),
          }}
        />
      </Card>
    </div>
  );
}
