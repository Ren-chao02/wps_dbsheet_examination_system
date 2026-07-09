import { useEffect, useState } from 'react';
import { Table, Button, Space, Input, message, Select, Popconfirm } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { WizardExam } from './index';

interface AvailableRoom {
  id: string;
  code: string;
  name: string;
  capacity: number;
  conflicts?: any[];
}

interface AssignedRoomInfo {
  id: string;
  examId: string;
  roomId: string;
  room: {
    id: string;
    code: string;
    name: string;
    capacity: number;
  };
  invigilators: { id: string; realName: string }[];
}

interface RoomInvigilationStepProps {
  exam: WizardExam;
  onSaved: () => void;
  onBack: () => void;
}

export function RoomInvigilationStep({ exam, onSaved, onBack }: RoomInvigilationStepProps) {
  const [availableRooms, setAvailableRooms] = useState<AvailableRoom[]>([]);
  const [assignedRooms, setAssignedRooms] = useState<AssignedRoomInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [teachers, setTeachers] = useState<any[]>([]);

  const fetchAvailableRooms = async () => {
    try {
      const res = await api.get('/rooms', { params: { availableForExam: exam.id, pageSize: 100 } });
      setAvailableRooms(res.data?.data || []);
    } catch {
      message.error('加载可用考场失败');
    }
  };

  const fetchAssignedRooms = async () => {
    try {
      const res = await api.get(`/exam-room-assignments/exams/${exam.id}/rooms`);
      setAssignedRooms(res.data?.data || []);
    } catch {
      message.error('加载已分配考场失败');
    }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchAvailableRooms(),
      fetchAssignedRooms(),
      api.get('/users?role=teacher&pageSize=500')
        .then(res => setTeachers(res.data?.data || []))
        .catch(() => message.error('加载教师列表失败')),
    ]).finally(() => setLoading(false));
  }, [exam.id]);

  const handleAssignRoom = async (roomId: string) => {
    try {
      await api.post(`/exam-room-assignments/exams/${exam.id}/rooms`, { roomId });
      message.success('考场分配成功');
      fetchAvailableRooms();
      fetchAssignedRooms();
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  const handleRemoveRoom = async (roomId: string) => {
    try {
      await api.delete(`/exam-room-assignments/exams/${exam.id}/rooms/${roomId}`);
      message.success('取消分配成功');
      fetchAvailableRooms();
      fetchAssignedRooms();
    } catch (err: any) {
      message.error(err.response?.data?.message || '取消分配失败');
    }
  };

  const handleAssignInvigilator = async (roomId: string, userId: string) => {
    try {
      await api.post(`/exam-room-assignments/exams/${exam.id}/rooms/${roomId}/invigilators/${userId}`);
      message.success('监考老师分配成功');
      fetchAssignedRooms();
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  const handleRemoveInvigilator = async (roomId: string, userId: string) => {
    try {
      await api.delete(`/exam-room-assignments/exams/${exam.id}/rooms/${roomId}/invigilators/${userId}`);
      fetchAssignedRooms();
    } catch (err: any) {
      message.error(err.response?.data?.message || '移除失败');
    }
  };

  const assignedRoomIds = new Set(assignedRooms.map(r => r.roomId));
  const unassignedAvailableRooms = availableRooms.filter(
    r => !assignedRoomIds.has(r.id) && (!r.conflicts || r.conflicts.length === 0)
  );

  const filteredAssignedRooms = assignedRooms.filter(r =>
    !keyword || r.room.name.includes(keyword) || r.room.code.includes(keyword)
  );

  const columns = [
    { title: '考场名称', dataIndex: ['room', 'name'] },
    { title: '考场编码', dataIndex: ['room', 'code'] },
    { title: '容量', dataIndex: ['room', 'capacity'] },
    {
      title: '监考老师',
      key: 'invigilators',
      render: (_: any, record: AssignedRoomInfo) => (
        <Space wrap>
          {record.invigilators?.map(i => (
            <span key={i.id}>
              {i.realName}
              <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleRemoveInvigilator(record.roomId, i.id)} />
            </span>
          ))}
          <Select
            placeholder="分配监考"
            style={{ width: 120 }}
            value={undefined}
            onChange={(tid) => tid && handleAssignInvigilator(record.roomId, tid)}
            options={teachers
              .filter(t => !record.invigilators?.some(inv => inv.id === t.id))
              .map(t => ({ value: t.id, label: t.realName || t.username }))}
          />
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: AssignedRoomInfo) => (
        <Popconfirm title="确定取消分配该考场？" onConfirm={() => handleRemoveRoom(record.roomId)}>
          <Button type="link" danger>取消分配</Button>
        </Popconfirm>
      ),
    },
  ];

  const handleNext = () => {
    if (assignedRooms.length === 0) {
      message.warning('请至少分配一个考场');
      return;
    }
    onSaved();
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Input placeholder="考场名称/编码" value={keyword} onChange={e => setKeyword(e.target.value)} />
      </Space>

      {unassignedAvailableRooms.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h4>可用考场（点击分配）</h4>
          <Space wrap>
            {unassignedAvailableRooms.map(room => (
              <Button
                key={room.id}
                icon={<PlusOutlined />}
                onClick={() => handleAssignRoom(room.id)}
              >
                {room.name}（{room.code}）
              </Button>
            ))}
          </Space>
        </div>
      )}

      <h4>已分配考场</h4>
      <Table
        rowKey="id"
        dataSource={filteredAssignedRooms}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 5 }}
      />

      {unassignedAvailableRooms.length === 0 && assignedRooms.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 32, color: '#999' }}>
          暂无可用考场，请先在「考场管理」页面添加考场
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext}>
          下一步
        </Button>
      </div>
    </div>
  );
}
