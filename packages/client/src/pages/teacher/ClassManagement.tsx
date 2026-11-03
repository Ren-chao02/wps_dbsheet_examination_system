import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  BankOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { ClassRow } from '../../types';
import { ClassFormModal } from './components/ClassFormModal';
import { BatchAssignTeachersModal } from './components/BatchAssignTeachersModal';
import './class-management.css';

const { Text } = Typography;

const PAGE_SIZE = 20;

const SORT_OPTIONS = [
  { value: 'createdAt_desc', label: '按创建时间倒序' },
  { value: 'createdAt_asc', label: '按创建时间正序' },
  { value: 'name_asc', label: '按班级名称' },
];

const sourceLabel: Record<string, { color: string; text: string }> = {
  MANUAL: { color: 'blue', text: '手动创建' },
  SYSTEM: { color: 'default', text: '系统预置' },
};

/** 复制到剪贴板；非安全上下文（如局域网 http 访问）时回退到 execCommand */
async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    message.success('班级编码已复制');
  } catch {
    message.error('复制失败，请手动选择并复制');
  }
}

/**
 * 班级管理：班级列表成为主入口。
 * 管理员可建班/编辑/删除/批量分配教师；教师只看自己任教的班级。
 */
export default function ClassManagement() {
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';

  const [rows, setRows] = useState<ClassRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('createdAt_desc');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [wpsOpen, setWpsOpen] = useState(false);

  const load = useCallback(async (targetPage: number, keyword: string, sortValue: string) => {
    setLoading(true);
    try {
      const res = await api.get('/classrooms', {
        params: {
          page: targetPage,
          pageSize: PAGE_SIZE,
          search: keyword || undefined,
          sort: sortValue,
        },
      });
      setRows(res.data.data || []);
      setTotal(res.data.total || 0);
      setPage(res.data.page || targetPage);
      setSelectedRowKeys([]);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载班级列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, query, sort);
  }, [query, sort, load]);

  const handleSearch = () => setQuery(searchText.trim());

  const handleReset = () => {
    setSearchText('');
    setQuery('');
    setSort('createdAt_desc');
  };

  const openCreate = () => {
    setEditingClass(null);
    setFormMode('create');
    setFormOpen(true);
  };

  const openEdit = (row: ClassRow) => {
    setEditingClass(row);
    setFormMode('edit');
    setFormOpen(true);
  };

  const handleDelete = async (row: ClassRow) => {
    try {
      await api.delete(`/classrooms/${row.id}`);
      message.success('班级已删除');
      void load(page, query, sort);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '删除失败');
    }
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${selectedRowKeys.length} 个班级？`,
      content: '有学生或邀请的班级会被跳过，不会误删。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await api.post('/classrooms/batch-delete', { ids: selectedRowKeys });
          const deleted: string[] = res.data.deleted || [];
          const skipped: Array<{ name?: string; reason: string }> = res.data.skipped || [];
          if (deleted.length > 0) message.success(`已删除 ${deleted.length} 个班级`);
          if (skipped.length > 0) {
            Modal.info({
              title: `${skipped.length} 个班级未删除`,
              content: (
                <div>
                  {skipped.map((item, index) => (
                    <div key={`${item.name || 'class'}-${index}`} style={{ marginTop: 6 }}>
                      <Text strong>{item.name || '未命名班级'}</Text>
                      <Text type="secondary">：{item.reason}</Text>
                    </div>
                  ))}
                </div>
              ),
            });
          }
          void load(page, query, sort);
        } catch (err: any) {
          message.error(err?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  const newClassMenu = {
    items: [
      { key: 'single', icon: <PlusOutlined />, label: '单个新增' },
      {
        key: 'wps',
        icon: <BankOutlined />,
        label: (
          <Space size={6}>
            从 WPS 通讯录快速建班
            <Tag style={{ marginInlineEnd: 0 }}>需开通通讯录权限</Tag>
          </Space>
        ),
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'single') openCreate();
      else setWpsOpen(true);
    },
  };

  const columns: ColumnsType<ClassRow> = [
    {
      title: '班级名称',
      key: 'name',
      width: 175,
      render: (_: unknown, row) => (
        <div>
          <div className="class-name">{row.name}</div>
          <Tooltip title="点击复制，学生批量导入时按此编码匹配班级">
            <button
              type="button"
              className="class-code"
              onClick={() => void copyText(row.code)}
            >
              {row.code}
            </button>
          </Tooltip>
        </div>
      ),
    },
    {
      title: '班级人数',
      dataIndex: 'studentCount',
      key: 'studentCount',
      width: 90,
    },
    {
      title: '创建者',
      key: 'creator',
      width: 95,
      render: (_: unknown, row) =>
        row.creator?.realName || row.creator?.username || (
          <Text type="secondary">系统预置</Text>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 145,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '管理教师',
      key: 'teachers',
      width: 140,
      render: (_: unknown, row) =>
        row.teachers.length > 0 ? (
          <div className="class-teachers">
            {row.teachers.map((teacher) => (
              <Tag key={teacher.id} color="blue">
                {teacher.realName || teacher.username}
              </Tag>
            ))}
          </div>
        ) : (
          <Text type="secondary">未分配</Text>
        ),
    },
    {
      title: '创建来源',
      dataIndex: 'source',
      key: 'source',
      width: 85,
      render: (value: string) => {
        const cfg = sourceLabel[value] || { color: 'default', text: value };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: isAdmin ? 190 : 140,
      fixed: 'right',
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<UserOutlined />}
            onClick={() => navigate(`/teacher/students?classRoomId=${row.id}`)}
          >
            学生
          </Button>
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            onClick={() => navigate(`/teacher/invitations?classRoomId=${row.id}`)}
          >
            邀请
          </Button>
          {isAdmin && (
            <>
              <Tooltip title="编辑班级">
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  aria-label="编辑班级"
                  onClick={() => openEdit(row)}
                />
              </Tooltip>
              <Tooltip
                title={
                  row.studentCount > 0 || row.invitationCount > 0
                    ? `班级下仍有 ${row.studentCount} 名学生 / ${row.invitationCount} 条邀请，不能删除`
                    : '删除班级'
                }
              >
                <Popconfirm
                  title="确定删除该班级？"
                  onConfirm={() => handleDelete(row)}
                  disabled={row.studentCount > 0 || row.invitationCount > 0}
                >
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="删除班级"
                    disabled={row.studentCount > 0 || row.invitationCount > 0}
                  />
                </Popconfirm>
              </Tooltip>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="class-page-head">
        <div>
          <h2>班级管理</h2>
          <Text type="secondary">
            维护班级、管理教师与学生归属
            {!isAdmin && '（仅显示您任教的班级）'}
          </Text>
        </div>
        {isAdmin && (
          <Space size={6}>
            <Button size="small" type="link" onClick={() => navigate('/admin/departments')}>
              院系/专业设置
            </Button>
          </Space>
        )}
      </div>

      <Card styles={{ body: { padding: 16 } }}>
        <div className="class-toolbar">
          <div className="class-toolbar__left">
            <Input
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onPressEnter={handleSearch}
              prefix={<SearchOutlined />}
              placeholder="搜索班级名称/班级编码/教师名称"
              style={{ width: 280 }}
            />
            <Select
              value={sort}
              onChange={setSort}
              options={SORT_OPTIONS}
              style={{ width: 170 }}
            />
            <Button type="primary" onClick={handleSearch}>
              查询
            </Button>
            <Button onClick={handleReset}>重置</Button>
          </div>

          {isAdmin && (
            <div className="class-toolbar__right">
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={selectedRowKeys.length === 0}
                onClick={handleBatchDelete}
              >
                删除
              </Button>
              <Button
                icon={<TeamOutlined />}
                disabled={selectedRowKeys.length === 0}
                onClick={() => setBatchOpen(true)}
              >
                批量分配教师
              </Button>
              <Dropdown menu={newClassMenu} trigger={['click']}>
                <Button type="primary">
                  新建班级 <DownOutlined />
                </Button>
              </Dropdown>
            </div>
          )}
        </div>

        <Table<ClassRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          scroll={{ x: 960 }}
          rowSelection={
            isAdmin
              ? {
                  selectedRowKeys,
                  onChange: setSelectedRowKeys,
                }
              : undefined
          }
          locale={{ emptyText: <Empty description="暂无班级" /> }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (count) => `共 ${count} 个班级`,
            onChange: (nextPage) => void load(nextPage, query, sort),
          }}
        />
      </Card>

      <ClassFormModal
        open={formOpen}
        mode={formMode}
        initial={editingClass}
        onCancel={() => setFormOpen(false)}
        onSuccess={() => void load(page, query, sort)}
      />

      <BatchAssignTeachersModal
        open={batchOpen}
        classIds={selectedRowKeys.map(String)}
        onCancel={() => setBatchOpen(false)}
        onSuccess={() => void load(page, query, sort)}
      />

      <Modal
        open={wpsOpen}
        title="从 WPS 通讯录快速建班"
        footer={
          <Button type="primary" onClick={() => setWpsOpen(false)}>
            知道了
          </Button>
        }
        onCancel={() => setWpsOpen(false)}
      >
        <p>
          该功能会读取 WPS 365 通讯录的组织架构，把选中的部门快速创建为班级。
          本次版本暂未启用。
        </p>
        <p style={{ marginBottom: 0 }}>
          启用前需要：开通 <Text code>kso.contact.read</Text> /{' '}
          <Text code>kso.contact.readwrite</Text>、在 WPS 开发者后台配置通讯录数据权限范围，
          并发布新的应用版本。
        </p>
      </Modal>
    </div>
  );
}
