import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Tag, Space, message, Card, Input, Select, Popconfirm, Tooltip, Empty, Pagination, Spin } from 'antd';
import { PlusOutlined, CopyOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { EmptyState } from '../../components/common/EmptyState';
import type { Paper, PaginatedResponse } from '../../types';
import { useAuthStore } from '../../stores/auth';

const difficultyLabels: Record<string, { color: string; text: string }> = {
  easy: { color: 'green', text: '简单' },
  medium: { color: 'blue', text: '中等' },
  hard: { color: 'red', text: '困难' },
};

/** 组卷方式：按题位类型统计（列表接口附带的 slotStats） */
function assemblyMode(paper: Paper): { text: string; color?: string } {
  const fixed = paper.slotStats?.fixed ?? 0;
  const rule = paper.slotStats?.rule ?? 0;
  if (rule === 0) return { text: '手动组卷' };
  if (fixed === 0) return { text: '自动组卷' };
  return { text: `混合组卷（固定 ${fixed} · 抽题 ${rule}）`, color: 'geekblue' };
}

export function PaperBank() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [data, setData] = useState<PaginatedResponse<Paper>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [searchName, setSearchName] = useState('');
  const [searchDifficulty, setSearchDifficulty] = useState<string | undefined>();
  const [searchSource, setSearchSource] = useState<string | undefined>();

  // 判断当前用户是否为试卷创建者（admin 视为所有者）
  const isOwner = (r: Paper) => {
    return currentUser?.role === 'admin' || r.createdBy === currentUser?.id;
  };

  const fetchPapers = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('pageSize', String(pageSize));
      if (searchName) params.append('search', searchName);
      if (searchDifficulty) params.append('difficulty', searchDifficulty);
      if (searchSource) params.append('source', searchSource);
      const res = await api.get(`/papers?${params.toString()}`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchPapers(); }, []);

  const handleDelete = async (id: string) => {
    try { await api.delete(`/papers/${id}`); message.success('删除成功'); fetchPapers(data.page, data.pageSize); }
    catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const handleDuplicate = async (id: string) => {
    try { await api.post(`/papers/${id}/duplicate`); message.success('复制成功'); fetchPapers(data.page, data.pageSize); }
    catch (err: any) { message.error(err.response?.data?.message || '复制失败'); }
  };

  const renderRow = (paper: Paper) => {
    const owner = isOwner(paper);
    const ownerTip = owner ? undefined : '仅支持本人创建的试卷';
    const diff = difficultyLabels[paper.difficulty || ''] || null;
    const mode = assemblyMode(paper);
    return (
      <div className="paper-row" key={paper.id}>
        {/* 封面缩略块：参考产品的试卷列表用缩略图占位，来源不同底色不同 */}
        <div className={`paper-cover ${paper.source === 'official' ? 'paper-cover--official' : ''}`}>
          <span>{paper.source === 'official' ? '官方试卷' : '校本试卷'}</span>
        </div>

        <div className="paper-row__main">
          <div className="paper-row__title-line">
            <span className="paper-row__name">{paper.name}</span>
            {diff && <Tag color={diff.color}>{diff.text}</Tag>}
            <Tag color={paper.source === 'official' ? 'orange' : 'cyan'}>
              {paper.source === 'official' ? '官方' : '校本'}
            </Tag>
            {paper._count && paper._count.exams > 0 && (
              <Tag color="purple">已用于 {paper._count.exams} 场考试</Tag>
            )}
          </div>

          <div className="paper-row__meta">
            <span>题量: {paper._count?.paperQuestions ?? 0}</span>
            <i>｜</i><span>总分: {paper.totalScore}</span>
            <i>｜</i><span>及格分: {paper.passScore ?? '—'}</span>
            <i>｜</i><span>创建人: {paper.creator?.realName || '未知'}</span>
            <i>｜</i><span style={mode.color ? { color: '#2f54eb' } : undefined}>组卷方式: {mode.text}</span>
            <i>｜</i><span>更新时间: {dayjs(paper.updatedAt).format('YYYY-MM-DD HH:mm')}</span>
          </div>

          {paper.description && <div className="paper-row__remark">备注: {paper.description}</div>}
        </div>

        <div className="paper-row__actions">
          <Button type="link" size="small" onClick={() => navigate(`/teacher/papers/${paper.id}/edit?tab=preview`)}>预览</Button>
          <Tooltip title={ownerTip}>
            <Button type="link" size="small" disabled={!owner} onClick={() => navigate(`/teacher/papers/${paper.id}/edit`)}>编辑</Button>
          </Tooltip>
          {/* 后端（数据范围 P1）只放行「本人创建」或「官方」试卷的复制，前端按同一口径禁用，避免点了才收到 403 */}
          <Tooltip title={owner || paper.source === 'official' ? undefined : '仅可复制本人或官方试卷'}>
            <Button type="link" size="small" icon={<CopyOutlined />} disabled={!owner && paper.source !== 'official'} onClick={() => handleDuplicate(paper.id)}>复制</Button>
          </Tooltip>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(paper.id)} okText="删除" cancelText="取消" disabled={!owner}>
            <Tooltip title={ownerTip}>
              <Button type="link" size="small" danger disabled={!owner}>删除</Button>
            </Tooltip>
          </Popconfirm>
        </div>
      </div>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>试卷库</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/teacher/papers/new')}>创建试卷</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="搜索试卷名称"
            prefix={<SearchOutlined />}
            value={searchName}
            onChange={e => setSearchName(e.target.value)}
            onPressEnter={() => fetchPapers(1)}
            allowClear
            style={{ width: 220 }}
          />
          <Select placeholder="难度" allowClear value={searchDifficulty} onChange={v => { setSearchDifficulty(v); }} style={{ width: 120 }}
            options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]}
          />
          <Select placeholder="来源" allowClear value={searchSource} onChange={v => { setSearchSource(v); }} style={{ width: 120 }}
            options={[{ value: 'school', label: '校本' }, { value: 'official', label: '官方' }]}
          />
          <Button type="primary" onClick={() => fetchPapers(1)}>查询</Button>
          <Button
            onClick={() => { setSearchName(''); setSearchDifficulty(undefined); setSearchSource(undefined); fetchPapers(1); }}
          >
            重置
          </Button>
        </Space>
      </Card>

      <Spin spinning={loading}>
        {data.data.length === 0 && !loading ? (
          <Card size="small">
            <EmptyState
              title="还没有试卷"
              description="创建试卷并配置题位后，可用于考试绑定与每生抽题"
              actionText="创建试卷"
              onAction={() => navigate('/teacher/papers/new')}
            />
          </Card>
        ) : (
          <Card size="small" styles={{ body: { padding: '4px 16px' } }}>
            {data.data.map((paper, index) => (
              <div key={paper.id}>
                {renderRow(paper)}
                {index < data.data.length - 1 && <div className="qflow-divider" />}
              </div>
            ))}
          </Card>
        )}
        {data.data.length === 0 && loading && (
          <Card size="small"><Empty description=" " /></Card>
        )}
      </Spin>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Pagination
          current={data.page}
          total={data.total}
          pageSize={data.pageSize}
          showSizeChanger
          showQuickJumper
          pageSizeOptions={[10, 20, 50]}
          showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`}
          onChange={(page, pageSize) => fetchPapers(page, pageSize)}
        />
      </div>
    </div>
  );
}
