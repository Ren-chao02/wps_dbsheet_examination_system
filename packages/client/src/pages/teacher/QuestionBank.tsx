import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Input, Select, Space, Tag, Popconfirm, message, Card } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Question, PaginatedResponse } from '../../types';

const typeLabels: Record<string, string> = {
  create_table: '建表', add_field: '字段', config_view: '视图', create_form: '表单', comprehensive: '综合',
};

export function QuestionBank() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Question>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ search?: string; type?: string; difficulty?: string; status?: string }>({});

  const fetchQuestions = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '20', ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v)) });
      const res = await api.get(`/questions?${params}`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchQuestions(); }, [filters]);

  const handleDelete = async (id: string) => {
    try { await api.delete(`/questions/${id}`); message.success('删除成功'); fetchQuestions(); }
    catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', render: (text: string, record: Question) => <a onClick={() => navigate(`/teacher/questions/${record.id}/edit`)}>{text}</a> },
    { title: '类型', dataIndex: 'type', key: 'type', width: 80, render: (v: string) => typeLabels[v] || v },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty', width: 80, render: (v: string) => <Tag color={v === 'easy' ? 'green' : v === 'medium' ? 'orange' : 'red'}>{v === 'easy' ? '简单' : v === 'medium' ? '中等' : '困难'}</Tag> },
    { title: '分值', dataIndex: 'score', key: 'score', width: 60 },
    { title: '分类', key: 'category', width: 100, render: (_: any, r: Question) => r.category?.name || '—' },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag color={v === 'published' ? 'blue' : v === 'draft' ? 'default' : 'orange'}>{v === 'published' ? '已发布' : v === 'draft' ? '草稿' : '已归档'}</Tag> },
    {
      title: '操作', key: 'actions', width: 120, render: (_: any, record: Question) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/teacher/questions/${record.id}/edit`)} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>题库管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/teacher/questions/new')}>新建题目</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input placeholder="搜索题目" prefix={<SearchOutlined />} allowClear style={{ width: 200 }} onChange={e => setFilters(f => ({ ...f, search: e.target.value || undefined }))} />
          <Select placeholder="题目类型" allowClear style={{ width: 130 }} onChange={v => setFilters(f => ({ ...f, type: v }))} options={Object.entries(typeLabels).map(([k, v]) => ({ value: k, label: v }))} />
          <Select placeholder="难度" allowClear style={{ width: 100 }} onChange={v => setFilters(f => ({ ...f, difficulty: v }))} options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} />
          <Select placeholder="状态" allowClear style={{ width: 110 }} onChange={v => setFilters(f => ({ ...f, status: v }))} options={[{ value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' }, { value: 'archived', label: '已归档' }]} />
        </Space>
      </Card>

      <Table dataSource={data.data} columns={columns} rowKey="id" loading={loading} pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchQuestions }} />
    </div>
  );
}
