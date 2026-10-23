import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Drawer, Descriptions, Tag, Table, Spin, Empty, Space, Typography, message,
  Card, Button, Alert, Modal,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LinkOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Exam } from '../../types';
import { modeLabels, statusLabels, formatTimeSlot } from '../../utils/examDisplay';
import { showPreflightError } from '../../components/exam/PreflightIssueModal';

const { Text, Link } = Typography;

function studentColumns(tableMap: Map<string, TableAssignment>): ColumnsType<RoomStudent> {
  return [
    { title: '座位号', dataIndex: 'seatNumber', width: 90 },
    {
      title: '考生姓名', key: 'name', width: 160,
      render: (_: any, r: RoomStudent) => r.student?.realName || '-',
    },
    {
      title: '学号/用户名', key: 'account', width: 160,
      render: (_: any, r: RoomStudent) => r.student?.studentId || '-',
    },
    {
      title: 'WPS 多维表格', key: 'table', render: (_: any, r: RoomStudent) => {
        const assigned = tableMap.get(r.studentId);
        if (!assigned?.shareUrl) return <Tag color="default">未分配</Tag>;
        return (
          <Link href={assigned.shareUrl} target="_blank" rel="noreferrer">
            <LinkOutlined /> 打开表格
          </Link>
        );
      },
    },
  ];
}

interface RoomStudent {
  id: string;
  studentId: string;
  seatNumber: number;
  student: { id: string; realName: string | null; studentId: string | null };
}

interface RoomAssignment {
  id: string;
  room: { id: string; code: string; name: string; capacity?: number };
  invigilators?: Array<{ id: string; realName: string }>;
  students?: RoomStudent[];
}

interface TableAssignment {
  studentId: string;
  fileId: string;
  shareUrl: string | null;
}

interface PaperGenerationState {
  status: 'none' | 'pending' | 'running' | 'done' | 'failed';
  totalStudents: number;
  generatedStudents: number;
  summary: Record<string, any> | null;
  unfilledSlots: Array<{ slotIndex: number; reason: string; students: number }> | null;
  error: string | null;
}

// pickMeta.level 的中文标签；级别越高说明组卷让步越多，教师据此判断卷子等值性
const levelLabels: Record<string, string> = {
  'relax-schemaRefs': '放宽结构',
  'relax-difficulty': '放宽难度',
  repair: '修复',
};

interface AnomalyStudent {
  studentId: string;
  name: string;
  slots: Array<{ slotIndex: number; questionId: string; title: string; level: string; repairedFrom?: string | null }>;
}

const fmtDist = (d: any) => (d ? `易${d.easy ?? 0}/中${d.medium ?? 0}/难${d.hard ?? 0}` : '未设置');

interface ExamDetailDrawerProps {
  exam: Exam | null;
  open: boolean;
  onClose: () => void;
}

export function ExamDetailDrawer({ exam, open, onClose }: ExamDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [rooms, setRooms] = useState<RoomAssignment[]>([]);
  const [tableMap, setTableMap] = useState<Map<string, TableAssignment>>(new Map());

  useEffect(() => {
    if (!open || !exam) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const [roomRes, tableRes] = await Promise.all([
          api.get(`/exam-room-assignments/exams/${exam.id}/rooms`),
          api.get(`/exam-table-assignments/${exam.id}`).catch(() => ({ data: { assignments: [] } })),
        ]);
        if (cancelled) return;
        setRooms(roomRes.data?.data || []);
        const map = new Map<string, TableAssignment>();
        (tableRes.data?.assignments || []).forEach((a: TableAssignment) => map.set(a.studentId, a));
        setTableMap(map);
      } catch {
        if (!cancelled) message.error('加载考试详情失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [open, exam?.id]);

  // 组卷质量卡片：与上面的考场/表格加载相互独立，失败不影响抽屉主体
  const [gen, setGen] = useState<PaperGenerationState | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(false);

  // 异常卷子弹窗：只在打开时按需加载，same exam 内复用已加载结果
  const [anomaliesOpen, setAnomaliesOpen] = useState(false);
  const [anomalies, setAnomalies] = useState<AnomalyStudent[] | null>(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [anomaliesTruncated, setAnomaliesTruncated] = useState(false);

  // 抽屉常驻，切换考试时旧请求可能后到；用 ref 记下当前考试，过期响应一律丢弃
  const currentExamIdRef = useRef<string | null>(null);
  useEffect(() => { currentExamIdRef.current = exam?.id ?? null; }, [exam?.id]);

  const loadGeneration = useCallback(async () => {
    const id = exam?.id;
    if (!id) return;
    setGenLoading(true);
    try {
      const res = await api.get(`/exams/${id}/paper-generation`);
      if (currentExamIdRef.current === id) {
        setGen(res.data);
        setGenError(false);
      }
    } catch {
      if (currentExamIdRef.current === id) {
        setGen(null);
        setGenError(true);
      }
    } finally {
      if (currentExamIdRef.current === id) setGenLoading(false);
    }
  }, [exam?.id]);

  const openAnomalies = async () => {
    const id = exam?.id;
    if (!id) return;
    setAnomaliesOpen(true);
    if (anomalies) return;   // 同一场考试已加载过
    setAnomaliesLoading(true);
    try {
      const res = await api.get(`/exams/${id}/paper-generation/anomalies`);
      if (currentExamIdRef.current !== id) return;
      setAnomalies(res.data?.students ?? []);
      setAnomaliesTruncated(!!res.data?.truncated);
    } catch {
      if (currentExamIdRef.current === id) message.error('加载异常卷子失败');
    } finally {
      if (currentExamIdRef.current === id) setAnomaliesLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !exam?.id) return;
    setGen(null); // 先清空，避免上一场的数据短暂冒充本场
    setGenError(false);
    setAnomalies(null);
    setAnomaliesTruncated(false);
    // 弹窗若还开着会立刻以空列表重新出现，一并关掉
    setAnomaliesOpen(false);
    loadGeneration();
  }, [open, exam?.id, loadGeneration]);

  // 空态（无状态行）也要能触发：历史已发布考试没有组卷记录，正是 retry 接口要兜的场景
  const canTrigger = !!exam && ['published', 'scheduled', 'in_progress'].includes(exam.status);

  const handleRetry = () => {
    const id = exam?.id;
    if (!id) return;
    Modal.confirm({
      title: '触发组卷？',
      content: '若已有学生开考，只会补齐缺失的卷子；否则将清空并重新生成全部卷子。',
      okText: '继续',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await api.post(`/exams/${id}/paper-generation/retry`);
          message.success(res.data?.mode === 'fill-missing' ? '已触发补生成' : '已触发重新组卷');
        } catch (err: any) {
          if (!showPreflightError(err)) {
            message.error(err.response?.data?.message || '触发组卷失败');
          }
        } finally {
          // 503 时服务端已把状态行标 failed 并写入原因，刷新卡片才能看到真实状态
          loadGeneration();
        }
      },
    });
  };

  if (!exam) return null;

  const totalStudents = rooms.reduce((sum, r) => sum + (r.students?.length ?? 0), 0);
  const hasTableStudents = rooms.reduce(
    (sum, r) => sum + (r.students?.filter(s => tableMap.has(s.studentId))?.length ?? 0),
    0,
  );
  const statusMeta = statusLabels[exam.status] || { color: 'default', text: exam.status };

  return (
    <Drawer
      title="考试详情"
      width={860}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <Spin spinning={loading}>
        {/* 基本信息 */}
        <Descriptions
          title="基本信息"
          bordered
          column={2}
          size="small"
          style={{ marginBottom: 24 }}
        >
          <Descriptions.Item label="考试名称" span={2}>{exam.title}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={statusMeta.color}>{statusMeta.text}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="模式">{modeLabels[exam.mode] || exam.mode}</Descriptions.Item>
          <Descriptions.Item label="所属批次">
            {exam.batch ? `${exam.batch.name}${exam.batch.examMode === 'unified' ? '（集中）' : exam.batch.examMode === 'flexible' ? '（随到随考）' : ''}` : '未归属'}
          </Descriptions.Item>
          <Descriptions.Item label="绑定试卷">
            {exam.paper ? <Tag color="blue">{exam.paper.name}</Tag> : '未绑定'}
          </Descriptions.Item>
          <Descriptions.Item label="总分">{exam.totalScore} 分</Descriptions.Item>
          <Descriptions.Item label="及格线">{exam.passScore != null ? `${exam.passScore} 分` : '不设'}</Descriptions.Item>
          <Descriptions.Item label="时长">{exam.durationMinutes ? `${exam.durationMinutes} 分钟` : '不限时'}</Descriptions.Item>
          <Descriptions.Item label="时间场次">{formatTimeSlot(exam)}</Descriptions.Item>
          <Descriptions.Item label="题目数">
            {exam.paper?._count?.paperQuestions !== undefined
              ? exam.paper._count.paperQuestions
              : exam._count?.examQuestions ?? 0}
          </Descriptions.Item>
          <Descriptions.Item label="提交数">{exam._count?.submissions ?? 0}</Descriptions.Item>
          <Descriptions.Item label="创建人">{exam.creator?.realName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {exam.createdAt ? dayjs(exam.createdAt).format('YYYY-MM-DD HH:mm') : '-'}
          </Descriptions.Item>
          {exam.description && (
            <Descriptions.Item label="考试说明" span={2}>{exam.description}</Descriptions.Item>
          )}
        </Descriptions>

        {/* 组卷质量：预生成状态 / 进度 / 缺口 / 重试 */}
        <Card
          size="small"
          title="组卷质量"
          style={{ marginBottom: 24 }}
          extra={
            <Space>
              <Spin size="small" spinning={genLoading} />
              <Button size="small" onClick={loadGeneration}>刷新</Button>
            </Space>
          }
        >
          {!gen || gen.status === 'none' ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  genError
                    ? '组卷状态加载失败，点「刷新」重试'
                    : exam.status === 'draft'
                      ? '草稿考试不预生成；发布后自动开始'
                      : '暂无组卷记录（发布考试后自动预生成；历史考试可手动触发）'
                }
              />
              {canTrigger && (
                <Button size="small" onClick={handleRetry}>预生成组卷</Button>
              )}
            </Space>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                状态：
                <Tag color={gen.status === 'done' ? 'success' : gen.status === 'failed' ? 'error' : 'processing'}>
                  {{ pending: '排队中', running: '生成中', done: '已完成', failed: '失败' }[gen.status] ?? gen.status}
                </Tag>
                进度：{gen.generatedStudents} / {gen.totalStudents} 人
              </div>
              {gen.summary?.distribution && (
                <div style={{ fontSize: 13 }}>
                  <div>
                    可调题位 {gen.summary.distribution.ruleSlots} 道 · 目标 {fmtDist(gen.summary.distribution.target)} · 实际（每卷平均）{fmtDist(gen.summary.distribution.actual)}
                  </div>
                  <div style={{ color: '#888' }}>
                    全卷（每卷平均）{fmtDist(gen.summary.distribution.wholePaper)}
                  </div>
                </div>
              )}
              {gen.summary?.degradation && (
                <div style={{ fontSize: 13 }}>
                  降级统计：原样 {gen.summary.degradation.strict} 卷 · 放宽结构 {gen.summary.degradation.relaxSchemaRefs} 卷 ·
                  放宽难度 {gen.summary.degradation.relaxDifficulty} 卷 · 修复 {gen.summary.degradation.repaired} 卷
                </div>
              )}
              {gen.summary && gen.summary.missing > 0 && (
                <Alert type="warning" showIcon message={`${gen.summary.missing} 名学生未能生成完整卷子（开考时将现场生成兜底）`} />
              )}
              {gen.error && <Alert type="error" showIcon message={gen.error} />}
              {gen.unfilledSlots && gen.unfilledSlots.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  message={`${gen.unfilledSlots.length} 类题位未能填满`}
                  description={gen.unfilledSlots
                    .map((u) => `题位 ${u.slotIndex + 1}：${u.reason}（${u.students} 人）`)
                    .join('；')}
                />
              )}
              <Space>
                <Button
                  size="small"
                  disabled={
                    gen.status === 'running'
                    || !['published', 'scheduled', 'in_progress'].includes(exam.status)
                  }
                  onClick={handleRetry}
                >
                  补生成 / 重新组卷
                </Button>
                <Button size="small" onClick={openAnomalies}>查看异常卷子</Button>
              </Space>
            </Space>
          )}
        </Card>

        {/* 异常卷子：按题位平铺，学生列重复出现便于筛选 */}
        <Modal
          title="异常卷子（放宽/修复过）"
          open={anomaliesOpen}
          onCancel={() => setAnomaliesOpen(false)}
          footer={null}
          width={720}
        >
          <Spin spinning={anomaliesLoading}>
            <Table
              size="small"
              rowKey={(r: any) => `${r.studentId}-${r.slotIndex}`}
              pagination={{ pageSize: 20 }}
              dataSource={(anomalies ?? []).flatMap(s => s.slots.map(sl => ({
                ...sl, studentId: s.studentId, name: s.name,
              })))}
              columns={[
                { title: '学生', dataIndex: 'name', width: 140 },
                { title: '题位', dataIndex: 'slotIndex', width: 80, render: (v: number) => v + 1 },
                {
                  title: '级别', dataIndex: 'level', width: 120,
                  render: (v: string) => <Tag color={v === 'repair' ? 'gold' : 'orange'}>{levelLabels[v] ?? v}</Tag>,
                },
                { title: '题目', dataIndex: 'title', ellipsis: true },
              ]}
              locale={{ emptyText: '没有异常卷子' }}
            />
            {anomaliesTruncated && (
              <div style={{ marginTop: 8, color: '#888' }}>仅显示前 50 名学生</div>
            )}
          </Spin>
        </Modal>

        {/* 考场/考生/表格分配 */}
        <div style={{ marginBottom: 16 }}>
          <Space size={16} wrap>
            <Text strong><TeamOutlined /> 考场与考生分配</Text>
            <Text type="secondary">{rooms.length} 个考场 · {totalStudents} 名考生 · 已分配表格 {hasTableStudents} 人</Text>
          </Space>
        </div>

        {!loading && rooms.length === 0 && (
          <Empty description="尚未分配考场与考生" />
        )}

        {rooms.map(assignment => {
          const invigilators = assignment.invigilators ?? [];
          return (
            <div key={assignment.id} style={{ marginBottom: 24 }}>
              <Descriptions bordered column={3} size="small" style={{ marginBottom: 8 }}>
                <Descriptions.Item label="考场">{assignment.room?.code} {assignment.room?.name}</Descriptions.Item>
                <Descriptions.Item label="容量">
                  {assignment.room?.capacity != null ? `${assignment.room.capacity} 人` : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="监考老师">
                  {invigilators.length > 0
                    ? invigilators.map(i => i.realName || i.id).join('、')
                    : '-'}
                </Descriptions.Item>
              </Descriptions>
              <Table
                rowKey={(r) => r.id}
                size="small"
                pagination={false}
                dataSource={assignment.students ?? []}
                locale={{ emptyText: '该考场暂无考生' }}
                columns={studentColumns(tableMap)}
              />
            </div>
          );
        })}
      </Spin>
    </Drawer>
  );
}
