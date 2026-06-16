import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, Popconfirm, message, Row, Col, Radio,
} from 'antd';
import {
  PlusOutlined, EditOutlined, ExportOutlined, ImportOutlined, LinkOutlined, ReloadOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { StudentInfo, Department, Major, ClassRoom, PaginatedResponse } from '../../types';

const genderMap: Record<string, string> = { MALE: '男', FEMALE: '女' };

const statusConfig: Record<string, { color: string; text: string }> = {
  ACTIVE: { color: 'green', text: '正常' },
  INACTIVE: { color: 'default', text: '禁用' },
  PENDING_APPROVAL: { color: 'orange', text: '待审批' },
};

export default function StudentManagement() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [data, setData] = useState<PaginatedResponse<StudentInfo>>({ data: [], total: 0, page: 1, pageSize: 10 });
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentInfo | null>(null);
  const [form] = Form.useForm();

  // 筛选状态
  const [filters, setFilters] = useState<{ departmentId?: string; majorId?: string; classRoomId?: string; search?: string }>({});

  // 组织架构数据
  const [departments, setDepartments] = useState<Department[]>([]);
  const [majorOptions, setMajorOptions] = useState<Major[]>([]);
  const [classRoomOptions, setClassRoomOptions] = useState<ClassRoom[]>([]);

  // 表单中的级联选择数据
  const [formMajors, setFormMajors] = useState<Major[]>([]);
  const [formClassRooms, setFormClassRooms] = useState<ClassRoom[]>([]);

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

  // ---------- Filter: cascading selects ----------
  const handleDepartmentChange = (departmentId: string | undefined) => {
    setFilters(prev => ({ ...prev, departmentId, majorId: undefined, classRoomId: undefined }));
    if (departmentId) {
      const dept = departments.find(d => d.id === departmentId);
      setMajorOptions(dept?.majors || []);
    } else {
      setMajorOptions([]);
    }
    setClassRoomOptions([]);
  };

  const handleMajorChange = (majorId: string | undefined) => {
    setFilters(prev => ({ ...prev, majorId, classRoomId: undefined }));
    if (majorId) {
      const major = majorOptions.find(m => m.id === majorId);
      setClassRoomOptions(major?.classRooms || []);
    } else {
      setClassRoomOptions([]);
    }
  };

  const handleClassRoomChange = (classRoomId: string | undefined) => {
    setFilters(prev => ({ ...prev, classRoomId }));
  };

  // ---------- Form: cascading selects ----------
  const handleFormDeptChange = (departmentId: string | undefined) => {
    form.setFieldsValue({ majorId: undefined, classRoomId: undefined });
    if (departmentId) {
      const dept = departments.find(d => d.id === departmentId);
      setFormMajors(dept?.majors || []);
    } else {
      setFormMajors([]);
    }
    setFormClassRooms([]);
  };

  const handleFormMajorChange = (majorId: string | undefined) => {
    form.setFieldsValue({ classRoomId: undefined });
    if (majorId) {
      const major = formMajors.find(m => m.id === majorId);
      setFormClassRooms(major?.classRooms || []);
    } else {
      setFormClassRooms([]);
    }
  };

  // ---------- Create / Edit ----------
  const handleCreate = () => {
    setEditingStudent(null);
    form.resetFields();
    setFormMajors([]);
    setFormClassRooms([]);
    setModalOpen(true);
  };

  const handleEdit = async (student: StudentInfo) => {
    setEditingStudent(student);
    form.resetFields();

    // Populate cascading selects based on student's current department/major
    let fmajors: Major[] = [];
    let fclassRooms: ClassRoom[] = [];

    if (student.departmentId) {
      const dept = departments.find(d => d.id === student.departmentId);
      fmajors = dept?.majors || [];
      setFormMajors(fmajors);
    }

    if (student.majorId) {
      const major = fmajors.find(m => m.id === student.majorId);
      fclassRooms = major?.classRooms || [];
      setFormClassRooms(fclassRooms);
    }

    form.setFieldsValue({
      username: student.username,
      studentId: student.studentId,
      realName: student.realName,
      gender: student.gender,
      phoneNumber: student.phoneNumber,
      email: student.email,
      departmentId: student.departmentId,
      majorId: student.majorId,
      classRoomId: student.classRoomId,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        username: values.username,
        password: values.password,
        realName: values.realName,
        studentId: values.studentId,
        gender: values.gender,
        phoneNumber: values.phoneNumber,
        email: values.email,
        classRoomId: values.classRoomId,
      };

      if (editingStudent) {
        const { username, password, ...updatePayload } = payload;
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
  const handleResetPassword = async (id: string) => {
    try {
      await api.put(`/students/${id}/reset-password`);
      message.success('密码已重置为默认密码');
    } catch (err: any) {
      message.error(err.response?.data?.message || '重置密码失败');
    }
  };

  // ---------- Toggle status (enable/disable) ----------
  const handleToggleStatus = async (student: StudentInfo) => {
    try {
      const newStatus = student.accountStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await api.put(`/students/${student.id}`, { accountStatus: newStatus });
      message.success(newStatus === 'ACTIVE' ? '已启用' : '已禁用');
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

  // ---------- Table columns ----------
  const columns = [
    {
      title: '学号', dataIndex: 'studentId', key: 'studentId', render: (v: string) => v || '—',
    },
    {
      title: '姓名', dataIndex: 'realName', key: 'realName', render: (v: string) => v || '—',
    },
    {
      title: '性别', dataIndex: 'gender', key: 'gender', width: 80,
      render: (v: string) => genderMap[v] || '—',
    },
    {
      title: '班级', key: 'classInfo',
      render: (_: any, r: StudentInfo) => {
        const parts = [r.department?.name, r.major?.name, r.classRoom?.name].filter(Boolean);
        return parts.length > 0 ? parts.join(' / ') : '—';
      },
    },
    {
      title: '手机号', dataIndex: 'phoneNumber', key: 'phoneNumber', render: (v: string) => v || '—',
    },
    {
      title: '账号状态', dataIndex: 'accountStatus', key: 'accountStatus', width: 100,
      render: (v: string) => {
        const cfg = statusConfig[v] || { color: 'default', text: v };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 120,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '—',
    },
    {
      title: '操作', key: 'actions', width: 260,
      render: (_: any, r: StudentInfo) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm title="确定重置该学生密码？" onConfirm={() => handleResetPassword(r.id)} okText="确定" cancelText="取消">
            <Button size="small">重置密码</Button>
          </Popconfirm>
          <Popconfirm
            title={r.accountStatus === 'ACTIVE' ? '确定禁用该账号？' : '确定启用该账号？'}
            onConfirm={() => handleToggleStatus(r)}
            okText="确定" cancelText="取消"
          >
            <Button size="small" danger={r.accountStatus === 'ACTIVE'}>
              {r.accountStatus === 'ACTIVE' ? '禁用' : '启用'}
            </Button>
          </Popconfirm>
          {user?.role === 'admin' && (
            <Popconfirm title="确定删除该学生？此操作不可撤销" onConfirm={() => handleDelete(r.id)} okText="确定" cancelText="取消">
              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
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
      <Row gutter={12} style={{ marginBottom: 16 }} align="middle">
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
            style={{ width: 160 }}
            value={filters.classRoomId}
            onChange={handleClassRoomChange}
            disabled={!filters.majorId}
            options={classRoomOptions.map(c => ({ value: c.id, label: c.name }))}
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
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={editingStudent ? [] : [{ required: true, min: 2, message: '请输入用户名' }]}>
            <Input disabled={!!editingStudent} placeholder="用户名用于登录" />
          </Form.Item>
          {!editingStudent && (
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少6位' }]}>
              <Input.Password placeholder="设置登录密码" />
            </Form.Item>
          )}
          <Form.Item name="studentId" label="学号" rules={[{ required: true, message: '请输入学号' }]}>
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
          <Form.Item name="phoneNumber" label="手机号">
            <Input placeholder="手机号码" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
            <Input placeholder="电子邮箱" />
          </Form.Item>
          <Form.Item name="departmentId" label="院系">
            <Select
              placeholder="选择院系"
              allowClear
              onChange={handleFormDeptChange}
              options={departments.map(d => ({ value: d.id, label: d.name }))}
            />
          </Form.Item>
          <Form.Item name="majorId" label="专业">
            <Select
              placeholder="选择专业"
              allowClear
              onChange={handleFormMajorChange}
              disabled={formMajors.length === 0}
              options={formMajors.map(m => ({ value: m.id, label: m.name }))}
            />
          </Form.Item>
          <Form.Item name="classRoomId" label="班级">
            <Select
              placeholder="选择班级"
              allowClear
              disabled={formClassRooms.length === 0}
              options={formClassRooms.map(c => ({ value: c.id, label: c.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
