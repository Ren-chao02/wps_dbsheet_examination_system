import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Table, Tag, Card, Statistic, Row, Col, Spin, message, Badge,
  Button, Space, Select, Tabs, Modal, Drawer, Alert, Progress,
  Tooltip, Typography, Divider, Empty, Switch, InputNumber, Form
} from 'antd';
import {
  UserOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined,
  ExportOutlined, EyeOutlined, SettingOutlined, HomeOutlined,
  TeamOutlined, DownloadOutlined, FilterOutlined, ReloadOutlined, ArrowLeftOutlined
} from '@ant-design/icons';
import { io, Socket } from 'socket.io-client';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime'; // ✅ 导入相对时间插件
import api from '../../services/api';
import * as XLSX from 'xlsx'; // Excel导出库

// ✅ 扩展dayjs以支持fromNow方法
dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { TabPane } = Tabs;

// ✅ 状态配置
const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'processing', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
};

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
  lastHeartbeat: string;
  online: boolean;
  status?: string;
  startedAt?: string;
  submittedAt?: string;
  totalScore?: number | null;
  roomId?: string; // ✅ 新增：所属考场ID
  roomCode?: string; // ✅ 新增：考场编码
  seatNumber?: number; // ✅ 新增：座位号
}

export function EnhancedExamMonitor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [liveStudents, setLiveStudents] = useState<Map<string, LiveStudent>>(new Map());
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [alertRules, setAlertRules] = useState<AlertRule>(DEFAULT_ALERT_RULES);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<LiveStudent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [rooms, setRooms] = useState<any[]>([]); // ✅ 考场列表
  const socketRef = useRef<Socket | null>(null);

  // ✅ 加载考场信息
  useEffect(() => {
    if (id) {
      api.get(`/rooms?examId=${id}&pageSize=100`)
        .then(res => setRooms(res.data?.data || []))
        .catch(err => console.error('加载考场失败:', err));
    }
  }, [id]);

  const fetchData = async () => {
    try {
      const res = await api.get(`/exams/${id}/submissions`);
      setSubmissions(res.data);
    } catch (err) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Socket.IO 连接（保持原有逻辑）
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

    socket.on('monitor:students', (students: LiveStudent[]) => {
      const map = new Map<string, LiveStudent>();
      students.forEach(s => map.set(s.studentId, s));
      setLiveStudents(map);
    });

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

    socket.on('monitor:update', (data: Partial<LiveStudent> & { studentId: string }) => {
      setLiveStudents(prev => {
        const next = new Map(prev);
        const existing = next.get(data.studentId) || {
          studentId: data.studentId, studentName: '', currentQuestion: 0,
          tabSwitchCount: 0, lastHeartbeat: '', online: true
        };
        next.set(data.studentId, { ...existing, ...data });
        return next;
      });
    });

    socket.on('monitor:submit', (data: { studentId: string; studentName: string; submittedAt: string }) => {
      setLiveStudents(prev => {
        const next = new Map(prev);
        const existing = next.get(data.studentId);
        if (existing) {
          next.set(data.studentId, { ...existing, ...data, online: true });
        }
        return next;
      });
      fetchData();
    });

    return () => {
      socket.disconnect();
    };
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [id]);

  // ✅ 计算统计数据
  const stats = useMemo(() => {
    const students = Array.from(liveStudents.values());
    return {
      total: students.length,
      online: students.filter(s => s.online).length,
      inProgress: students.filter(s => s.status === 'in_progress').length,
      submitted: students.filter(s => s.status === 'submitted' || s.status === 'graded').length,
      alerts: students.filter(s =>
        alertRules.enableAlert && (
          s.tabSwitchCount > alertRules.maxTabSwitches ||
          (s.online === false &&
            dayjs().diff(dayjs(s.lastHeartbeat), 'second') > alertRules.offlineThreshold)
        )
      ).length,
    };
  }, [liveStudents, alertRules]);

  // ✅ 按考场分组数据
  const roomGroupedData = useMemo(() => {
    const grouped: Record<string, LiveStudent[]> = {};
    Array.from(liveStudents.values()).forEach(student => {
      const roomId = student.roomId || 'unassigned';
      if (!grouped[roomId]) grouped[roomId] = [];
      grouped[roomId].push(student);
    });
    return grouped;
  }, [liveStudents]);

  // ✅ 数据导出功能
  const handleExport = (format: 'excel' | 'csv') => {
    try {
      const exportData = Array.from(liveStudents.values()).map(student => ({
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
          <a onClick={() => { setSelectedStudent(record); setDrawerOpen(true); }}>
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
      render: (_: any, record: LiveStudent) => (
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
          onClick={() => { setSelectedStudent(record); setDrawerOpen(true); }}
        >
          详情
        </Button>
      ),
    },
  ];

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

      {/* ✅ 统计仪表板 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card>
            <Statistic
              title="总人数"
              value={stats.total}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="在线"
              value={stats.online}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="答题中"
              value={stats.inProgress}
              valueStyle={{ color: '#1890ff' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="已提交"
              value={stats.submitted}
              valueStyle={{ color: '#722ed1' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="异常预警"
              value={stats.alerts}
              valueStyle={{ color: stats.alerts > 0 ? '#ff4d4f' : '#999' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card>
            <Statistic
              title="完成率"
              value={stats.total > 0 ? Math.round((stats.submitted / stats.total) * 100) : 0}
              suffix="%"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
      </Row>

      {/* ✅ Tab切换：总览 / 考场维度 / 异常列表 */}
      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <Tabs.TabPane tab="总览" key="overview">
          <Table
            dataSource={Array.from(liveStudents.values())}
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
                      pagination={false}
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
              dataSource={Array.from(liveStudents.values()).filter(student =>
                alertRules.enableAlert && (
                  student.tabSwitchCount > alertRules.maxTabSwitches ||
                  (student.online === false &&
                    dayjs().diff(dayjs(student.lastHeartbeat), 'second') > alertRules.offlineThreshold)
                )
              )}
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
                    if (!record.online) {
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
              pagination={false}
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
                <Card size="small"><Statistic title="当前题目" value={selectedStudent.currentQuestion + 1} suffix="/ 20" /></Card>
              </Col>
              <Col span={12}>
                <Card size="small"><Statistic title="切屏次数" value={selectedStudent.tabSwitchCount} valueStyle={{ color: selectedStudent.tabSwitchCount > alertRules.maxTabSwitches ? '#ff4d4f' : '#999' }} /></Card>
              </Col>
              <Col span={12}>
                <Card size="small"><Statistic title="在线状态" value={selectedStudent.online ? '在线' : '离线'} valueStyle={{ color: selectedStudent.online ? '#52c41a' : '#ff4d4f' }} /></Card>
              </Col>
              <Col span={12}>
                <Card size="small"><Statistic title="最后心跳" value={selectedStudent.lastHeartbeat ? dayjs(selectedStudent.lastHeartbeat).fromNow() : '-'} /></Card>
              </Col>
            </Row>

            <Divider />

            <div>
              <Text strong>时间线：</Text>
              <div style={{ marginTop: 8 }}>
                {selectedStudent.startedAt && (
                  <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <Tag color="blue">开始考试</Tag>
                    <Text type="secondary">{dayjs(selectedStudent.startedAt).format('YYYY-MM-DD HH:mm:ss')}</Text>
                  </div>
                )}
                {selectedStudent.submittedAt && (
                  <div style={{ padding: '8px 0' }}>
                    <Tag color="green">提交试卷</Tag>
                    <Text>{dayjs(selectedStudent.submittedAt).format('YYYY-MM-DD HH:mm:ss')}</Text>
                  </div>
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
