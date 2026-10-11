import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Button,
  Input,
  Select,
  Space,
  Popconfirm,
  message,
  Card,
  DatePicker,
  Row,
  Col,
  Tooltip,
  Tree,
  Empty,
  Pagination,
  Spin,
  Segmented,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  SettingOutlined,
  DownOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import type { Question, PaginatedResponse, QuestionCategory } from '../../types';
import { QuestionDetailDrawer } from './QuestionDetailDrawer';
import { QuestionListItem } from './components/QuestionListItem';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';
import { useAuthStore } from '../../stores/auth';
import { QUESTION_TYPE_LABELS } from '../../utils/questionLabels';

const { RangePicker } = DatePicker;

// 难度配置
const difficultyOptions = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

// 状态选项（简化为启用/禁用）
const statusOptions = [
  { value: 'published', label: '已启用' },
  { value: 'draft', label: '已禁用' },
];

// 题型多选（单选/多选/判断/实操 5 种，文案以 questionLabels 为唯一来源）
const typeOptions = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export function QuestionBank() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = useAuthStore((s) => s.user);

  // 判断当前用户是否为题目创建者（admin 视为所有者）
  const isOwner = (r: Question) =>
    currentUser?.role === 'admin' || r.creator?.id === currentUser?.id;

  const [data, setData] = useState<PaginatedResponse<Question>>({
    data: [],
    total: 0,
    page: 1,
    pageSize: 20,
  });
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [teachers, setTeachers] = useState<{ id: string; realName: string }[]>([]);
  // 次要筛选（出题老师/分类/时间）默认收起，点「展开」才显示 —— 对齐参考产品的筛选区形态
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // ✨ 扩展筛选条件状态（type 为多选数组，请求时拼成逗号分隔）
  const [filters, setFilters] = useState<{
    search?: string;
    type?: string[];
    difficulty?: string;
    status?: string;
    source?: string;
    teacherName?: string;
    primaryCategory?: string;
    secondaryCategory?: string;
    createdAtStart?: string;
    createdAtEnd?: string;
    updatedAtStart?: string;
    updatedAtEnd?: string;
  }>({});

  // 防抖后的筛选条件（实际用于 API 请求）
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [activeFilters, setActiveFilters] = useState(filters);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setActiveFilters(filters);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [filters]);

  // 获取题目列表数据
  const fetchQuestions = useCallback(
    async (page = 1, pageSize = 20) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        for (const [key, v] of Object.entries(activeFilters)) {
          if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
          params.set(key, Array.isArray(v) ? v.join(',') : String(v));
        }

        const res = await api.get(`/questions?${params}`);
        setData(res.data);
      } catch (error) {
        console.error('Error fetching questions:', error);
        message.error('加载失败');
      } finally {
        setLoading(false);
      }
    },
    [activeFilters]
  );

  // 获取分类列表（用于级联选择器）- 获取树形结构以支持子分类
  const fetchCategories = async () => {
    try {
      // 使用正确的API路径 /api/categories
      const res = await api.get('/categories?mode=tree');
      const treeData = res.data?.data || [];

      // 将树形数据转换为扁平列表（保留children信息）
      const flattenCategories = (cats: any[], level: number = 1): QuestionCategory[] => {
        return cats.reduce((acc: QuestionCategory[], cat: any) => {
          acc.push({
            ...cat,
            level,
            children: cat.children || [], // 确保children存在
          });
          if (cat.children && cat.children.length > 0) {
            acc.push(...flattenCategories(cat.children, level + 1));
          }
          return acc;
        }, []);
      };

      setCategories(flattenCategories(treeData));
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  // 获取教师列表（用于下拉筛选）
  const fetchTeachers = async () => {
    try {
      const res = await api.get('/users/teachers');
      setTeachers(res.data || []);
    } catch (error) {
      console.error('Error fetching teachers:', error);
    }
  };

  // ── 知识点树（左栏）─────────────────────────────────────────
  // categories 是扁平列表但每项保留了原始 children 子树，用它直接构建两级树；
  // 点击节点写回同一份 filters（与上方下拉共用），二级节点需要同时写入所属一级
  const [categorySearch, setCategorySearch] = useState('');

  const categoryMeta = useMemo(() => {
    const meta = new Map<string, { level: 'primary' | 'secondary'; parentId?: string }>();
    categories
      .filter((c) => c.level === 1)
      .forEach((top) => {
        meta.set(top.id, { level: 'primary' });
        (top.children || []).forEach((child) => {
          meta.set(child.id, { level: 'secondary', parentId: top.id });
        });
      });
    return meta;
  }, [categories]);

  const categoryTreeData = useMemo(() => {
    const roots = categories
      .filter((c) => c.level === 1)
      .map((top) => ({
        key: top.id,
        title: top.name,
        children: (top.children || []).map((child) => ({
          key: child.id,
          title: child.name,
          isLeaf: true,
        })),
      }));
    return { key: 'ALL', title: '全部题目', children: roots };
  }, [categories]);

  // 搜索过滤：保留命中节点及其祖先（antd 树过滤的标准做法）
  const filteredTreeData = useMemo(() => {
    const kw = categorySearch.trim().toLowerCase();
    if (!kw) return [categoryTreeData];
    const filterNodes = (nodes: any[]): any[] =>
      nodes.reduce((acc: any[], node) => {
        const children = node.children ? filterNodes(node.children) : undefined;
        if ((node.title as string).toLowerCase().includes(kw) || (children && children.length > 0)) {
          acc.push({ ...node, children });
        }
        return acc;
      }, []);
    const roots = filterNodes(categoryTreeData.children);
    return roots.length > 0 ? [{ ...categoryTreeData, children: roots }] : [categoryTreeData];
  }, [categoryTreeData, categorySearch]);

  // 展开状态受控：分类是异步加载的，defaultExpandAll 只对首帧已有数据生效，
  // 若不接管 expandedKeys，树会一直停留在"只显示根节点"的折叠态
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  useEffect(() => {
    if (categories.length > 0) {
      setExpandedKeys((prev) =>
        prev.length > 0 ? prev : ['ALL', ...categories.filter((c) => c.level === 1).map((c) => c.id)],
      );
    }
  }, [categories]);

  const selectedCategoryKey = filters.secondaryCategory || filters.primaryCategory || 'ALL';

  const handleCategorySelect = (key: string) => {
    if (key === 'ALL') {
      setFilters((f) => ({ ...f, primaryCategory: undefined, secondaryCategory: undefined }));
      return;
    }
    const meta = categoryMeta.get(key);
    if (!meta) return;
    setFilters((f) =>
      meta.level === 'secondary'
        ? { ...f, primaryCategory: meta.parentId, secondaryCategory: key }
        : { ...f, primaryCategory: key, secondaryCategory: undefined },
    );
  };

  // 筛选条件变化 → 回到第一页
  useEffect(() => {
    fetchQuestions(1, data.pageSize);
  }, [activeFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // 初始化 + 从子页面返回时自动刷新
  useEffect(() => {
    fetchQuestions(data.page, data.pageSize);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchCategories();
    fetchTeachers();
  }, []);

  // 删除题目
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/questions/${id}`);
      message.success('删除成功');
      fetchQuestions(data.page);
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // 切换题目启用/禁用状态
  const handleToggleStatus = async (id: string, currentStatus: string) => {
    try {
      const newStatus = currentStatus === 'published' ? 'draft' : 'published';
      await api.put(`/questions/${id}/status`, { status: newStatus });
      message.success(newStatus === 'published' ? '已启用' : '已禁用');
      fetchQuestions(data.page);
    } catch (err: any) {
      message.error(err.response?.data?.message || '状态更新失败');
    }
  };

  // 查看详情
  const handleViewDetail = (record: Question) => {
    setSelectedQuestion(record);
    setDetailVisible(true);
  };

  // 重置筛选条件
  const handleResetFilters = () => {
    setFilters({});
    message.success('已重置筛选条件');
  };

  /**
   * 行内操作（对齐参考产品的 详情/编辑/删除 + 本系统的启用/禁用）：
   * 禁用走二次确认（被引用的题禁用后试卷会抽不到题），启用直接生效。
   */
  const renderActions = (record: Question) => {
    const owner = isOwner(record);
    const ownerTip = owner
      ? undefined
      : record.source === 'official'
        ? '官方题库题目由平台统一维护，教师端不可修改'
        : '仅支持本人创建的题目';
    return (
      <>
        <Button type="link" size="small" onClick={() => handleViewDetail(record)}>详情</Button>
        <Tooltip title={ownerTip}>
          <Button
            type="link"
            size="small"
            disabled={!owner}
            onClick={() => navigate(`/teacher/questions/${record.id}/edit`)}
          >
            编辑
          </Button>
        </Tooltip>
        {record.status === 'published' ? (
          <Popconfirm
            title="确认禁用"
            description="试题禁用后不能被引用到试卷中，确认禁用吗？"
            okText="确认禁用"
            cancelText="取消"
            disabled={!owner}
            onConfirm={() => handleToggleStatus(record.id, record.status)}
          >
            <Tooltip title={ownerTip}>
              <Button type="link" size="small" disabled={!owner}>禁用</Button>
            </Tooltip>
          </Popconfirm>
        ) : (
          <Tooltip title={ownerTip}>
            <Button
              type="link"
              size="small"
              disabled={!owner}
              onClick={() => handleToggleStatus(record.id, record.status)}
            >
              启用
            </Button>
          </Tooltip>
        )}
        <Popconfirm
          title="确定删除该题目？"
          description="删除后无法恢复"
          okText="确定"
          cancelText="取消"
          disabled={!owner}
          onConfirm={() => handleDelete(record.id)}
        >
          <Tooltip title={ownerTip}>
            <Button type="link" size="small" danger disabled={!owner}>删除</Button>
          </Tooltip>
        </Popconfirm>
      </>
    );
  };

  return (
    <div className="page-container">
      {/* 页面标题区域 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2>题库管理</h2>
        <Space>
          <Button
            icon={<SettingOutlined />}
            onClick={() => setCategoryModalVisible(true)}
            style={{
              background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
              borderColor: 'transparent',
              color: '#fff',
              fontWeight: 500,
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
            }}
            className="category-manager-btn"
          >
            编辑知识点分类
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchQuestions(data.page)}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/teacher/questions/new')}
          >
            新建题目
          </Button>
        </Space>
      </div>

      <Row gutter={[16, 16]}>
        {/* 左栏知识点树：与上方下拉共用同一份筛选状态，点树即筛选（借鉴 WPS 平台的题库左树结构） */}
        <Col xs={24} md={7} lg={6} xl={5}>
          <Card title="知识点" size="small" styles={{ body: { padding: 8 } }}>
            <Input
              size="small"
              placeholder="搜索知识点"
              prefix={<SearchOutlined />}
              allowClear
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            <Tree
              treeData={filteredTreeData}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              blockNode
              selectedKeys={[selectedCategoryKey]}
              onSelect={(keys) => handleCategorySelect(String(keys[0] ?? 'ALL'))}
              style={{ fontSize: 13 }}
            />
          </Card>
        </Col>

        <Col xs={24} md={17} lg={18} xl={19}>
          {/* 来源页签：官方题库（平台维护）/ 校本题库（教师自建）——对应参考产品的双库结构 */}
          <div style={{ marginBottom: 12 }}>
            <Segmented
              value={filters.source ?? 'all'}
              onChange={(v) => setFilters((f) => ({ ...f, source: v === 'all' ? undefined : String(v) }))}
              options={[
                { label: '全部', value: 'all' },
                { label: '官方题库', value: 'official' },
                { label: '校本题库', value: 'school' },
              ]}
            />
          </div>

          {/* ✨ 高级筛选区域 */}
          <Card size="small" style={{ marginBottom: 16 }}>
            {/* 第一行：基础筛选 */}
            <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
              <Col span={7}>
                <Input
                  placeholder="搜索题目"
                  prefix={<SearchOutlined />}
                  allowClear
                  value={filters.search}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      search: e.target.value || undefined,
                    }))
                  }
                />
              </Col>

              <Col span={5}>
                <Select
                  mode="multiple"
                  maxTagCount="responsive"
                  placeholder="题型"
                  allowClear
                  value={filters.type}
                  style={{ width: '100%' }}
                  onChange={(v) =>
                    setFilters((f) => ({ ...f, type: v && v.length > 0 ? v : undefined }))
                  }
                  options={typeOptions}
                />
              </Col>

              <Col span={4}>
                <Select
                  placeholder="难度"
                  allowClear
                  value={filters.difficulty}
                  style={{ width: '100%' }}
                  onChange={(v) =>
                    setFilters((f) => ({ ...f, difficulty: v || undefined }))
                  }
                  options={difficultyOptions}
                />
              </Col>

              <Col span={4}>
                <Select
                  placeholder="状态"
                  allowClear
                  value={filters.status}
                  style={{ width: '100%' }}
                  onChange={(v) =>
                    setFilters((f) => ({ ...f, status: v || undefined }))
                  }
                  options={statusOptions}
                />
              </Col>

              <Col span={2}>
                <Button onClick={handleResetFilters} style={{ width: '100%' }}>重置</Button>
              </Col>

              <Col span={2}>
                <Button type="link" onClick={() => setFiltersExpanded(v => !v)} style={{ padding: 0 }}>
                  {filtersExpanded ? '收起' : '展开'}
                  <DownOutlined style={{ fontSize: 10, marginLeft: 2, transform: filtersExpanded ? 'rotate(180deg)' : undefined }} />
                </Button>
              </Col>
            </Row>

            {/* 第二行（展开后）：出题老师、分类和时间筛选 */}
            {filtersExpanded && (
            <Row gutter={[12, 12]} align="middle">
              <Col span={5}>
                <Select
                  placeholder="出题老师"
                  allowClear
                  showSearch
                  value={filters.teacherName}
                  style={{ width: '100%' }}
                  onChange={(v) =>
                    setFilters((f) => ({
                      ...f,
                      teacherName: v || undefined,
                    }))
                  }
                  filterOption={(input, option) =>
                    (option?.label ?? '')
                      .toLowerCase()
                      .includes(input.toLowerCase())
                  }
                  options={teachers.map((t) => ({
                    value: t.realName,
                    label: t.realName,
                  }))}
                />
              </Col>

              <Col span={4}>
                <Select
                  placeholder="一级分类"
                  allowClear
                  showSearch
                  value={filters.primaryCategory}
                  style={{ width: '100%' }}
                  onChange={(v) => {
                    setFilters((f) => ({
                      ...f,
                      primaryCategory: v || undefined,
                      secondaryCategory: undefined, // 清空二级分类
                    }));
                  }}
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={categories
                    .filter((cat) => cat.level === 1)
                    .map((cat) => ({
                    value: cat.id,
                    label: cat.name,
                  }))}
                />
              </Col>

              <Col span={4}>
                <Select
                  placeholder="二级分类"
                  allowClear
                  showSearch
                  disabled={!filters.primaryCategory}
                  value={filters.secondaryCategory}
                  style={{ width: '100%' }}
                  onChange={(v) =>
                    setFilters((f) => ({
                      ...f,
                      secondaryCategory: v || undefined,
                    }))
                  }
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={
                    categories
                      .filter((cat) => cat.parentId === filters.primaryCategory)
                      .map((sub) => ({
                        value: sub.id,
                        label: sub.name,
                      }))
                  }
                />
              </Col>

              <Col span={6}>
                <RangePicker
                  placeholder={['创建开始', '创建结束']}
                  style={{ width: '100%' }}
                  onChange={(dates) => {
                    if (dates && dates[0] && dates[1]) {
                      const start = dates[0];
                      const end = dates[1];
                      setFilters((f) => ({
                        ...f,
                        createdAtStart: start.format('YYYY-MM-DD'),
                        createdAtEnd: end.format('YYYY-MM-DD'),
                      }));
                    } else {
                      setFilters((f) => ({
                        ...f,
                        createdAtStart: undefined,
                        createdAtEnd: undefined,
                      }));
                    }
                  }}
                />
              </Col>

              <Col span={5}>
                <RangePicker
                  placeholder={['更新开始', '更新结束']}
                  style={{ width: '100%' }}
                  onChange={(dates) => {
                    if (dates && dates[0] && dates[1]) {
                      const start = dates[0];
                      const end = dates[1];
                      setFilters((f) => ({
                        ...f,
                        updatedAtStart: start.format('YYYY-MM-DD'),
                        updatedAtEnd: end.format('YYYY-MM-DD'),
                      }));
                    } else {
                      setFilters((f) => ({
                        ...f,
                        updatedAtStart: undefined,
                        updatedAtEnd: undefined,
                      }));
                    }
                  }}
                />
              </Col>
            </Row>
            )}
          </Card>

          {/* 题干流列表：借鉴参考产品「校本题库」——不叠列表面板，直接把题干、选项、元信息铺开 */}
          <Spin spinning={loading}>
            {data.data.length === 0 && !loading ? (
              <Card size="small">
                <Empty description="没有符合条件的题目">
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/teacher/questions/new')}>
                    新建题目
                  </Button>
                </Empty>
              </Card>
            ) : (
              <Card size="small" styles={{ body: { padding: '4px 16px' } }}>
                {data.data.map((q, index) => (
                  <div key={q.id}>
                    <QuestionListItem question={q} actions={renderActions(q)} />
                    {index < data.data.length - 1 && <div className="qflow-divider" />}
                  </div>
                ))}
              </Card>
            )}
          </Spin>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <Pagination
              current={data.page}
              total={data.total}
              pageSize={data.pageSize}
              showSizeChanger
              showQuickJumper
              showTotal={(total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`}
              onChange={(page, pageSize) => fetchQuestions(page, pageSize)}
            />
          </div>
        </Col>
      </Row>

      {/* ✨ 详情弹窗 */}
      <QuestionDetailDrawer
        visible={detailVisible}
        question={selectedQuestion}
        onClose={() => {
          setDetailVisible(false);
          setSelectedQuestion(null);
        }}
      />

      {/* ✨ 知识点分类管理弹窗 */}
      <CategoryManagerModal
        visible={categoryModalVisible}
        onClose={() => {
          setCategoryModalVisible(false);
          // 刷新分类列表
          fetchCategories();
          fetchQuestions(data.page);
        }}
      />
    </div>
  );
}
