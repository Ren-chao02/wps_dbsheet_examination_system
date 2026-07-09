import { useEffect, useState } from 'react';
import { Table, Button, Space, Input, Select, message } from 'antd';
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { WizardExam } from './index';

interface Room {
  id: string;           // assignment id
  roomId: string;       // physical room id
  room: {               // physical room info
    id: string;
    code: string;
    name: string;
    capacity: number;
  };
  status: string;
  students: Array<{
    studentId: string;
    seatNumber: number;
    student: { id: string; realName: string | null; studentId?: string };
  }>;
  invigilators: Array<{ id: string; realName: string }>;
}

interface Student {
  id: string;
  username: string;
  realName: string | null;
  studentId: string | null;
  gender: string | null;
  phoneNumber: string | null;
  email: string | null;
  department?: { id: string; name: string; code: string } | null;
  major?: { id: string; name: string; code: string } | null;
  classRoom?: { id: string; name: string; code: string } | null;
}

interface StudentAssignStepProps {
  exam: WizardExam;
  onSaved: () => void;
  onBack: () => void;
}

export function StudentAssignStep({ exam, onSaved, onBack }: StudentAssignStepProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [assignedMap, setAssignedMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<string | undefined>();
  const [searchName, setSearchName] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/exam-room-assignments/exams/${exam.id}/rooms`),
      api.get('/students?pageSize=500'),
    ])
      .then(([roomRes, studentRes]) => {
        const roomList = roomRes.data?.data || [];
        setRooms(roomList);
        if (roomList.length > 0) setSelectedRoom(roomList[0].roomId);
        setStudents(studentRes.data?.data || []);
      })
      .catch(() => message.error('加载数据失败'))
      .finally(() => setLoading(false));
  }, [exam.id]);

  useEffect(() => {
    if (!selectedRoom) return;
    const room = rooms.find(r => r.roomId === selectedRoom);
    if (room) {
      const assigned = (room.students || []).map(s => s.student.id);
      setAssignedMap(prev => ({ ...prev, [selectedRoom]: assigned }));
    }
  }, [selectedRoom, rooms]);

  const handleAssign = async (studentId: string) => {
    if (!selectedRoom) return;
    try {
      await api.post(`/exam-room-assignments/exams/${exam.id}/rooms/${selectedRoom}/students/batch-assign`, { studentIds: [studentId] });
      message.success('分配成功');
      setAssignedMap(prev => ({
        ...prev,
        [selectedRoom]: [...(prev[selectedRoom] || []), studentId],
      }));
    } catch (err: any) {
      message.error(err.response?.data?.message || '分配失败');
    }
  };

  const handleRemove = async (studentId: string) => {
    if (!selectedRoom) return;
    try {
      await api.delete(`/exam-room-assignments/exams/${exam.id}/rooms/${selectedRoom}/students/${studentId}`);
      message.success('移除成功');
      setAssignedMap(prev => ({
        ...prev,
        [selectedRoom]: (prev[selectedRoom] || []).filter(id => id !== studentId),
      }));
    } catch (err: any) {
      message.error(err.response?.data?.message || '移除失败');
    }
  };

  const filteredStudents = students.filter(s =>
    !searchName ||
    (s.realName && s.realName.includes(searchName)) ||
    (s.studentId && s.studentId.includes(searchName)) ||
    s.username.includes(searchName)
  );

  const columns = [
    { title: '姓名', dataIndex: 'realName', render: (v: string | null) => v || '-' },
    { title: '学号', dataIndex: 'studentId', render: (v: string | null) => v || '-' },
    { title: '所属班级', render: (_: any, s: Student) => s.classRoom?.name || '-' },
    {
      title: '操作',
      render: (_: any, s: Student) => {
        const isAssigned = (assignedMap[selectedRoom || ''] || []).includes(s.id);
        return isAssigned ? (
          <Button size="small" danger onClick={() => handleRemove(s.id)}>移除</Button>
        ) : (
          <Button size="small" type="primary" onClick={() => handleAssign(s.id)}>添加</Button>
        );
      },
    },
  ];

  const handleNext = () => {
    onSaved();
  };

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="选择考场"
          value={selectedRoom}
          onChange={setSelectedRoom}
          style={{ width: 200 }}
          options={rooms.map(r => ({ value: r.roomId, label: `${r.room.code} - ${r.room.name}` }))}
        />
        <Input placeholder="搜索学生姓名/学号" value={searchName} onChange={e => setSearchName(e.target.value)} />
      </Space>
      <Table
        rowKey="id"
        dataSource={filteredStudents}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 8 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>上一步</Button>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext}>
          下一步
        </Button>
      </div>
    </div>
  );
}
