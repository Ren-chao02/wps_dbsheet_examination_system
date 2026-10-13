import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Table, Tag, Card, Statistic, Row, Col, Spin, message, Badge,
  Button, Space, Tabs, Modal, Drawer, Alert, Progress,
  Tooltip, Typography, Divider, Empty, Switch, InputNumber, Form, Popconfirm, Result
} from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, WarningOutlined,
  ExportOutlined, EyeOutlined, SettingOutlined, HomeOutlined,
  TeamOutlined, DownloadOutlined, ReloadOutlined, ArrowLeftOutlined,
  PercentageOutlined
} from '@ant-design/icons';
import { Socket } from 'socket.io-client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'; // ✅ 导入相对时间插件
import api from '../../services/api';
import * as XLSX from 'xlsx'; // Excel导出库
import { createAuthedSocket } from '../../config/socket-url';
import { StatCard } from '../../components/common/StatCard';

// ✅ 扩展dayjs以支持fromNow方法
dayjs.extend(relativeTime);

const { Title, Text } = Typography;

// ✅ 状态配置（absent：在应参考名单里但从未进入作答——没有提交记录也没有实时状态）
const statusMap: Record<string, { color: string; text: string }> = {
  absent: { color: 'error', text: '缺考' },
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'processing', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
};

// ✅ 行为类型中文标签（与 server BehaviorType 枚举一致；考生动态与时间线共用）
const BEHAVIOR_LABELS: Record<string, { text: string; color: string }> = {
  TAB_SWITCH: { text: '切屏', color: 'orange' },
  COPY_PASTE: { text: '复制粘贴', color: 'orange' },
  WINDOW_BLUR: { text: '窗口失焦', color: 'default' },
  FULLSCREEN_EXIT: { text: '退出全屏', color: 'red' },
  KEYBOARD_SHORTCUT: { text: '可疑快捷键', color: 'red' },
  MOUSE_SUSPICIOUS: { text: '异常鼠标', color: 'volcano' },
  QUESTION_NAVIGATE: { text: '跳转题目', color: 'blue' },
  ANSWER_SUBMIT: { text: '提交答案', color: 'blue' },
  EXAM_START: { text: '开始考试', color: 'green' },
  EXAM_END: { text: '结束考试', color: 'green' },
};

/** 监考动态/时间线里的一条事件 */
interface MonitorEvent {
  key: string;
  studentId: string;
  studentName: string;
  text: string;
  color: string;
  at: string;
}

/** 合并两批事件（按 key 去重、按时间倒序、截断到上限）——动态流同时有轮询与 socket 两个来源 */
function mergeMonitorEvents(prev: MonitorEvent[], incoming: MonitorEvent[], cap = 30): MonitorEvent[] {
  const map = new Map<string, MonitorEvent>();
  [...prev, ...incoming].forEach((e) => map.set(e.key, e));
  return Array.from(map.values())
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, cap);
}

/** 行为日志 → 动态事件 */
function behaviorToEvent(log: any): MonitorEvent {
  const cfg = BEHAVIOR_LABELS[log.behaviorType];
  return {
    key: `b-${log.id}`,
    studentId: log.studentId,
    studentName: log.student?.realName || log.student?.username || log.studentId,
    text: cfg?.text || log.behaviorType,
    color: cfg?.color || 'default',
    at: log.occurredAt,
  };
}

/**
 * 是否触发预警（KPI 统计与「异常预警」列表共用同一判定，避免两处口径漂移）：
 * - 切屏超限：所有状态都算（已交卷学生的违规记录仍要留待复核）
 * - 掉线：只对「答题中」的学生有意义 —— 已交卷/缺考的学生不在线是正常状态，
 *   否则每场考试结束后都会看到一片虚假的"离线预警"
 */
function isAlertStudent(s: LiveStudent, rules: AlertRule): boolean {
  if (!rules.enableAlert) return false;
  if (s.tabSwitchCount > rules.maxTabSwitches) return true;
  return (
    s.status === 'in_progress' &&
    !s.online &&
    dayjs().diff(dayjs(s.lastHeartbeat), 'second') > rules.offlineThreshold
  );
}

// ✅ 预警规则接口
interface AlertRule {
  maxTabSwitches: number;      // 最大切屏次数
  offlineThreshold: number;    // 离线阈值（秒）
  enableAlert: boolean;        // 是否启用预警
}

// ✅ 默认预警规则
const DEFAULT_ALERT_RULES: AlertRule = {
  maxTabSwitches: 3,
  offlineThreshold: 30,
  enableAlert: true,
};

interface LiveStudent {
  studentId: string;
  studentName: string;
  currentQuestion: number;
  tabSwitchCount: number;
  // 应参考名单里的缺考学生没有心跳，此处必须可选
  lastHeartbeat?: string;
  online: boolean;
  status?: string;
  startedAt?: string;
  submittedAt?: string;
  totalScore?: number | null;
  roomId?: string; // ✅ 新增：所属考场ID
  roomCode?: string; // ✅ 新增：考场编码
  roomName?: string; // ✅ 新增：考场名称（应参考名单里有，缺考学生也带着）
  seatNumber?: number; // ✅ 新增：座位号
}

export function EnhancedExamMonitor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [liveStudents, setLiveStudents] = useState<Map<string, LiveStudent>>(new Map());
  const [loading, setLoading] = useState(true);
  // 数据范围外的考试（非创建者/监考/管理员）后端对监控数据统一 403：整页降级为无权限提示
  const [forbidden, setForbidden] = useState(false);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [alertRules, setAlertRules] = useState<AlertRule>(DEFAULT_ALERT_RULES);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<LiveStudent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rooms, setRooms] = useState<any[]>([]); // ✅ 考场列表
  // 应参考名单（考场分配）+ 座位信息：监考名册以此为准，缺考学生没有实时记录，姓名只能从这里来
  const [roomAssignments, setRoomAssignments] = useState<Map<string, { studentName: string; roomId: string; roomCode: string; roomName: string; seatNumber: number }>>(new Map());
  // 右栏「考生动态」：行为日志轮询 + socket 实时事件合并后的最近事件流
  const [recentEvents, setRecentEvents] = useState<MonitorEvent[]>([]);
  // 抽屉「考生时间线」与该考生的干预动作状态
  const [studentTimeline, setStudentTimeline] = useState<MonitorEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'force-submit' | 'resume' | null>(null);
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

  // 节流窗口：1000ms。监控页对心跳数据的秒级延迟不敏感，
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
            studentId, studentName: '', currentQuestion: 0,
            tabSwitchCount: 0, lastHeartbeat: '', online: true
          };
          next.set(studentId, { ...existing, ...patch });
        });
        return next;
      });
    }
    if (submits.size > 0) {
      // 交卷只做行级局部更新：不再为每个 monitor:submit 全量拉取数千行列表。
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

  // ✅ 加载考场与座位分配信息
  useEffect(() => {
    if (id) {
      api.get(`/rooms?availableForExam=${id}&pageSize=100`)
        .then(res => setRooms(res.data?.data || []))
        .catch(err => console.error('加载考场失败:', err));

      api.get(`/exams/${id}/room-assignments`)
        .then(res => {
          const map = new Map();
          (res.data || []).forEach((a: any) => {
            map.set(a.studentId, {
              studentName: a.studentName,
              roomId: a.roomId,
              roomCode: a.roomCode,
              roomName: a.roomName,
              seatNumber: a.seatNumber,
            });
          });
          setRoomAssignments(map);
        })
        .catch(err => console.error('加载考场分配失败:', err));
    }
  }, [id]);

  const fetchData = async () => {
    try {
      const res = await api.get(`/exams/${id}/submissions`);
      setSubmissions(res.data);
    } catch (err: any) {
      // 403 = 该考试不在当前用户管理范围内：整页降级提示，不再反复弹「加载失败」
      if (err?.response?.status === 403) {
        setForbidden(true);
        return;
      }
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Socket.IO 连接（保持原有逻辑）
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

    socket.on('monitor:students', (students: LiveStudent[]) => {
      const map = new Map<string, LiveStudent>();
      students.forEach(s => map.set(s.studentId, s));
      setLiveStudents(map);
    });

    // 学生上线：考试开始时数千人集中上线，同样走缓冲区合并，避免上线风暴
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

    // 心跳更新（高频：3000 人 × 1 次/10s ≈ 300 次/秒）→ 进缓冲区合并
    socket.on('monitor:update', (data: Partial<LiveStudent> & { studentId: string }) => {
      enqueueLivePatch(data);
    });

    // 交卷：只更新该行状态（liveStudents + submissions 行级局部更新），
    // 不再触发全量列表重拉；提交状态与评分进度的最终一致性由 30s 轮询兜底
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
      // 动态流：交卷是低频高价值事件（每人一次），直接插入；
      // 「进入考场」不插入 —— 开考瞬间数千人集中进入会造成更新风暴，且名册状态已能体现
      setRecentEvents((prev) => mergeMonitorEvents(prev, [{
        key: `s-submit-${data.studentId}-${data.submittedAt}`,
        studentId: data.studentId,
        studentName: data.studentName,
        text: '交卷',
        color: 'blue',
        at: data.submittedAt,
      }]));
    });

    socket.on('monitor:fullscreen-exit', (data: { studentId: string; studentName: string; occurredAt: string }) => {
      message.warning(`${data.studentName || data.studentId} 退出全屏`, 3);
      // 瞬时 message 之外还要留痕：教师低头看一眼别处就会错过，动态流里可回看
      setRecentEvents((prev) => mergeMonitorEvents(prev, [{
        key: `s-fullscreen-${data.studentId}-${data.occurredAt}`,
        studentId: data.studentId,
        studentName: data.studentName,
        text: '退出全屏',
        color: 'red',
        at: data.occurredAt,
      }]));
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

  // 兜底轮询（30s）：交卷事件不再触发全量重拉后，submissions 列表需靠轮询补齐
  // 评分进度等数据；该接口返回全部行且每行带 _count.details 子查询，
  // 30s 间隔（较常见 15s 减半）可显著降低对服务端的压力，且丢失事件最多 30s 内自愈
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [id]);

  // ✅ 考生动态：行为日志 30s 轮询（切屏/粘贴/失焦等只有日志里有），socket 事件另行插入
  useEffect(() => {
    if (!id) return;
    const load = () => {
      api.get(`/behaviors?examId=${id}&pageSize=20`)
        .then((res) => {
          const events = (res.data?.data || []).map(behaviorToEvent);
          if (events.length > 0) setRecentEvents((prev) => mergeMonitorEvents(prev, events));
        })
        .catch(() => { /* 动态流拉取失败不打断监考主流程 */ });
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [id]);

  /** 打开考生抽屉：同时拉取该考生的行为时间线 */
  const openStudentDrawer = (record: LiveStudent) => {
    setSelectedStudent(record);
    setDrawerOpen(true);
    setStudentTimeline([]);
    setTimelineLoading(true);
    api.get(`/behaviors?examId=${id}&studentId=${record.studentId}&pageSize=50`)
      .then((res) => {
        const events = (res.data?.data || []).map(behaviorToEvent);
        // 行为日志没有「开始考试/交卷」记录（客户端不上报这两个事件），
        // 用提交记录合成这两个关键节点，保证时间线首尾完整
        const synthesized: MonitorEvent[] = [];
        if (record.startedAt) {
          synthesized.push({ key: 'syn-start', studentId: record.studentId, studentName: record.studentName, text: '开始作答', color: 'green', at: record.startedAt });
        }
        if (record.submittedAt) {
          synthesized.push({ key: 'syn-submit', studentId: record.studentId, studentName: record.studentName, text: '交卷', color: 'blue', at: record.submittedAt });
        }
        setStudentTimeline(
          [...events, ...synthesized].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
        );
      })
      .catch(() => {})
      .finally(() => setTimelineLoading(false));
  };

  /** 强制交卷：让学生立即结束作答（服务端只允许 in_progress → submitted，与学生自交卷同一状态机） */
  const handleForceSubmit = async (studentId: string) => {
    if (!id) return;
    setActionLoading('force-submit');
    try {
      await api.post(`/exams/${id}/submissions/${studentId}/force-submit`);
      message.success('已强制交卷');
      const submittedAt = new Date().toISOString();
      setSelectedStudent((s) => (s && s.studentId === studentId ? { ...s, status: 'submitted', submittedAt } : s));
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '强制交卷失败');
    } finally {
      setActionLoading(null);
    }
  };

  /** 允许续考：把误交/中断的答卷退回作答中（已进入判分的答卷会被服务端拒绝） */
  const handleResume = async (studentId: string) => {
    if (!id) return;
    setActionLoading('resume');
    try {
      await api.post(`/exams/${id}/submissions/${studentId}/resume`);
      message.success('已允许续考，考生可重新进入继续作答');
      setSelectedStudent((s) => (s && s.studentId === studentId ? { ...s, status: 'in_progress', submittedAt: undefined } : s));
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '续考操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  // ✅ 监考名册：应参考名单 × 实时状态 × 提交记录 三源并集。
  // 只看实时状态（旧实现）会漏掉「从未进入作答」的缺考学生——他们既没有 socket 事件
  // 也没有提交记录，却必须出现在监考表里（缺考 = 应参考 - 到考 的口径也依赖完整名册）。
  const submissionsByStudent = useMemo(() => {
    const map = new Map<string, any>();
    submissions.forEach((s: any) => map.set(s.studentId, s));
    return map;
  }, [submissions]);

  const enrichedStudents = useMemo(() => {
    const ids = new Set<string>([
      ...roomAssignments.keys(),
      ...liveStudents.keys(),
      ...submissionsByStudent.keys(),
    ]);
    const roster = Array.from(ids).map((studentId): LiveStudent => {
      const live = liveStudents.get(studentId);
      const sub = submissionsByStudent.get(studentId);
      const room = roomAssignments.get(studentId);
      // 有提交记录以其状态为准；仅实时在线无提交按答题中；两者皆无 = 缺考
      const status = sub?.status ?? live?.status ?? (live ? 'in_progress' : 'absent');
      return {
        studentId,
        studentName:
          live?.studentName || room?.studentName || sub?.student?.realName || sub?.student?.username || studentId,
        currentQuestion: live?.currentQuestion ?? -1, // -1 = 尚未进入作答
        tabSwitchCount: live?.tabSwitchCount ?? 0,
        lastHeartbeat: live?.lastHeartbeat,
        online: live?.online ?? false,
        status,
        startedAt: sub?.startedAt ?? live?.startedAt,
        submittedAt: sub?.submittedAt ?? live?.submittedAt,
        totalScore: sub?.totalScore ?? live?.totalScore,
        roomId: room?.roomId,
        roomCode: room?.roomCode,
        roomName: room?.roomName,
        seatNumber: room?.seatNumber,
      };
    });
    // 按考场 + 座位号排序：实时状态更新不会让行序跳动，考场维度下人工核对座位更容易
    roster.sort(
      (a, b) =>
        (a.roomCode || '').localeCompare(b.roomCode || '') ||
        (a.seatNumber ?? Number.MAX_SAFE_INTEGER) - (b.seatNumber ?? Number.MAX_SAFE_INTEGER),
    );
    return roster;
  }, [liveStudents, roomAssignments, submissionsByStudent]);

  // ✅ 计算统计数据（考场概况的四数：应参考/到考/交卷/缺考 + 在线/答题中/预警）
  const stats = useMemo(() => {
    const assigned = enrichedStudents.length;
    const absent = enrichedStudents.filter(s => s.status === 'absent').length;
    const submitted = enrichedStudents.filter(s =>
      s.status === 'submitted' || s.status === 'grading' || s.status === 'graded').length;
    return {
      assigned,
      attended: assigned - absent,
      submitted,
      absent,
      online: enrichedStudents.filter(s => s.online).length,
      inProgress: enrichedStudents.filter(s => s.status === 'in_progress').length,
      alerts: enrichedStudents.filter((s) => isAlertStudent(s, alertRules)).length,
    };
  }, [enrichedStudents, alertRules]);

  // ✅ 按考场分组数据
  const roomGroupedData = useMemo(() => {
    const grouped: Record<string, LiveStudent[]> = {};
    enrichedStudents.forEach(student => {
      const roomId = student.roomId || 'unassigned';
      if (!grouped[roomId]) grouped[roomId] = [];
      grouped[roomId].push(student);
    });
    return grouped;
  }, [enrichedStudents]);

  // ✅ 数据导出功能
  const handleExport = (format: 'excel' | 'csv') => {
    try {
      const exportData = enrichedStudents.map(student => ({
        '学生姓名': student.studentName,
        '学号': student.studentId,
        '状态': statusMap[student.status || 'pending']?.text || '未知',
        '当前题目': student.currentQuestion + 1,
        '切屏次数': student.tabSwitchCount,
        '在线状态': student.online ? '在线' : '离线',
        '最后心跳': student.lastHeartbeat ? dayjs(student.lastHeartbeat).format('YYYY-MM-DD HH:mm:ss') : '-',
        '开始时间': student.startedAt ? dayjs(student.startedAt).format('YYYY-MM-DD HH:mm:ss') : '-',
        '提交时间': student.submittedAt ? dayjs(student.submittedAt).format('YYYY-MM-DD HH:mm:ss') : '-',
        '得分': student.totalScore ?? '-',
        '考场': student.roomCode || '未分配',
        '座位号': student.seatNumber ?? '-',
      }));

      if (format === 'excel') {
        // 使用XLSX库导出Excel文件
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '考试监控数据');
        XLSX.writeFile(workbook, `exam-monitor-${id}-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`);
      } else {
        // CSV格式
        const csvContent = [
          Object.keys(exportData[0]).join(','),
          ...exportData.map(row => Object.values(row).join(','))
        ].join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `exam-monitor-${id}-${dayjs().format('YYYYMMDD-HHmmss')}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }

      message.success(`成功导出${format.toUpperCase()}文件`);
    } catch (err) {
      console.error('导出失败:', err);
      message.error('导出失败');
    }
  };

  // ✅ 学生列定义
  const columns = [
    {
      title: '学生',
      key: 'student',
      render: (_: any, record: LiveStudent) => (
        <Space>
          <Badge status={record.online ? 'success' : 'error'} />
          <a onClick={() => { openStudentDrawer(record); }}>
            {record.studentName}
          </a>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const config = statusMap[status];
        return config ? <Tag color={config.color}>{config.text}</Tag> : <Tag>未知</Tag>;
      },
    },
    {
      title: '当前进度',
      key: 'progress',
      width: 150,
      render: (_: any, record: LiveStudent) =>
        record.currentQuestion < 0 ? (
          <span style={{ color: '#999' }}>—</span>
        ) : (
          <Tooltip title={`第 ${record.currentQuestion + 1} 题`}>
            <Progress
              percent={Math.min((record.currentQuestion / 20) * 100, 100)}
              size="small"
              status={record.status === 'submitted' ? 'success' : 'active'}
            />
          </Tooltip>
        ),
    },
    {
      title: '切屏次数',
      dataIndex: 'tabSwitchCount',
      key: 'tabSwitchCount',
      width: 100,
      render: (count: number) => (
        <Tag color={count > alertRules.maxTabSwitches ? 'error' : 'default'}>
          {count}次
        </Tag>
      ),
    },
    {
      title: '最后心跳',
      dataIndex: 'lastHeartbeat',
      key: 'lastHeartbeat',
      width: 160,
      render: (time: string) => time ? dayjs(time).fromNow() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: any, record: LiveStudent) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => { openStudentDrawer(record); }}
        >
          详情
        </Button>
      ),
    },
  ];

  // 权限不足优先于加载态渲染：拿不到数据的监控面板只会是空白，不如直接说明原因
  if (forbidden) {
    return (
      <Result
        status="403"
        title="无权查看该考试"
        subTitle="该考试不在你的管理范围内（仅创建者、监考老师或管理员可查看）"
      />
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>正在连接监控系统...</div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 1400 }}>
      {/* 页面头部 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/teacher/exams')}>
            返回
          </Button>
          <Title level={3} style={{ margin: 0 }}>实时监控</Title>
          <Badge
            status={connected ? 'success' : 'error'}
            text={connected ? 'WebSocket 已连接' : 'WebSocket 断开'}
          />
        </Space>
        <Space>
          <Button
            icon={<SettingOutlined />}
            onClick={() => setAlertModalOpen(true)}
          >
            预警设置
          </Button>
          <Button.Group>
            <Button
              icon={<ExportOutlined />}
              onClick={() => handleExport('excel')}
              disabled={liveStudents.size === 0}
            >
              导出Excel
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => handleExport('csv')}
              disabled={liveStudents.size === 0}
            >
              CSV
            </Button>
          </Button.Group>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 主区（左）+ 监考侧栏（右）：左侧 KPI 与各维度视图，右侧是考场概况四数与考生动态 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={17}>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <StatCard title="在线" value={stats.online} icon={<CheckCircleOutlined />} tone="green" />
            </Col>
            <Col xs={12} sm={6}>
              <StatCard title="答题中" value={stats.inProgress} icon={<ClockCircleOutlined />} tone="blue" />
            </Col>
            <Col xs={12} sm={6}>
              <StatCard title="异常预警" value={stats.alerts} icon={<WarningOutlined />} tone="orange" />
            </Col>
            <Col xs={12} sm={6}>
              <StatCard
                title="完成率"
                value={stats.assigned > 0 ? Math.round((stats.submitted / stats.assigned) * 100) : 0}
                suffix="%"
                icon={<PercentageOutlined />}
                tone="purple"
              />
            </Col>
          </Row>

          {/* ✅ Tab切换：总览 / 考场维度 / 异常列表 */}
          <Tabs activeKey={activeTab} onChange={setActiveTab}>
            <Tabs.TabPane tab="总览" key="overview">
              <Table
                dataSource={enrichedStudents}
                rowKey="studentId"
                columns={columns}
                pagination={{ pageSize: 20 }}
                size="middle"
                scroll={{ x: 900 }}
              />
            </Tabs.TabPane>

            <Tabs.TabPane tab={
              <span>
                <HomeOutlined /> 考场维度 ({rooms.length})
              </span>
            } key="rooms">
              {rooms.length > 0 ? (
                rooms.map(room => {
                  const roomStudents = roomGroupedData[room.id] || [];
                  const onlineCount = roomStudents.filter(s => s.online).length;
                  const alertCount = roomStudents.filter(s =>
                    s.tabSwitchCount > alertRules.maxTabSwitches ||
                    !s.online
                  ).length;

                  return (
                    <Card
                      key={room.id}
                      size="small"
                      style={{ marginBottom: 12 }}
                      title={
                        <Space>
                          <strong>{room.code} - {room.name}</strong>
                          <Tag color="blue">容量:{room.capacity}</Tag>
                          <Tag color={onlineCount > 0 ? 'green' : 'default'}>
                            在线:{onlineCount}/{roomStudents.length}
                          </Tag>
                          {alertCount > 0 && (
                            <Tag color="error">{alertCount}个异常</Tag>
                          )}
                        </Space>
                      }
                    >
                      {roomStudents.length > 0 ? (
                        <Table
                          dataSource={roomStudents}
                          rowKey="studentId"
                          columns={columns}
                          // 每间考场可能有上百人：3000 人 × 多考场若全部渲染进 DOM 会卡死，
                          // 分页只渲染当前页；hideOnSinglePage 保证小考场观感与原来一致
                          pagination={{ pageSize: 10, hideOnSinglePage: true }}
                          size="small"
                          scroll={{ x: 800 }}
                        />
                      ) : (
                        <Empty description="该考场暂无学生" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      )}
                    </Card>
                  );
                })
              ) : (
                <Alert
                  type="info"
                  message="暂无考场数据"
                  description="请先在考场管理中为此考试分配考场"
                />
              )}
            </Tabs.TabPane>

            <Tabs.TabPane tab={
              <span>
                <WarningOutlined /> 异常预警 ({stats.alerts})
              </span>
            } key="alerts">
              {stats.alerts > 0 ? (
                <Table
                  dataSource={enrichedStudents.filter((student) => isAlertStudent(student, alertRules))}
                  rowKey="studentId"
                  columns={[
                    ...columns,
                    {
                      title: '异常原因',
                      key: 'reason',
                      width: 200,
                      render: (_: any, record: LiveStudent) => {
                        const reasons: string[] = [];
                        if (record.tabSwitchCount > alertRules.maxTabSwitches) {
                          reasons.push(`切屏超限(${record.tabSwitchCount}次)`);
                        }
                        // 与 isAlertStudent 同口径：只有答题中的学生掉线才是异常
                        if (record.status === 'in_progress' && !record.online) {
                          const offlineSeconds = dayjs().diff(dayjs(record.lastHeartbeat), 'second');
                          reasons.push(`离线${offlineSeconds}秒`);
                        }
                        return reasons.length > 0 ? (
                          <Space direction="vertical" size={0}>
                            {reasons.map((r, i) => (
                              <Tag key={i} color="error">{r}</Tag>
                            ))}
                          </Space>
                        ) : '-';
                      },
                    },
                  ]}
                  // 极端情况下（如考试结束全员离线）异常列表可能上千行，分页避免一次性进 DOM
                  pagination={{ pageSize: 10, hideOnSinglePage: true }}
                  size="small"
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  message="一切正常"
                  description="当前没有触发生警规则的学生"
                />
              )}
            </Tabs.TabPane>
          </Tabs>
        </Col>

        {/* 监考侧栏：考场概况四数（应参考/到考/交卷/缺考）+ 考生动态流 */}
        <Col xs={24} lg={7}>
          <Card title="考场概况" size="small" style={{ marginBottom: 16 }}>
            <div className="monitor-stat-grid">
              <div className="monitor-stat">
                <div className="monitor-stat__value" style={{ color: '#3b82f6' }}>{stats.assigned}</div>
                <div className="monitor-stat__label">应参考</div>
              </div>
              <div className="monitor-stat">
                <div className="monitor-stat__value" style={{ color: '#22a06b' }}>{stats.attended}</div>
                <div className="monitor-stat__label">到考</div>
              </div>
              <div className="monitor-stat">
                <div className="monitor-stat__value" style={{ color: '#0891b2' }}>{stats.submitted}</div>
                <div className="monitor-stat__label">交卷</div>
              </div>
              <div className="monitor-stat">
                <div className="monitor-stat__value" style={{ color: '#ff3b30' }}>{stats.absent}</div>
                <div className="monitor-stat__label">缺考</div>
              </div>
            </div>
          </Card>
          <Card title="考生动态" size="small">
            {recentEvents.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />
            ) : (
              <div className="monitor-feed">
                {recentEvents.map((e) => (
                  <div className="monitor-feed__item" key={e.key}>
                    <span className="monitor-feed__time">{dayjs(e.at).format('HH:mm:ss')}</span>
                    <Tag color={e.color} style={{ margin: 0 }}>{e.text}</Tag>
                    <span className="monitor-feed__name" title={e.studentName}>{e.studentName}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ✅ 学生详情抽屉 */}
      <Drawer
        title={`${selectedStudent?.studentName} 的详细情况`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={500}
      >
        {selectedStudent && (
          <div>
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Card size="small"><Statistic title="当前题目" value={selectedStudent.currentQuestion >= 0 ? selectedStudent.currentQuestion + 1 : '—'} suffix={selectedStudent.currentQuestion >= 0 ? '/ 20' : ''} /></Card>
              </Col>
              <Col span={12}>
                <Card size="small"><Statistic title="切屏次数" value={selectedStudent.tabSwitchCount} valueStyle={{ color: selectedStudent.tabSwitchCount > alertRules.maxTabSwitches ? '#ff4d4f' : '#999' }} /></Card>
              </Col>
              <Col span={12}>
                <Card size="small"><Statistic title="在线状态" value={selectedStudent.status === 'absent' ? '缺考' : selectedStudent.online ? '在线' : '离线'} valueStyle={{ color: selectedStudent.online ? '#52c41a' : '#ff4d4f' }} /></Card>
              </Col>
              <Col span={12}>
                <Card size="small"><Statistic title="最后心跳" value={selectedStudent.lastHeartbeat ? dayjs(selectedStudent.lastHeartbeat).fromNow() : '-'} /></Card>
              </Col>
            </Row>

            {/* 监考干预：强制交卷（答题中）/ 允许续考（已交卷且未判分），状态由服务端把关 */}
            {(selectedStudent.status === 'in_progress' || selectedStudent.status === 'submitted') && (
              <>
                <Divider style={{ marginBottom: 12 }} />
                <Space>
                  {selectedStudent.status === 'in_progress' && (
                    <Popconfirm
                      title="强制交卷"
                      description="该考生将立即结束作答，无法再继续答题。确认交卷？"
                      okText="确认交卷"
                      cancelText="取消"
                      onConfirm={() => handleForceSubmit(selectedStudent.studentId)}
                    >
                      <Button danger type="primary" size="small" loading={actionLoading === 'force-submit'}>
                        强制交卷
                      </Button>
                    </Popconfirm>
                  )}
                  {selectedStudent.status === 'submitted' && (
                    <Popconfirm
                      title="允许续考"
                      description="答卷将退回作答中，考生可重新进入继续答题（已进入判分的答卷不可续考）。确认？"
                      okText="确认续考"
                      cancelText="取消"
                      onConfirm={() => handleResume(selectedStudent.studentId)}
                    >
                      <Button size="small" loading={actionLoading === 'resume'}>
                        允许续考
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              </>
            )}

            <Divider />

            <div>
              <Text strong>考生时间线</Text>
              <div style={{ marginTop: 8 }}>
                {timelineLoading ? (
                  <div style={{ textAlign: 'center', padding: 12 }}><Spin size="small" /></div>
                ) : studentTimeline.length > 0 ? (
                  studentTimeline.map((e) => (
                    <div key={e.key} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                      <Tag color={e.color}>{e.text}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {dayjs(e.at).format('YYYY-MM-DD HH:mm:ss')}
                      </Text>
                    </div>
                  ))
                ) : (
                  // 行为日志为空（考生全程未触发任何受监控行为）时给一句说明，而不是空白
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无行为记录" />
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* ✅ 预警规则配置弹窗 */}
      <Modal
        title="预警规则配置"
        open={alertModalOpen}
        onOk={() => {
          setAlertModalOpen(false);
          message.success('预警规则已更新');
        }}
        onCancel={() => setAlertModalOpen(false)}
        width={500}
      >
        <Form layout="vertical" initialValues={alertRules}>
          <Form.Item label="启用预警系统">
            <Switch
              checked={alertRules.enableAlert}
              onChange={(checked) => setAlertRules(prev => ({ ...prev, enableAlert: checked }))}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </Form.Item>

          {alertRules.enableAlert && (
            <>
              <Form.Item label="最大允许切屏次数" extra="超过此次数将标记为异常">
                <InputNumber
                  min={0}
                  max={50}
                  value={alertRules.maxTabSwitches}
                  onChange={(value) => setAlertRules(prev => ({ ...prev, maxTabSwitches: value || 0 }))}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item label="离线判定阈值（秒）" extra="超过此时间未收到心跳则视为异常离线">
                <InputNumber
                  min={10}
                  max={300}
                  value={alertRules.offlineThreshold}
                  onChange={(value) => setAlertRules(prev => ({ ...prev, offlineThreshold: value || 30 }))}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </>
          )}

          <Alert
            type="info"
            showIcon
            message="提示"
            description="修改预警规则后，系统将实时重新计算所有学生的异常状态。建议根据实际考试要求调整参数。"
            style={{ marginTop: 16 }}
          />
        </Form>
      </Modal>
    </div>
  );
}
