import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Table, Tag, Card, Statistic, Row, Col, Spin, message, Badge } from 'antd';
import { UserOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import api from '../../services/api';
import { createAuthedSocket } from '../../config/socket-url';

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

  // ===== 事件节流缓冲区 =====
  // 3000 人考场下 monitor:update 心跳约 300 次/秒。若每事件都 setLiveStudents（整张 Map 重建）
  // 并触发整表重渲染，教师浏览器会直接冻结。因此把事件先按「学生 → 最新补丁」合并进 ref 缓冲区，
  // 由定时器在固定窗口结束时一次性 flush，把渲染频率压到约 1 次/秒。
  // 窗口内同一学生的多次事件做字段级合并（后到字段覆盖先到字段），最终状态仍以最新事件为准。
  const pendingLivePatchesRef = useRef<Map<string, Partial<LiveStudent> & { studentId: string }>>(new Map());
  // 交卷事件单独缓冲：flush 时只对 submissions 数组做该学生的行级局部更新，不整表重拉
  const pendingSubmitsRef = useRef<Map<string, { submittedAt: string }>>(new Map());
  const flushTimerRef = useRef<number | null>(null);

  // 节流窗口：1000ms。监控页对心跳数据（当前题号/切屏次数）的秒级延迟不敏感，
  // 1s 窗口能把 300 次/秒的事件流压成最多 1 次/秒的 setState；
  // 窗口结束由定时器保证必然 flush，不存在「事件到了但状态永远不更新」的问题。
  const FLUSH_INTERVAL_MS = 1000;

  const flushBufferedEvents = () => {
    // 先「摘走」旧缓冲区再 setState：flush 期间新到事件写入新缓冲区，不会遗漏
    const livePatches = pendingLivePatchesRef.current;
    const submits = pendingSubmitsRef.current;
    pendingLivePatchesRef.current = new Map();
    pendingSubmitsRef.current = new Map();

    if (livePatches.size > 0) {
      setLiveStudents(prev => {
        const next = new Map(prev);
        livePatches.forEach((patch, studentId) => {
          const existing = next.get(studentId) || {
            studentId, studentName: '', currentQuestion: 0, tabSwitchCount: 0, lastHeartbeat: '', online: true,
          };
          next.set(studentId, { ...existing, ...patch });
        });
        return next;
      });
    }
    if (submits.size > 0) {
      // 交卷只做行级局部更新：不再为每个 monitor:submit 全量拉取 3000 行列表。
      // 交卷风暴时若不取消，会对服务端发起数百次全量查询（每行还带 _count.details 子查询）。
      setSubmissions(prev => prev.map(sub => {
        const submitted = submits.get(sub.studentId);
        return submitted ? { ...sub, status: 'submitted', submittedAt: submitted.submittedAt } : sub;
      }));
    }
  };

  const scheduleFlush = () => {
    // 已有定时器说明当前窗口尚未结束，继续累积即可
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushBufferedEvents();
    }, FLUSH_INTERVAL_MS);
  };

  // 把一条学生状态补丁合并进缓冲区（同窗口内同一学生的多次事件合并为最新字段集合）
  const enqueueLivePatch = (patch: Partial<LiveStudent> & { studentId: string }) => {
    const current = pendingLivePatchesRef.current.get(patch.studentId);
    pendingLivePatchesRef.current.set(patch.studentId, { ...(current || {}), ...patch });
    scheduleFlush();
  };

  const fetchData = async () => {
    try {
      const res = await api.get(`/exams/${id}/submissions`);
      setSubmissions(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  // Socket.IO connection
  useEffect(() => {
    const socket = createAuthedSocket({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('monitor:join', { examId: id });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    // Receive initial student list（连接时的一次性全量快照，直接整体替换）
    socket.on('monitor:students', (students: LiveStudent[]) => {
      const map = new Map<string, LiveStudent>();
      students.forEach(s => map.set(s.studentId, s));
      setLiveStudents(map);
    });

    // Student joined：考试开始时数千人集中上线，同样走缓冲区合并，避免上线风暴
    socket.on('monitor:join', (data: { studentId: string; studentName: string }) => {
      enqueueLivePatch({
        studentId: data.studentId,
        studentName: data.studentName,
        currentQuestion: 0,
        tabSwitchCount: 0,
        lastHeartbeat: new Date().toISOString(),
        online: true,
      });
    });

    // Student heartbeat update（高频：3000 人 × 1 次/10s ≈ 300 次/秒）→ 进缓冲区合并
    socket.on('monitor:update', (data: Partial<LiveStudent> & { studentId: string }) => {
      enqueueLivePatch(data);
    });

    // Student submitted：只更新该行状态（liveStudents + submissions 行级局部更新），
    // 不再触发全量列表重拉；提交状态与评分进度的最终一致性由 30s 轮询兜底。
    socket.on('monitor:submit', (data: { studentId: string; studentName: string; submittedAt: string }) => {
      enqueueLivePatch({
        studentId: data.studentId,
        studentName: data.studentName,
        submittedAt: data.submittedAt,
        status: 'submitted',
        online: true,
      });
      pendingSubmitsRef.current.set(data.studentId, { submittedAt: data.submittedAt });
      scheduleFlush();
    });

    return () => {
      // 组件卸载时清掉 flush 定时器即可：组件已不存在，缓冲区数据无需再 flush
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      socket.disconnect();
    };
  }, [id]);

  // Fallback polling every 30s。15s → 30s 的理由：事件驱动（节流合并后）已是状态更新的主路径，
  // 轮询只作一致性兜底（补齐遗漏事件、刷新评分进度），放宽间隔可把 3000 行全量查询
  // （含 _count.details 子查询）对服务端的压力减半。
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  const counts = {
    total: submissions.length,
    inProgress: submissions.filter((s: any) => s.status === 'in_progress').length,
    submitted: submissions.filter((s: any) => s.status === 'submitted').length,
    graded: submissions.filter((s: any) => s.status === 'graded').length,
  };

  // Merge live data with submission data（liveStudents 变化频率已被节流，此处 3000 行映射开销可控）
  const tableData = useMemo(
    () => submissions.map((sub: any) => {
      const live = liveStudents.get(sub.studentId);
      return {
        ...sub,
        liveCurrentQuestion: live?.currentQuestion,
        liveTabSwitches: live?.tabSwitchCount,
        liveOnline: live?.online,
        liveLastHeartbeat: live?.lastHeartbeat,
      };
    }),
    [submissions, liveStudents],
  );

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
          // 分页替代 pagination={false}：3000 行只渲染当前页（默认 20 行），
          // 避免 3000 行 DOM 一次性进文档导致渲染冻结；列定义与数据合并逻辑不变
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total: number) => `共 ${total} 名考生`,
          }}
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
