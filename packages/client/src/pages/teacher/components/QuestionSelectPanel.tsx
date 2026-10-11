/**
 * 试卷「选题」面板（编辑试卷页的选题模式，整页替换正文）
 *
 * 借鉴参考产品新建试卷的「选题」页：顶部返回 + 右侧操作（由父级以 headerRight 注入），
 * 左知识点树（带搜索），右侧题目流（搜索/题型多选/难度/重置 + 全选当前），
 * 每题 详情/引用（已引用显示"取消引用"），分页 20 条/页。
 *
 * 只列出**已发布**题目（与参考产品"状态=启用"一致）：草稿题引用进试卷后
 * 开考时会抽不到（服务端候选池只认 published），在入口就屏蔽掉这类坑。
 */
import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { Button, Input, Select, Checkbox, Empty, Pagination, Spin, Card, Tree, message } from 'antd';
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { Question, QuestionCategory } from '../../../types';
import { QuestionListItem } from './QuestionListItem';
import { QuestionDetailDrawer } from '../QuestionDetailDrawer';
import { QUESTION_TYPE_LABELS } from '../../../utils/questionLabels';

const difficultyOptions = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

const typeOptions = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

interface QuestionSelectPanelProps {
  /** 已加入试卷（固定题）的题目 id：用于"引用/取消引用"状态与去重 */
  selectedIds: Set<string>;
  onQuote: (q: Question) => void;
  onUnquote: (questionId: string) => void;
  onBack: () => void;
  /** 顶部右侧操作（已选题目(N) 浮层 / 试卷分析 / 完成选题） */
  headerRight?: ReactNode;
}

export function QuestionSelectPanel({ selectedIds, onQuote, onUnquote, onBack, headerRight }: QuestionSelectPanelProps) {
  const [list, setList] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<string | undefined>();
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<{ id: string; level: number } | null>(null);
  const [detailQuestion, setDetailQuestion] = useState<Question | null>(null);

  const fetchQuestions = useCallback(async (p = 1, ps = 20) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: 'published', page: String(p), pageSize: String(ps) });
      if (search) params.set('search', search);
      if (types.length > 0) params.set('type', types.join(','));
      if (difficulty) params.set('difficulty', difficulty);
      if (selectedCategory) {
        if (selectedCategory.level === 1) params.set('primaryCategory', selectedCategory.id);
        else params.set('secondaryCategory', selectedCategory.id);
      }
      const res = await api.get(`/questions?${params.toString()}`);
      setList(res.data?.data || []);
      setTotal(res.data?.total || 0);
      setPage(res.data?.page || p);
      setPageSize(res.data?.pageSize || ps);
    } catch {
      message.error('加载题目失败');
    } finally {
      setLoading(false);
    }
  }, [search, types, difficulty, selectedCategory]);

  useEffect(() => { fetchQuestions(1, pageSize); }, [fetchQuestions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get('/categories?mode=tree')
      .then(res => setCategories(res.data?.data || []))
      .catch(() => console.error('Error fetching categories'));
  }, []);

  // 树：两级（一级=知识点大类，二级=具体能力点）；搜索时保留命中节点及其祖先
  const filterTree = (nodes: QuestionCategory[]): any[] =>
    nodes.reduce((acc: any[], node) => {
      const children = node.children ? filterTree(node.children) : [];
      if (node.name.toLowerCase().includes(categorySearch.trim().toLowerCase()) || children.length > 0) {
        acc.push({ title: node.name, key: node.id, children });
      }
      return acc;
    }, []);

  const treeData = categorySearch.trim()
    ? filterTree(categories)
    : categories.map(c => ({
        title: c.name,
        key: c.id,
        children: (c.children || []).map(child => ({ title: child.name, key: child.id, isLeaf: true })),
      }));

  const allOnPageQuoted = list.length > 0 && list.every(q => selectedIds.has(q.id));

  const handleSelectAllCurrent = (checked: boolean) => {
    if (checked) {
      list.forEach(q => { if (!selectedIds.has(q.id)) onQuote(q); });
    } else {
      list.forEach(q => { if (selectedIds.has(q.id)) onUnquote(q.id); });
    }
  };

  const handleReset = () => {
    setSearch('');
    setTypes([]);
    setDifficulty(undefined);
    setSelectedCategory(null);
  };

  return (
    <div className="picker">
      <div className="picker__header">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>选题</Button>
        <div className="picker__header-right">{headerRight}</div>
      </div>

      <div className="picker__body">
        {/* 左：知识点树 */}
        <aside className="picker__tree">
          <div className="picker__tree-title">知识点</div>
          <Input
            size="small"
            placeholder="搜索知识点"
            prefix={<SearchOutlined />}
            allowClear
            value={categorySearch}
            onChange={e => setCategorySearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <Tree
            treeData={treeData}
            selectedKeys={selectedCategory ? [selectedCategory.id] : []}
            onSelect={(keys) => {
              const id = keys[0] as string | undefined;
              if (!id) { setSelectedCategory(null); return; }
              // 一级/二级通过"是否出现在某个一级节点的 children 里"判断
              const parent = categories.find(c => (c.children || []).some(child => child.id === id));
              setSelectedCategory(parent ? { id, level: 2 } : { id, level: 1 });
            }}
            blockNode
            style={{ fontSize: 13 }}
          />
        </aside>

        {/* 右：筛选 + 题目流 */}
        <section className="picker__main">
          <div className="picker__filters">
            <Input
              placeholder="搜索题目"
              prefix={<SearchOutlined />}
              allowClear
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              mode="multiple"
              maxTagCount="responsive"
              placeholder="题型"
              allowClear
              value={types}
              onChange={v => setTypes(v || [])}
              options={typeOptions}
              style={{ minWidth: 130 }}
            />
            <Select
              placeholder="难度"
              allowClear
              value={difficulty}
              onChange={v => setDifficulty(v || undefined)}
              options={difficultyOptions}
              style={{ width: 110 }}
            />
            <Button onClick={handleReset}>重置</Button>
            {/* margin-left:auto 而不是 flex:1 占位：换行时「全选当前」仍贴右，不会孤零零留在左侧 */}
            <Checkbox
              style={{ marginLeft: 'auto' }}
              checked={allOnPageQuoted}
              indeterminate={!allOnPageQuoted && list.some(q => selectedIds.has(q.id))}
              onChange={e => handleSelectAllCurrent(e.target.checked)}
            >
              全选当前
            </Checkbox>
          </div>

          <Spin spinning={loading}>
            <Card size="small" styles={{ body: { padding: '4px 16px' } }}>
              {list.length === 0 && !loading ? (
                <Empty description="没有符合条件的题目" style={{ padding: '40px 0' }} />
              ) : (
                list.map((q, index) => {
                  const quoted = selectedIds.has(q.id);
                  return (
                    <div key={q.id}>
                      <QuestionListItem
                        question={q}
                        actions={
                          <>
                            <Button type="link" size="small" onClick={() => setDetailQuestion(q)}>详情</Button>
                            {quoted ? (
                              <Button size="small" onClick={() => onUnquote(q.id)}>取消引用</Button>
                            ) : (
                              <Button size="small" type="primary" onClick={() => onQuote(q)}>引用</Button>
                            )}
                          </>
                        }
                      />
                      {index < list.length - 1 && <div className="qflow-divider" />}
                    </div>
                  );
                })
              )}
            </Card>
          </Spin>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Pagination
              current={page}
              total={total}
              pageSize={pageSize}
              showSizeChanger
              showQuickJumper
              pageSizeOptions={[10, 20, 50]}
              showTotal={(t, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${t} 条`}
              onChange={(p, ps) => fetchQuestions(p, ps)}
            />
          </div>
        </section>
      </div>

      <QuestionDetailDrawer
        visible={!!detailQuestion}
        question={detailQuestion}
        onClose={() => setDetailQuestion(null)}
      />
    </div>
  );
}
