/**
 * 教师班级分配（独立页） — 让管理员集中查看/分配每位教师负责的班级
 *
 * 与「账户管理」里嵌入的「负责班级」字段是同一份数据（共享后端接口），
 * 但本页提供更直观的批量查看入口：表格直接展示每位教师的已分配班级，
 * 点击「分配班级」即可在弹窗中编辑，无需进入账户编辑流程。
 *
 * 后端接口：
 *   GET  /api/accounts?role=teacher        — 教师列表（分页 + 搜索）
 *   GET  /api/accounts/:id/classes         — 该教师当前负责的班级
 *   PUT  /api/accounts/:id/classes         — 全量覆盖更新（classIds）
 *   GET  /api/departments                  — 院系树（展平为班级选项列表）
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Select, Tag, Space, Input, Typography,
  message, Tooltip, Empty, Form, Descriptions,
} from 'antd';
import {
  TeamOutlined, SearchOutlined, ReloadOutlined, EditOutlined, BankOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api from '../../services/api';
import type { Account, PaginatedResponse } from '../../types';

const { Text, Title } = Typography;

// 班级选项（从院系树展平）
interface ClassOption {
  id: string;
  name: string;
  code: string;
  departmentName?: string;
  majorName?: string;
}

// 教师已分配班级的精简结构（与后端 GET /accounts/:id/classes 返回一致）
interface ClassSummary {
  id: string;
  name: string;
  code: string;
}

// 教师行（在 Account 基础上附带已分配班级，运行时拼接）
interface TeacherRow extends Account {
  classes: ClassSummary[];
}

const statusMap: Record<string, { color: string; text: string }> = {
  ENABLED: { color: 'green', text: '启用' },
  DISABLED: { color: 'red', text: '禁用' },
};

export default function TeacherClassAssignment() {
  const [data, setData] = useState<PaginatedResponse<Account>>({
    data: [], total: 0, page: 1, pageSize: 20,
  });
  // 教师行附带班级信息（按 id 索引）
  const [classMap, setClassMap] = useState<Record<string, ClassSummary[]>>({});
  const [allClasses, setAllClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<TeacherRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ classIds: string[] }>();

  // ── 拉取教师列表 ──
  const fetchTeachers = useCallback(async (page = 1, pageSize = 20, keyword = '') => {
    setLoading(true);
    try {
      const params: any = { page, pageSize, role: 'teacher' };
      if (keyword) params.search = keyword;
      const res = await api.get<PaginatedResponse<Account>>('/accounts', { params });
      setData(res.data);
      // 并行拉取每位教师的当前班级（一页最多 20 个并发请求）
      await prefetchClasses(res.data.data);
    } catch (err: any) {
      message.error(err.response?.data?.message || '加载教师列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── 拉取班级选项（院系树展平） ──
  const fetchAllClasses = useCallback(async () => {
    try {
      const res = await api.get('/departments');
      const deps = res.data.data || [];
      const list: ClassOption[] = [];
      for (const dep of deps) {
        for (const major of dep.majors || []) {
          for (const cls of major.classRooms || []) {
            list.push({
              id: cls.id,
              name: cls.name,
              code: cls.code,
              departmentName: dep.name,
              majorName: major.name,
            });
          }
        }
      }
      setAllClasses(list);
    } catch {
      // 院系接口失败时静默，Modal 内会显示空选项
    }
  }, []);

  // ── 预拉取当前页每位教师的班级 ──
  const prefetchClasses = async (accounts: Account[]) => {
    const results = await Promise.all(
      accounts.map(async (acc): Promise<{ id: string; classes: ClassSummary[] }> => {
        try {
          const res = await api.get(`/accounts/${acc.id}/classes`);
          const classes: ClassSummary[] = ((res.data.data as any[]) || []).map((c: any) => ({
            id: String(c.id), name: String(c.name), code: String(c.code),
          }));
          return { id: acc.id, classes };
        } catch {
          return { id: acc.id, classes: [] };
        }
      }),
    );
    setClassMap(prev => {
      const next = { ...prev };
      for (const r of results) next[r.id] = r.classes;
      return next;
    });
  };

  useEffect(() => {
    fetchTeachers();
    fetchAllClasses();
  }, [fetchTeachers, fetchAllClasses]);

  // ── 打开分配 Modal：拉取该教师最新班级 ──
  const handleAssign = async (teacher: Account) => {
    // 先用缓存数据快速打开 Modal，避免等待感
    const cached = classMap[teacher.id] || [];
    const row: TeacherRow = { ...teacher, classes: cached };
    setEditingTeacher(row);
    form.setFieldsValue({ classIds: cached.map(c => c.id) });
    setModalOpen(true);
    // 异步刷新最新数据，确保 Modal 选中态正确
    try {
      const res = await api.get(`/accounts/${teacher.id}/classes`);
      const fresh: ClassSummary[] = ((res.data.data as any[]) || []).map((c: any) => ({
        id: String(c.id), name: String(c.name), code: String(c.code),
      }));
      setClassMap(prev => ({ ...prev, [teacher.id]: fresh }));
      // 仅当用户仍停留在该教师的 Modal 时才更新表单值
      setEditingTeacher(prev => prev?.id === teacher.id ? { ...prev, classes: fresh } : prev);
      form.setFieldsValue({ classIds: fresh.map(c => c.id) });
    } catch {
      // 静默：缓存数据已展示，不影响使用
    }
  };

  // ── 保存分配 ──
  const handleSave = async () => {
    if (!editingTeacher) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.put(`/accounts/${editingTeacher.id}/classes`, {
        classIds: values.classIds || [],
      });
      // 更新本地缓存
      const updated = (allClasses
        .filter(c => (values.classIds || []).includes(c.id))
        .map(c => ({ id: c.id, name: c.name, code: c.code }))
      );
      setClassMap(prev => ({ ...prev, [editingTeacher.id]: updated }));
      message.success(`已更新 ${editingTeacher.realName || editingTeacher.username} 的班级分配`);
      setModalOpen(false);
    } catch (err: any) {
      if (err?.errorFields) return; // 表单校验失败，字段级提示已展示
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // ── 搜索（防抖式回车触发） ──
  const handleSearch = (value: string) => {
    setSearch(value);
    fetchTeachers(1, data.pageSize, value);
  };

  // ── 表格列定义 ──
  const columns: ColumnsType<Account> = [
    {
      title: '用户名', dataIndex: 'username', key: 'username', width: 140,
    },
    {
      title: '姓名', dataIndex: 'realName', key: 'realName', width: 120,
      render: (v: string | null) => v || '—',
    },
    {
      title: '系统角色', key: 'systemRole', width: 140,
      render: (_: any, r: Account) =>
        r.systemRole ? <Tag color="blue">{r.systemRole.roleName}</Tag> : '—',
    },
    {
      title: '状态', dataIndex: 'accountStatus', key: 'accountStatus', width: 90,
      render: (v: string) => {
        const cfg = statusMap[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '已分配班级', key: 'classes', ellipsis: false,
      render: (_: any, r: Account) => {
        const cls = classMap[r.id] || [];
        if (cls.length === 0) {
          return <Text type="secondary">未分配</Text>;
        }
        // 最多显示 3 个 Tag，剩余折叠
        const visible = cls.slice(0, 3);
        const rest = cls.length - visible.length;
        return (
          <Space wrap size={[4, 4]}>
            {visible.map(c => (
              <Tag key={c.id} color="geekblue">{c.name}</Tag>
            ))}
            {rest > 0 && (
              <Tooltip title={cls.map(c => c.name).join('、')}>
                <Tag>+{rest}</Tag>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '班级数', key: 'classCount', width: 80, align: 'center',
      render: (_: any, r: Account) => {
        const n = (classMap[r.id] || []).length;
        return <Tag color={n === 0 ? 'default' : 'blue'}>{n}</Tag>;
      },
    },
    {
      title: '操作', key: 'action', width: 130, fixed: 'right',
      render: (_: any, r: Account) => (
        <Button
          type="primary"
          size="small"
          icon={<EditOutlined />}
          onClick={() => handleAssign(r)}
        >
          分配班级
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>
            <TeamOutlined style={{ marginRight: 12 }} />
            教师班级分配
          </Title>
          <Text type="secondary">
            集中查看每位教师当前负责的班级，并直接在弹窗中编辑。数据与「账户管理」共享。
          </Text>
        </div>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索用户名 / 姓名"
            style={{ width: 240 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onPressEnter={e => handleSearch((e.target as HTMLInputElement).value)}
            onClear={() => handleSearch('')}
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchTeachers(data.page, data.pageSize, search)}>
            刷新
          </Button>
        </Space>
      </div>

      {allClasses.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Text type="warning">
            ⚠ 当前院系架构中没有班级。请先到「学生管理 → 院系架构」创建院系/专业/班级，否则下拉框将是空的。
          </Text>
        </div>
      )}

      <Table<Account>
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
        scroll={{ x: 1100 }}
        pagination={{
          current: data.page,
          total: data.total,
          pageSize: data.pageSize,
          showSizeChanger: false,
          onChange: (page) => fetchTeachers(page, data.pageSize, search),
        }}
        locale={{ emptyText: <Empty description="暂无教师账号" /> }}
      />

      {/* 分配班级 Modal */}
      <Modal
        title="分配负责班级"
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={620}
        destroyOnHidden
      >
        {editingTeacher && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 20 }}>
              <Descriptions.Item label="用户名">{editingTeacher.username}</Descriptions.Item>
              <Descriptions.Item label="姓名">{editingTeacher.realName || '—'}</Descriptions.Item>
              <Descriptions.Item label="系统角色" span={2}>
                {editingTeacher.systemRole?.roleName || '—'}
              </Descriptions.Item>
            </Descriptions>

            <Form form={form} layout="vertical">
              <Form.Item
                name="classIds"
                label="负责班级"
                tooltip="教师只能管理所选班级的学生。选择后立即生效，未选的班级将不再归该教师管理。"
              >
                <Select
                  mode="multiple"
                  placeholder="选择该教师负责的班级（可多选）"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                  options={allClasses.map(c => ({
                    value: c.id,
                    label: `${c.departmentName ? c.departmentName + ' / ' : ''}${c.majorName ? c.majorName + ' / ' : ''}${c.name} (${c.code})`,
                  }))}
                  notFoundContent={allClasses.length === 0
                    ? '院系架构中没有班级，请先到「院系架构」创建'
                    : '未找到匹配的班级'}
                />
              </Form.Item>
            </Form>

            <div style={{ marginTop: 8, padding: 12, background: '#fafafa', borderRadius: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <BankOutlined style={{ marginRight: 6 }} />
                共 {allClasses.length} 个班级可选。保存后将全量覆盖该教师当前的班级分配。
              </Text>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
