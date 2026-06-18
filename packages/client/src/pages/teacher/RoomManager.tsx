import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Select, Tag, message,
  Card, Popconfirm, Typography, Row, Col, Statistic, Descriptions, Empty,
  Transfer, List, Avatar, Tooltip, Upload
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  UploadOutlined, UserOutlined, TeamOutlined, ExportOutlined,
  DownloadOutlined, ImportOutlined
} from '@ant-design/icons';
import type { TransferItem } from 'antd/es/transfer';
import type { Key } from 'react';
import api from '../../services/api';

const { Title, Text } = Typography;

// ✅ 考场状态配置
const roomStatusConfig = {
  available: { color: 'success', text: '可用' },
  occupied: { color: 'processing', text: '使用中' },
  maintenance: { color: 'error', text: '维护中' },
};

interface ExamRoom {
  id: string;
  code: string;
  name: string;
  capacity: number;
  location?: string;
  equipment: any[];
  status: 'available' | 'occupied' | 'maintenance';
  examId: string;
  createdAt: string;
  updatedAt: string;
  exam: { id: string; title: string };
  invigilators: Array<{ id: string; realName: string | null; username: string; email?: string }>;
  _count: { students: number };
  students?: Array<{
    studentId: string;
    seatNumber: number;
    student: {
      id: string;
      realName: string | null;
      username: string;
      studentId?: string;
      classRoom?: { name: string; code: string };
    };
  }>;
}

interface StudentOption {
  key: string;
  title: string;
  realName: string;
  studentId?: string;
}

export function RoomManager() {
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [bulkImportModalOpen, setBulkImportModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<ExamRoom | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<ExamRoom | null>(null);
  const [form] = Form.useForm();
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [examIdFilter, setExamIdFilter] = useState<string>();
  const [studentOptions, setStudentOptions] = useState<StudentOption[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [examOptions, setExamOptions] = useState<Array<{ id: string; title: string }>>([]);

  // 加载考试选项（用于新增考场时选择所属考试）
  const fetchExams = async () => {
    try {
      const res = await api.get('/exams', { params: { pageSize: 200 } });
      setExamOptions(res.data?.data || []);
    } catch (err) {
      console.error('加载考试列表失败:', err);
    }
  };

  useEffect(() => {
    fetchExams();
  }, []);

  // 加载考场列表
  const fetchRooms = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };
      if (examIdFilter) params.examId = examIdFilter;

      const res = await api.get('/rooms', { params });
      setRooms(res.data.data || []);
      setPagination({ current: res.data.page, pageSize: res.data.pageSize, total: res.data.total });
    } catch (err) {
      console.error('加载考场列表失败:', err);
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
  }, [examIdFilter]);

  // 加载可选学生列表（用于批量分配）
  const fetchStudents = async () => {
    try {
      const res = await api.get('/users', { params: { role: 'student', pageSize: 200 } });
      const students = (res.data?.data || []).map((s: any) => ({
        key: s.id,
        title: `${s.realName || s.username}${s.studentId ? ` (${s.studentId})` : ''}`,
        realName: s.realName || s.username,
        studentId: s.studentId,
      }));
      setStudentOptions(students);
    } catch (err) {
      console.error('加载学生列表失败:', err);
    }
  };

  // 创建新考场
  const handleCreate = () => {
    setEditingRoom(null);
    form.resetFields();
    form.setFieldsValue({ capacity: 50 });
    setModalOpen(true);
  };

  // 编辑考场
  const handleEdit = (room: ExamRoom) => {
    setEditingRoom(room);
    form.setFieldsValue({
      code: room.code,
      name: room.name,
      capacity: room.capacity,
      location: room.location,
    });
    setModalOpen(true);
  };

  // 查看详情
  const handleViewDetail = async (room: ExamRoom) => {
    try {
      const res = await api.get(`/rooms/${room.id}`);
      setSelectedRoom(res.data);
      setDetailModalOpen(true);
    } catch (err) {
      message.error('加载详情失败');
    }
  };

  // 打开分配学生弹窗
  const handleAssignStudents = (room: ExamRoom) => {
    setSelectedRoom(room);
    setSelectedStudents([]);
    fetchStudents(); // 加载可分配的学生列表
    setAssignModalOpen(true);
  };

  // 保存考场（创建或更新）
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingRoom) {
        await api.put(`/rooms/${editingRoom.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/rooms', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchRooms(pagination.current, pagination.pageSize);
    } catch (err: any) {
      if (err.response?.data?.message) {
        message.error(err.response.data.message);
      }
    }
  };

  // 删除考场
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/rooms/${id}`);
      message.success('删除成功');
      fetchRooms(pagination.current, pagination.pageSize);
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  // 批量分配学生到考场
  const handleBatchAssign = async () => {
    if (!selectedRoom || selectedStudents.length === 0) return;

    try {
      const res = await api.post(`/rooms/${selectedRoom.id}/students/batch-assign`, {
        studentIds: selectedStudents,
      });

      message.success(res.data.message || `成功分配 ${selectedStudents.length} 名学生`);
      setAssignModalOpen(false);

      // 刷新详情
      if (selectedRoom) {
        const detailRes = await api.get(`/rooms/${selectedRoom.id}`);
        setSelectedRoom(detailRes.data);
      }

      fetchRooms(pagination.current, pagination.pageSize);
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  // 批量导入考场
  const handleBulkImport = async (values: any) => {
    try {
      // 这里需要解析上传的文件并转换为JSON格式
      // 实际项目中可以使用xlsx库解析Excel文件
      message.info('批量导入功能开发中...');
      setBulkImportModalOpen(false);
    } catch (err) {
      message.error('导入失败');
    }
  };

  const columns = [
    {
      title: '考场编码',
      dataIndex: 'code',
      key: 'code',
      width: 100,
      render: (text: string) => <strong>{text}</strong>,
    },
    {
      title: '考场名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '所属考试',
      key: 'exam',
      render: (_: any, record: ExamRoom) => (
        <Tag color="blue">{record.exam.title}</Tag>
      ),
    },
    {
      title: '容量',
      dataIndex: 'capacity',
      key: 'capacity',
      width: 80,
      render: (v: number) => `${v}人`,
    },
    {
      title: '已分配',
      key: 'assigned',
      width: 80,
      render: (_: any, record: ExamRoom) => (
        <span>
          <Text strong>{record._count.students}</Text> / {record.capacity}
          {record._count.students >= record.capacity && (
            <Tag color="error" style={{ marginLeft: 4 }}>满</Tag>
          )}
        </span>
      ),
    },
    {
      title: '位置',
      dataIndex: 'location',
      key: 'location',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: keyof typeof roomStatusConfig) => {
        const config = roomStatusConfig[status];
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '监考老师',
      key: 'invigilators',
      width: 120,
      render: (_: any, record: ExamRoom) => (
        <Tooltip title={record.invigilators.map(i => i.realName || i.username).join(', ')}>
          <Space size={2}>
            <UserOutlined />
            <Text>{record.invigilators.length}人</Text>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 300,
      render: (_: any, record: ExamRoom) => (
        <Space size="small" wrap>
          <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewDetail(record)}>
            详情
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Button
            size="small"
            icon={<TeamOutlined />}
            onClick={() => handleAssignStudents(record)}
            disabled={record._count.students >= record.capacity}
          >
            分配学生
          </Button>
          <Popconfirm
            title="确定删除该考场？"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container" style={{ maxWidth: 1400 }}>
      {/* 页面标题和操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>考场管理</Title>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => setBulkImportModalOpen(true)}>
            批量导入
          </Button>
          <Button icon={<DownloadOutlined />} onClick={() => {
            api.get('/rooms/export-template').then((res: any) => {
              // 下载模板逻辑
              const data = JSON.stringify(res.data.template, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'room-import-template.json';
              a.click();
              URL.revokeObjectURL(url);
            });
          }}>
            导出模板
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增考场
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="总考场数" value={pagination.total} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="可用"
              value={rooms.filter(r => r.status === 'available').length}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="使用中"
              value={rooms.filter(r => r.status === 'occupied').length}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="总座位数"
              value={rooms.reduce((sum, r) => sum + r.capacity, 0)}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 考场列表表格 */}
      <Table
        columns={columns}
        dataSource={rooms}
        rowKey="id"
        loading={loading}
        pagination={{
          ...pagination,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => fetchRooms(page, pageSize),
        }}
        scroll={{ x: 1400 }}
      />

      {/* 创建/编辑考场 Modal */}
      <Modal
        title={editingRoom ? '编辑考场' : '新增考场'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingRoom && (
            <Form.Item name="examId" label="所属考试" rules={[{ required: true, message: '请选择考试' }]}>
              <Select placeholder="选择该考场所属的考试" showSearch optionFilterProp="children">
                {examOptions.map(exam => (
                  <Select.Option key={exam.id} value={exam.id}>{exam.title}</Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label="考场编码" rules={[{ required: true, message: '请输入编码' }]}>
                <Input placeholder="如：A101、B203" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label="考场名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder="如：第一机房、第二实验室" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="capacity" label="容纳人数" rules={[{ required: true }]}>
                <InputNumber min={1} max={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="location" label="物理位置">
                <Input placeholder="如：教学楼A座1楼" />
              </Form.Item>
            </Col>
          </Row>

          <div style={{ padding: '12px', background: '#f5f5f5', borderRadius: 4 }}>
            <Text type="secondary">
              提示：考场编码必须唯一，建议使用楼层+房间号格式（如A101表示A栋1楼01室）。
            </Text>
          </div>
        </Form>
      </Modal>

      {/* 考场详情 Modal */}
      <Modal
        title={`考场详情 - ${selectedRoom?.name} (${selectedRoom?.code})`}
        open={detailModalOpen}
        onCancel={() => setDetailModalOpen(false)}
        footer={null}
        width={900}
      >
        {selectedRoom && (
          <>
            <Descriptions bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="考场编码">{selectedRoom.code}</Descriptions.Item>
              <Descriptions.Item label="考场名称">{selectedRoom.name}</Descriptions.Item>
              <Descriptions.Item label="所属考试">
                <Tag color="blue">{selectedRoom.exam.title}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={roomStatusConfig[selectedRoom.status].color}>
                  {roomStatusConfig[selectedRoom.status].text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="容纳人数">{selectedRoom.capacity} 人</Descriptions.Item>
              <Descriptions.Item label="已分配学生">{selectedRoom._count.students} 人</Descriptions.Item>
              <Descriptions.Item label="位置" span={2}>{selectedRoom.location || '-'}</Descriptions.Item>
              <Descriptions.Item label="监考老师" span={2}>
                {selectedRoom.invigilators.length > 0 ? (
                  <Space wrap>
                    {selectedRoom.invigilators.map(inv => (
                      <Tag key={inv.id} icon={<UserOutlined />}>
                        {inv.realName || inv.username}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">未分配监考老师</Text>
                )}
              </Descriptions.Item>
            </Descriptions>

            <Title level={5}>已分配学生 ({selectedRoom._count.students}/{selectedRoom.capacity})</Title>
            {selectedRoom.students && selectedRoom.students.length > 0 ? (
              <List
                grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 4, xxl: 4 }}
                dataSource={selectedRoom.students}
                renderItem={(item: any) => (
                  <List.Item>
                    <Card size="small">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar icon={<UserOutlined />} />
                        <div>
                          <div><strong>{item.student.realName}</strong></div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            座位号: {item.seatNumber} | 学号: {item.student.studentId || '-'}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </List.Item>
                )}
              />
            ) : (
              <Empty description="暂无已分配学生" />
            )}
          </>
        )}
      </Modal>

      {/* 分配学生 Modal */}
      <Modal
        title={`分配学生到 ${selectedRoom?.name} (剩余 ${selectedRoom ? selectedRoom.capacity - selectedRoom._count.students : 0} 个座位)`}
        open={assignModalOpen}
        onOk={handleBatchAssign}
        onCancel={() => setAssignModalOpen(false)}
        width={800}
        okText="确认分配"
        okButtonProps={{ disabled: selectedStudents.length === 0 }}
      >
        <Transfer
          dataSource={studentOptions}
          titles={['可选学生', '已选择']}
          targetKeys={selectedStudents as Key[]}
          onChange={(keys) => setSelectedStudents(keys as string[])}
          render={(item: TransferItem) => item.title as string}
          listStyle={{ width: 350, height: 400 }}
          showSearch
          filterOption={(inputValue, item: any) =>
            item.title.toLowerCase().includes(inputValue.toLowerCase())
          }
        />

        <div style={{ marginTop: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 4 }}>
          <Text type="secondary">
            已选择 <Text strong>{selectedStudents.length}</Text> 名学生，
            剩余 <Text strong>{selectedRoom ? selectedRoom.capacity - selectedRoom._count.students : 0}</Text> 个座位
          </Text>
        </div>
      </Modal>

      {/* 批量导入 Modal */}
      <Modal
        title="批量导入考场"
        open={bulkImportModalOpen}
        onCancel={() => setBulkImportModalOpen(false)}
        footer={null}
        width={700}
      >
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Upload.Dragger
            accept=".xlsx,.xls,.csv"
            maxCount={1}
            beforeUpload={() => false} // 阻止自动上传
          >
            <p className="ant-upload-drag-icon"><UploadOutlined /></p>
            <p className="ant-upload-text">点击或拖拽Excel文件到此区域</p>
            <p className="ant-upload-hint">支持 .xlsx, .xls, .csv 格式</p>
          </Upload.Dragger>

          <div style={{ marginTop: 24 }}>
            <Button type="link" icon={<DownloadOutlined />}>
              下载导入模板
            </Button>
          </div>

          <div style={{ marginTop: 16, padding: '12px', background: '#f5f5f5', borderRadius: 4, textAlign: 'left' }}>
            <Text strong>导入说明：</Text>
            <ul style={{ margin: '8px 0 0 20px', color: '#666', lineHeight: 1.8 }}>
              <li>单次最多导入100个考场</li>
              <li>考场编码必须唯一且不能与已有考场重复</li>
              <li>必须先选择所属考试再导入</li>
              <li>模板格式：考场编码、考场名称、容量、位置描述</li>
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
}
