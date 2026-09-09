import { useEffect, useState } from 'react';
import {
  Drawer, Descriptions, Tag, Table, Spin, Empty, Space, Typography, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LinkOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Exam } from '../../types';
import { modeLabels, statusLabels, formatTimeSlot } from '../../utils/examDisplay';

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
