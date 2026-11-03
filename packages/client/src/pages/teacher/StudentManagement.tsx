import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, message, Row, Col, Radio, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, ExportOutlined, ImportOutlined, LinkOutlined, ReloadOutlined, DeleteOutlined,
  DisconnectOutlined, UnlockOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { StudentInfo, Department, Major, ClassOption, PaginatedResponse } from '../../types';
import { PracticeFileModal } from '../../components/student/PracticeFileModal';

const genderMap: Record<string, string> = { MALE: '男', FEMALE: '女' };

const statusConfig: Record<string, { color: string; text: string }> = {
  ENABLED: { color: 'green', text: '启用' },
  DISABLED: { color: 'default', text: '禁用' },
};

export default function StudentManagement() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [data, setData] = useState<PaginatedResponse<StudentInfo>>({ data: [], total: 0, page: 1, pageSize: 10 });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentInfo | null>(null);
  const [form] = Form.useForm();

  // 练习表格配置弹窗
  const [practiceStudent, setPracticeStudent] = useState<StudentInfo | null>(null);
  const [practiceModalOpen, setPracticeModalOpen] = useState(false);

  const openPracticeFile = (student: StudentInfo) => {
    setPracticeStudent(student);
    setPracticeModalOpen(true);
  };

  // 从班级管理跳转过来时带 classRoomId，直接筛到该班
  const [searchParams] = useSearchParams();
  const initialClassRoomId = searchParams.get('classRoomId') || undefined;

  // 筛选状态
  const [filters, setFilters] = useState<{ departmentId?: string; majorId?: string; classRoomId?: string; search?: string }>({
    classRoomId: initialClassRoomId,
  });

  // 组织架构数据（院系/专业只作为可选筛选，班级选择走扁平列表）
  const [departments, setDepartments] = useState<Department[]>([]);
  const [majorOptions, setMajorOptions] = useState<Major[]>([]);
  const [allClassOptions, setAllClassOptions] = useState<ClassOption[]>([]);

  // ---------- Fetch departments tree ----------
  const fetchDepartments = useCallback(async () => {
    try {
      const res = await api.get<{ data: Department[] }>('/departments');
      setDepartments(res.data.data);
    } catch {
      message.error('加载院系架构失败');
    }
  }, []);

  useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

  // 扁平班级列表：新班级不挂院系时，仍能在筛选/建学生时选到
  useEffect(() => {
    api
      .get<{ data: ClassOption[] }>('/classrooms/options')
      .then((res) => setAllClassOptions(res.data.data || []))
      .catch(() => setAllClassOptions([]));
  }, []);

  useEffect(() => {
    const id = searchParams.get('classRoomId') || undefined;
    setFilters((prev) => (prev.classRoomId === id ? prev : { ...prev, classRoomId: id }));
  }, [searchParams]);

  // ---------- Fetch students ----------
  const fetchStudents = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize: 10, ...filters };
      const res = await api.get<PaginatedResponse<StudentInfo>>('/students', { params });
      setData(res.data);
    } catch {
      message.error('加载学生列表失败');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  // ---------- Filter: 院系/专业保留为可选筛选，班级用扁平列表 ----------
  const handleDepartmentChange = (departmentId: string | undefined) => {
    setFilters(prev => ({ ...prev, departmentId, majorId: undefined, classRoomId: undefined }));
    if (departmentId) {
      const dept = departments.find(d => d.id === departmentId);
      setMajorOptions(dept?.majors || []);
    } else {
      setMajorOptions([]);
    }
  };

  const handleMajorChange = (majorId: string | undefined) => {
    setFilters(prev => ({ ...prev, majorId, classRoomId: undefined }));
  };

  const handleClassRoomChange = (classRoomId: string | undefined) => {
    setFilters(prev => ({ ...prev, classRoomId }));
  };

  // ---------- Create / Edit ----------
  const handleCreate = () => {
    setEditingStudent(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = async (student: StudentInfo) => {
    setEditingStudent(student);
    form.resetFields();
    form.setFieldsValue({
      studentId: student.studentId,
      realName: student.realName,
      gender: student.gender,
      phoneNumber: student.phoneNumber,
      email: student.email,
      classRoomId: student.classRoomId,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        password: values.password,
        realName: values.realName,
        studentId: values.studentId,
        gender: values.gender,
        phoneNumber: values.phoneNumber,
        email: values.email,
        classRoomId: values.classRoomId,
      };

      if (editingStudent) {
        const { password: _password, ...updatePayload } = payload;
        await api.put(`/students/${editingStudent.id}`, updatePayload);
        message.success('更新成功');
      } else {
        await api.post('/students', payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchStudents();
    } catch (err: any) {
      if (err.response) {
        message.error(err.response?.data?.message || '操作失败');
      }
    }
  };

  // ---------- Reset password ----------
  // 服务端不再使用「学号后 6 位」这类可推算的默认密码（同学之间学号是公开信息，
  // 等于谁都能推算出别人的初始密码并冒用登录），改为随机口令并只在这里返回一次。
  const handleResetPassword = async (id: string) => {
    try {
      const res = await api.put(`/students/${id}/reset-password`);
      const pwd: string | undefined = res.data?.password;
      if (pwd) {
        Modal.info({
          title: '密码已重置',
          content: (
            <div>
              <p style={{ marginBottom: 8 }}>请把下面的新密码<strong>当面转告学生</strong>，关闭后系统不再显示：</p>
              <Typography.Paragraph copyable style={{ fontSize: 18, fontWeight: 600, marginBottom: 0 }}>
                {pwd}
              </Typography.Paragraph>
            </div>
          ),
          okText: '我已记录',
        });
      } else {
        message.success('密码已重置');
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '重置密码失败');
    }
  };

  // ---------- Toggle status (enable/disable) ----------
  const handleToggleStatus = async (student: StudentInfo) => {
    try {
      const newStatus = student.accountStatus === 'ENABLED' ? 'DISABLED' : 'ENABLED';
      await api.put(`/students/${student.id}`, { accountStatus: newStatus });
      message.success(newStatus === 'ENABLED' ? '已启用' : '已禁用');
      fetchStudents();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  // ---------- Delete (admin only) ----------
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/students/${id}`);
      message.success('已删除');
      fetchStudents();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // ---------- Export ----------
  const handleExport = async () => {
    try {
      const response = await api.get('/students/export', {
        params: filters,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `学生列表_${dayjs().format('YYYYMMDD')}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('导出失败');
    }
  };

  // ---------- WPS 绑定 / 登录锁定（仅管理员） ----------
  const handleUnbindWps = async (id: string) => {
    try {
      await api.delete(`/users/${id}/wps-binding`);
      message.success('WPS 绑定已解除');
      fetchStudents(data.page);
    } catch (err: any) {
      message.error(err.response?.data?.message || '解绑失败');
    }
  };

  const handleUnlock = async (id: string) => {
    try {
      await api.delete(`/users/${id}/login-lock`);
      message.success('登录锁定已解除');
      fetchStudents(data.page);
    } catch (err: any) {
      message.error(err.response?.data?.message || '解锁失败');
    }
  };

  const isLocked = (student: StudentInfo) =>
    Boolean(student.lockedUntil && new Date(student.lockedUntil).getTime() > Date.now());

  // ---------- Table columns ----------
  const columns = [
    {
      title: '学号（登录名）', dataIndex: 'studentId', key: 'studentId', width: 140,
      render: (v: string) => v || '—',
    },
    {
      title: '姓名', dataIndex: 'realName', key: 'realName', width: 90,
      render: (v: string) => v || '—',
    },
    {
      title: '性别', dataIndex: 'gender', key: 'gender', width: 70,
      render: (v: string) => genderMap[v] || '—',
    },
    {
      title: '班级', key: 'classInfo', width: 200,
      render: (_: any, r: StudentInfo) => {
        const parts = [r.department?.name, r.major?.name, r.classRoom?.name].filter(Boolean);
        return parts.length > 0 ? parts.join(' / ') : '—';
      },
    },
    {
      title: '手机号', dataIndex: 'phoneNumber', key: 'phoneNumber', width: 120,
      render: (v: string) => v || '—',
    },
    {
      title: '账号状态', dataIndex: 'accountStatus', key: 'accountStatus', width: 100,
      render: (v: string) => {
        const cfg = statusConfig[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: 'WPS', dataIndex: 'wpsUserId', key: 'wpsUserId', width: 90,
      render: (v: string | null | undefined) => (
        <Tag color={v ? 'blue' : 'default'}>{v ? '已绑定' : '未绑定'}</Tag>
      ),
    },
    {
      title: '登录状态', key: 'loginStatus', width: 90,
      render: (_: any, r: StudentInfo) =>
        isLocked(r) ? <Tag color="red">锁定中</Tag> : <Tag color="green">正常</Tag>,
    },
    {
      title: '练习表格', key: 'practice', width: 110,
      render: (_: any, r: StudentInfo) => {
        const has = !!r.practiceTableAssignment;
        return (
          <Button
            type="link" size="small" style={{ padding: 0 }}
            onClick={() => openPracticeFile(r)}
          >
            {has ? '已配置' : '未配置'}
          </Button>
        );
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 120,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '—',
    },
    {
      title: '操作', key: 'actions', width: 340,
      render: (_: any, r: StudentInfo) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm title="确定重置该学生密码？" onConfirm={() => handleResetPassword(r.id)} okText="确定" cancelText="取消">
            <Button size="small">重置密码</Button>
          </Popconfirm>
          <Popconfirm
            title={r.accountStatus === 'ENABLED' ? '确定禁用该账号？' : '确定启用该账号？'}
            onConfirm={() => handleToggleStatus(r)}
            okText="确定" cancelText="取消"
          >
            <Button size="small" danger={r.accountStatus === 'ENABLED'}>
              {r.accountStatus === 'ENABLED' ? '禁用' : '启用'}
            </Button>
          </Popconfirm>
          {user?.role === 'admin' && (
            <>
              {isLocked(r) && (
                <Button
                  size="small"
                  icon={<UnlockOutlined />}
                  title="解除登录锁定"
                  onClick={() => handleUnlock(r.id)}
                >
                  解锁
                </Button>
              )}
              <Popconfirm
                title="解除该学生的 WPS 绑定？"
                description="解绑后下次需重新完成 WPS 首次绑定。"
                onConfirm={() => handleUnbindWps(r.id)}
                disabled={!r.wpsUserId}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  size="small"
                  icon={<DisconnectOutlined />}
                  title="解除 WPS 绑定"
                  disabled={!r.wpsUserId}
                />
              </Popconfirm>
              <Popconfirm title="确定删除该学生？此操作不可撤销" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>学生管理</h2>
      </div>

      {/* 筛选栏 */}
      <Row gutter={[12, 8]} style={{ marginBottom: 16 }} align="middle">
        <Col>
          <Select
            placeholder="院系"
            allowClear
            style={{ width: 160 }}
            value={filters.departmentId}
            onChange={handleDepartmentChange}
            options={departments.map(d => ({ value: d.id, label: d.name }))}
          />
        </Col>
        <Col>
          <Select
            placeholder="专业"
            allowClear
            style={{ width: 160 }}
            value={filters.majorId}
            onChange={handleMajorChange}
            disabled={!filters.departmentId}
            options={majorOptions.map(m => ({ value: m.id, label: m.name }))}
          />
        </Col>
        <Col>
          <Select
            placeholder="班级"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 190 }}
            value={filters.classRoomId}
            onChange={handleClassRoomChange}
            options={allClassOptions.map(c => ({
              value: c.id,
              label: `${c.name}（${c.code}）`,
            }))}
          />
        </Col>
        <Col>
          <Input.Search
            placeholder="搜索学号/姓名"
            allowClear
            style={{ width: 200 }}
            onSearch={(val) => setFilters(prev => ({ ...prev, search: val || undefined }))}
          />
        </Col>
        <Col>
          <Space>
            <Button icon={<PlusOutlined />} type="primary" onClick={handleCreate}>新增学生</Button>
            <Button icon={<ImportOutlined />} onClick={() => navigate('/teacher/students/import')}>批量导入</Button>
            <Button icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
            <Button icon={<LinkOutlined />} onClick={() => navigate('/teacher/invitations')}>邀请加入</Button>
            <Button icon={<ReloadOutlined />} onClick={() => fetchStudents()}>刷新</Button>
          </Space>
        </Col>
      </Row>

      {/* 表格 */}
      <Table
        dataSource={data.data}
        columns={columns}
        rowKey="id"
        loading={loading}
        // 11 列在窄屏下会被压成逐字换行；内容不足一屏时铺满，超宽时横向滚动
        scroll={{ x: 'max-content' }}
        pagination={{
          current: data.page,
          total: data.total,
          pageSize: data.pageSize,
          showSizeChanger: false,
          onChange: (page) => fetchStudents(page),
        }}
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={editingStudent ? '编辑学生' : '新增学生'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {!editingStudent && (
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少6位' }]}>
              <Input.Password placeholder="设置登录密码" />
            </Form.Item>
          )}
          <Form.Item name="studentId" label="学号（登录名）" rules={[
            { required: true, message: '请输入学号' },
          ]} extra="登录名自动使用学号，无需单独设置">
            <Input placeholder="学生学号" />
          </Form.Item>
          <Form.Item name="realName" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="真实姓名" />
          </Form.Item>
          <Form.Item name="gender" label="性别">
            <Radio.Group>
              <Radio value="MALE">男</Radio>
              <Radio value="FEMALE">女</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="phoneNumber" label="手机号" rules={[
            { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
          ]}>
            <Input placeholder="手机号码" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="电子邮箱" />
          </Form.Item>
          <Form.Item
            name="classRoomId"
            label="班级"
            extra="院系/专业由班级自动带出；新班级未挂院系时也能选择"
          >
            <Select
              placeholder="选择班级"
              allowClear
              showSearch
              optionFilterProp="label"
              options={allClassOptions.map(c => ({
                value: c.id,
                label: `${c.name}（${c.code}）`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 配置练习表格弹窗 */}
      <PracticeFileModal
        student={practiceStudent}
        open={practiceModalOpen}
        onClose={() => setPracticeModalOpen(false)}
        onSaved={() => fetchStudents(data.page)}
      />
    </div>
  );
}
