import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Tag, message,
  Card, Popconfirm, Typography, Row, Col, Statistic, Descriptions, Empty,
  List, Avatar, Tooltip, Upload
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined,
  UploadOutlined, UserOutlined,
  DownloadOutlined, ImportOutlined
} from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text } = Typography;

// ✅ 考场状态配置
const roomStatusConfig = {
  available: { color: 'success', text: '可用' },
  maintenance: { color: 'error', text: '维护中' },
};

interface ExamRoom {
  id: string;
  code: string;
  name: string;
  capacity: number;
  location?: string;
  equipment: any[];
  status: 'available' | 'maintenance';
  createdAt: string;
  updatedAt: string;
  conflicts?: Array<{
    examId: string;
    examTitle: string;
    startTime: string;
    endTime: string;
  }>;
  assignments?: Array<{
    id: string;
    exam: { id: string; title: string; startTime: string; endTime: string };
    status: string;
  }>;
  invigilators: Array<{ id: string; realName: string; username: string }>;
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

export function RoomManager() {
  const [rooms, setRooms] = useState<ExamRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [bulkImportModalOpen, setBulkImportModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<ExamRoom | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<ExamRoom | null>(null);
  const [form] = Form.useForm();
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  // 加载考场列表
  const fetchRooms = async (page = 1, pageSize = 20) => {
    setLoading(true);
    try {
      const params: any = { page, pageSize };

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
  }, []);

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
          <Text strong>{record._count?.students ?? 0}</Text> / {record.capacity}
          {(record._count?.students ?? 0) >= record.capacity && (
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
            }).catch(async (err: any) => {
              let msg = '模板下载失败';
              try {
                if (err.response?.data instanceof Blob) {
                  const text = await err.response.data.text();
                  msg = JSON.parse(text).message || msg;
                } else if (err.response?.data?.message) {
                  msg = err.response.data.message;
                }
              } catch {}
              message.error(msg);
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
              title="总座位数"
              value={rooms.reduce((sum, r) => sum + r.capacity, 0)}
              valueStyle={{ color: '#1677ff' }}
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
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
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
              <Descriptions.Item label="关联考试">
                {selectedRoom.assignments && selectedRoom.assignments.length > 0 ? (
                  <Space wrap>
                    {selectedRoom.assignments.map(a => (
                      <Tag key={a.id} color="blue">{a.exam.title}</Tag>
                    ))}
                  </Space>
                ) : (
                  <Text type="secondary">未关联考试</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={roomStatusConfig[selectedRoom.status].color}>
                  {roomStatusConfig[selectedRoom.status].text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="容纳人数">{selectedRoom.capacity} 人</Descriptions.Item>
              <Descriptions.Item label="已分配学生">{selectedRoom._count?.students ?? 0} 人</Descriptions.Item>
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

            <Title level={5}>已分配学生 ({selectedRoom._count?.students ?? 0}/{selectedRoom.capacity})</Title>
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
