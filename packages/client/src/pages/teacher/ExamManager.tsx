import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, message, Card } from 'antd';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Exam, PaginatedResponse } from '../../types';

const modeLabels: Record<string, string> = { practice: '练习', quiz: '测验', exam: '正式考试' };
const statusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'blue', text: '已发布' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'purple', text: '已结束' },
  archived: { color: 'orange', text: '已归档' },
};

export function ExamManager() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Exam>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);

  const fetchExams = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get(`/exams?page=${page}&pageSize=20`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchExams(); }, []);

  const handleDelete = async (id: string) => {
    try { await api.delete(`/exams/${id}`); message.success('删除成功'); fetchExams(); }
    catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const columns = [
    { title: '名称', dataIndex: 'title', key: 'title' },
    { title: '模式', dataIndex: 'mode', key: 'mode', render: (v: string) => modeLabels[v] },
    {
      title: '绑定试卷', key: 'paper',
      render: (_: any, r: Exam) => (
        r.paper ? (
          <Tag color="blue">{r.paper.name}</Tag>
        ) : (
          <Tag color="default">未绑定</Tag>
        )
      ),
    },
    { title: '题目数', key: 'questions', render: (_: any, r: Exam) => r._count?.examQuestions ?? 0 },
    { title: '提交数', key: 'submissions', render: (_: any, r: Exam) => r._count?.submissions ?? 0 },
    { title: '总分', dataIndex: 'totalScore', key: 'totalScore' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions', width: 220, render: (_: any, r: Exam) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/edit`)} disabled={r.status === 'in_progress'}>编辑</Button>
          <Button size="small" icon={<BarChartOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}>统计</Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/grading`)}>阅卷</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>考试管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/teacher/exams/new')}>创建考试</Button>
      </div>
      <Table dataSource={data.data} columns={columns} rowKey="id" loading={loading} pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchExams }} />
    </div>
  );
}
