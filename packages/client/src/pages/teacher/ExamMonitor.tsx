import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Table, Tag, Card, Statistic, Row, Col, Spin, message, Badge } from 'antd';
import { UserOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import api from '../../services/api';

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'processing', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
};

interface LiveStudent {
  studentId: string;
  studentName: string;
  currentQuestion: number;
  tabSwitchCount: number;
  lastHeartbeat: string;
  online: boolean;
  status?: string;
  startedAt?: string;
  submittedAt?: string;
  totalScore?: number | null;
}

export function ExamMonitor() {
  const { id } = useParams<{ id: string }>();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [liveStudents, setLiveStudents] = useState<Map<string, LiveStudent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const fetchData = async () => {
    try {
      const res = await api.get(`/exams/${id}/submissions`);
      setSubmissions(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  // Socket.IO connection
  useEffect(() => {
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('monitor:join', { examId: id });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    // Receive initial student list
    socket.on('monitor:students', (students: LiveStudent[]) => {
      const map = new Map<string, LiveStudent>();
      students.forEach(s => map.set(s.studentId, s));
      setLiveStudents(map);
    });

    // Student joined
    socket.on('monitor:join', (data: { studentId: string; studentName: string }) => {
      setLiveStudents(prev => {
        const next = new Map(prev);
        next.set(data.studentId, {
          ...data,
          currentQuestion: 0,
          tabSwitchCount: 0,
          lastHeartbeat: new Date().toISOString(),
          online: true,
        });
        return next;
      });
    });

    // Student heartbeat update
    socket.on('monitor:update', (data: Partial<LiveStudent> & { studentId: string }) => {
      setLiveStudents(prev => {
        const next = new Map(prev);
        const existing = next.get(data.studentId) || { studentId: data.studentId, studentName: '', currentQuestion: 0, tabSwitchCount: 0, lastHeartbeat: '', online: true };
        next.set(data.studentId, { ...existing, ...data });
        return next;
      });
    });

    // Student submitted
    socket.on('monitor:submit', (data: { studentId: string; studentName: string; submittedAt: string }) => {
      setLiveStudents(prev => {
        const next = new Map(prev);
        const existing = next.get(data.studentId);
        if (existing) {
          next.set(data.studentId, { ...existing, ...data, online: true });
        }
        return next;
      });
      // Also refresh submission data
      fetchData();
    });

    return () => { socket.disconnect(); };
  }, [id]);

  // Fallback polling every 15s
  useEffect(() => { fetchData(); const interval = setInterval(fetchData, 15000); return () => clearInterval(interval); }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  const counts = {
    total: submissions.length,
    inProgress: submissions.filter((s: any) => s.status === 'in_progress').length,
    submitted: submissions.filter((s: any) => s.status === 'submitted').length,
    graded: submissions.filter((s: any) => s.status === 'graded').length,
  };

  // Merge live data with submission data
  const tableData = submissions.map((sub: any) => {
    const live = liveStudents.get(sub.studentId);
    return {
      ...sub,
      liveCurrentQuestion: live?.currentQuestion,
      liveTabSwitches: live?.tabSwitchCount,
      liveOnline: live?.online,
      liveLastHeartbeat: live?.lastHeartbeat,
    };
  });

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>考场监控</h2>
        <Badge
          status={connected ? 'success' : 'error'}
          text={connected ? 'WebSocket 已连接' : 'WebSocket 断开'}
        />
      </div>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}><Card><Statistic title="总考生" value={counts.total} prefix={<UserOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="答题中" value={counts.inProgress} valueStyle={{ color: '#1890ff' }} prefix={<ClockCircleOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="已提交" value={counts.submitted} valueStyle={{ color: '#faad14' }} prefix={<CheckCircleOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="已评分" value={counts.graded} valueStyle={{ color: '#52c41a' }} /></Card></Col>
      </Row>

      <Card title="考生状态（实时更新）">
        <Table
          dataSource={tableData}
          rowKey="id"
          pagination={false}
          columns={[
            {
              title: '学生', key: 'student',
              render: (_: any, r: any) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge status={r.liveOnline ? 'success' : 'default'} />
                  {r.student?.realName || r.student?.username || '—'}
                </div>
              ),
            },
            {
              title: '状态', dataIndex: 'status', key: 'status',
              render: (v: string) => { const s = statusMap[v] || { color: 'default', text: v }; return <Tag color={s.color}>{s.text}</Tag>; },
            },
            {
              title: '当前题目', key: 'currentQuestion',
              render: (_: any, r: any) => r.liveCurrentQuestion !== undefined ? `第 ${r.liveCurrentQuestion + 1} 题` : '—',
            },
            {
              title: '切屏次数', key: 'tabSwitches',
              render: (_: any, r: any) => {
                const count = r.liveTabSwitches || 0;
                return count > 0
                  ? <Tag color="warning" icon={<WarningOutlined />}>{count} 次</Tag>
                  : <Tag color="default">0</Tag>;
              },
            },
            { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
            { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
            { title: '得分', dataIndex: 'totalScore', key: 'totalScore', render: (v: number | null) => v !== null ? v : '—' },
          ]}
        />
      </Card>
    </div>
  );
}
