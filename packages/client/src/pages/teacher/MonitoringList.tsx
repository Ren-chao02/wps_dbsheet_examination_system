/**
 * 实时监控中心 - 考试列表页
 * 展示所有可进行监控的考试，点击进入具体考试的监控页面
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, message, Card, Input } from 'antd';
import { EyeOutlined, SearchOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Exam, PaginatedResponse } from '../../types';

const statusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'blue', text: '已发布' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'purple', text: '已结束' },
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
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    { title: '提交数', key: 'submissions', render: (_: any, r: Exam) => r._count?.submissions ?? 0 },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_: any, r: Exam) => (
        <Button
          size="small"
          type="primary"
          icon={<EyeOutlined />}
          onClick={() => navigate(`/teacher/exams/${r.id}/monitor`)}
        >
          进入监控
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>实时监控中心</h2>
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
