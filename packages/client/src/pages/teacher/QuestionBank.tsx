import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Input,
  Select,
  Space,
  Tag,
  Popconfirm,
  message,
  Card,
  DatePicker,
  Row,
  Col,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  EyeOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Question, PaginatedResponse, QuestionCategory } from '../../types';
import { QuestionDetailDrawer } from './QuestionDetailDrawer';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';

const { RangePicker } = DatePicker;

// 难度配置
const difficultyOptions = [
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
];

// 状态选项
const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'archived', label: '已归档' },
];

export function QuestionBank() {
  const navigate = useNavigate();
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

  // ✨ 扩展筛选条件状态
  const [filters, setFilters] = useState<{
    search?: string;
    difficulty?: string;
    status?: string;
    teacherName?: string;
    primaryCategory?: string;
    secondaryCategory?: string;
    createdAtStart?: string;
    createdAtEnd?: string;
    updatedAtStart?: string;
    updatedAtEnd?: string;
  }>({});

  // 获取题目列表数据
  const fetchQuestions = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: '20',
          // 只添加非空的筛选条件
          ...Object.fromEntries(
            Object.entries(filters).filter(([_, v]) => v !== undefined && v !== '')
          ),
        });

        const res = await api.get(`/questions?${params}`);
        setData(res.data);
      } catch (error) {
        console.error('Error fetching questions:', error);
        message.error('加载失败');
      } finally {
        setLoading(false);
      }
    },
    [filters]
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

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

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

  // 表格列定义
  const columns = [
    {
      title: '题目标题',
      dataIndex: 'title',
      key: 'title',
      width: 250,
      render: (text: string, record: Question) => (
        <a
          onClick={() => handleViewDetail(record)}
          style={{ color: '#000000', textDecoration: 'none' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textDecoration = 'underline';
            e.currentTarget.style.color = '#1890ff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = 'none';
            e.currentTarget.style.color = '#000000';
          }}
        >
          {text}
        </a>
      ),
    },
    {
      title: '难度',
      dataIndex: 'difficulty',
      key: 'difficulty',
      width: 80,
      render: (v: string) => (
        <Tag
          color={
            v === 'easy'
              ? 'green'
              : v === 'medium'
              ? 'orange'
              : 'red'
          }
        >
          {v === 'easy' ? '简单' : v === 'medium' ? '中等' : '困难'}
        </Tag>
      ),
    },
    {
      title: '分值',
      dataIndex: 'score',
      key: 'score',
      width: 60,
      render: (v: number) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '一级分类',
      key: 'primaryCategory',
      width: 100,
      render: (_: any, r: Question) =>
        r.primaryCategory ? (
          <Tag color="blue">{r.primaryCategory.name}</Tag>
        ) : (
          <span style={{ color: '#999' }}>—</span>
        ),
    },
    {
      title: '二级分类',
      key: 'secondaryCategory',
      width: 100,
      render: (_: any, r: Question) =>
        r.secondaryCategory ? (
          <Tag color="cyan">{r.secondaryCategory.name}</Tag>
        ) : (
          <span style={{ color: '#999' }}>—</span>
        ),
    },
    {
      title: '出题老师',
      dataIndex: 'teacherName',
      key: 'teacherName',
      width: 90,
      render: (v: string | null) => v || <span style={{ color: '#999' }}>—</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (v: string) => (
        <Tag
          color={
            v === 'published'
              ? 'green'
              : v === 'draft'
              ? 'default'
              : 'orange'
          }
        >
          {v === 'published'
            ? '已发布'
            : v === 'draft'
            ? '草稿'
            : '已归档'}
        </Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, record: Question) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record)}
            title="查看详情"
          />
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() =>
              navigate(`/teacher/questions/${record.id}/edit`)
            }
            title="编辑"
          />
          <Popconfirm
            title="确定删除该题目？"
            description="删除后无法恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              title="删除"
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

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
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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

      {/* ✨ 高级筛选区域 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        {/* 第一行：基础筛选 */}
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
          <Col span={6}>
            <Input
              placeholder="搜索标题或描述"
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

          <Col span={7}>
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

          <Col span={5}>
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

          <Col span={6}>
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
        </Row>

        {/* 第二行：分类和时间筛选 */}
        <Row gutter={[12, 12]} align="middle">
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

          <Col span={7}>
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

          <Col span={7}>
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

          <Col span={2}>
            <Button onClick={handleResetFilters}>重置</Button>
          </Col>
        </Row>
      </Card>

      {/* 数据表格 */}
      <Table
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1200 }}
        pagination={{
          current: data.page,
          total: data.total,
          pageSize: data.pageSize,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条记录`,
          onChange: (page, pageSize) => {
            // 如果页大小改变，回到第一页
            if (pageSize !== data.pageSize) {
              setFilters((f) => ({ ...f }));
              return;
            }
            fetchQuestions(page);
          },
        }}
      />

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
