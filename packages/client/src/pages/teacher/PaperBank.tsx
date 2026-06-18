import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, message, Card, Input, Select, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined, FileTextOutlined, EyeOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Paper, PaginatedResponse } from '../../types';

const difficultyLabels: Record<string, { color: string; text: string }> = {
  easy: { color: 'green', text: '简单' },
  medium: { color: 'blue', text: '中等' },
  hard: { color: 'red', text: '困难' },
};

export function PaperBank() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Paper>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState('');
  const [searchDifficulty, setSearchDifficulty] = useState<string | undefined>();

  const fetchPapers = async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('pageSize', '20');
      if (searchName) params.append('search', searchName);
      if (searchDifficulty) params.append('difficulty', searchDifficulty);
      const res = await api.get(`/papers?${params.toString()}`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchPapers(); }, []);

  const handleDelete = async (id: string) => {
    try { await api.delete(`/papers/${id}`); message.success('删除成功'); fetchPapers(data.page); }
    catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const handleDuplicate = async (id: string) => {
    try { await api.post(`/papers/${id}/duplicate`); message.success('复制成功'); fetchPapers(data.page); }
    catch (err: any) { message.error(err.response?.data?.message || '复制失败'); }
  };

  const columns = [
    { title: '试卷名称', dataIndex: 'name', key: 'name' },
    { title: '难度', dataIndex: 'difficulty', key: 'difficulty',
      render: (v: string) => {
        const d = difficultyLabels[v] || { color: 'default', text: v || '-' };
        return <Tag color={d.color}>{d.text}</Tag>;
      },
    },
    { title: '题目数', key: 'questions', render: (_: any, r: Paper) => r._count?.paperQuestions ?? 0 },
    { title: '总分', dataIndex: 'totalScore', key: 'totalScore' },
    { title: '及格分', dataIndex: 'passScore', key: 'passScore', render: (v: number | null) => v ?? '-' },
    { title: '来源', dataIndex: 'source', key: 'source', render: (v: string) => v === 'official' ? <Tag color="orange">官方</Tag> : <Tag color="cyan">校本</Tag> },
    { title: '创建人', key: 'creator', render: (_: any, r: Paper) => r.creator?.realName || '-' },
    {
      title: '操作', key: 'actions', width: 280, render: (_: any, r: Paper) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/teacher/papers/${r.id}/edit`)}>编辑</Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/teacher/papers/${r.id}/edit?tab=preview`)}>预览</Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => handleDuplicate(r.id)}>复制</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Button size="small" icon={<DeleteOutlined />} danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>试卷库</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/teacher/papers/new')}>创建试卷</Button>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Input placeholder="试卷名称" value={searchName} onChange={e => setSearchName(e.target.value)} onPressEnter={() => fetchPapers(1)} style={{ width: 200 }} />
          <Select placeholder="难度" allowClear value={searchDifficulty} onChange={v => { setSearchDifficulty(v); fetchPapers(1); }} style={{ width: 120 }}
            options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]}
          />
          <Button type="primary" onClick={() => fetchPapers(1)}>查询</Button>
        </Space>
      </Card>

      <Table dataSource={data.data} columns={columns} rowKey="id" loading={loading}
        pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchPapers }}
      />
    </div>
  );
}
