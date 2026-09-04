import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Tag, Button, Spin, Empty, message, Input, Select, Space, Tooltip } from 'antd';
import {
  SearchOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { enterFullscreen } from '../../components/exam/FullscreenGuard';
import { computeLatestEntryTime } from '../../utils/exam-time';
import type { Exam } from '../../types';

interface ExamWithSubmission extends Exam {
  roomName?: string | null;
  mySubmission: { id: string; status: string; totalScore: number | null; startedAt: string | null; submittedAt: string | null } | null;
}

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未参考' },
  in_progress: { color: 'processing', text: '考试中' },
  submitted: { color: 'warning', text: '已提交' },
  graded: { color: 'success', text: '已结束' },
  // grading 已弱化为阅卷内部状态，学生侧不再感知（后端 my-exams 接口会映射为 submitted）
};

// 判断考试窗口是否已关闭（即考试时间已结束，禁止再入场/继续答题）。
// 口径与 ExamEnvironmentCheck / 服务端校验保持一致：
// - flexible（随到随考）：批次窗口 endTime 已过即关闭
// - unified（集中统一）：考试自身 endTime（或 startTime + 时长）已过即结束
function isExamWindowClosed(exam: ExamWithSubmission): boolean {
  const now = Date.now();
  const mode = exam.batch?.examMode || 'unified';

  if (mode === 'flexible') {
    const windowEnd = exam.batch?.endTime ? new Date(exam.batch.endTime).getTime() : null;
    return windowEnd !== null && now > windowEnd;
  }

  const examEnd = exam.endTime ? new Date(exam.endTime).getTime() : null;
  if (examEnd !== null) return now > examEnd;
  const start = exam.startTime ? new Date(exam.startTime).getTime() : null;
  const duration = exam.batch?.examDuration || exam.durationMinutes || 0;
  return start !== null && duration > 0 && now > start + duration * 60 * 1000;
}

export function StudentDashboard() {
  const [exams, setExams] = useState<ExamWithSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const navigate = useNavigate();

  // 每分钟刷新一次，保证页面停留时，考试结束后按钮能及时变为不可用
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api
      .get('/my-exams')
      .then((res) => setExams(res.data))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const filteredExams = exams.filter((exam) => {
    const sub = exam.mySubmission;
    const status = sub ? sub.status : 'pending';
    const matchesStatus = statusFilter === 'all' || status === statusFilter;
    const matchesSearch = exam.title.toLowerCase().includes(searchText.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const columns = [
    {
      title: '序号',
      width: 70,
      align: 'center' as const,
      render: (_: any, __: ExamWithSubmission, index: number) => index + 1,
    },
    {
      title: '考试时间',
      width: 220,
      render: (exam: ExamWithSubmission) => {
        const isFlexible = exam.batch?.examMode === 'flexible';

        if (isFlexible) {
          // 灵活模式：显示批次时间窗口，学生可在窗口内任意时段进入
          const start = exam.batch?.startTime ? dayjs(exam.batch.startTime).format('YYYY/MM/DD HH:mm') : null;
          const end = exam.batch?.endTime ? dayjs(exam.batch.endTime).format('HH:mm') : null;
          return (
            <Space>
              <ClockCircleOutlined />
              {start ? (
                <>
                  <Tag color="green" style={{ marginRight: 4 }}>随到随考</Tag>
                  {start}{end && <span> ~ {end}</span>}
                </>
              ) : (
                <Tag color="orange">批次未设置时间</Tag>
              )}
            </Space>
          );
        }

        // 集中统一模式：显示考试自身的时间
        const start = exam.startTime ? dayjs(exam.startTime).format('YYYY/MM/DD HH:mm') : null;
        const end = exam.endTime ? dayjs(exam.endTime).format('HH:mm') : null;
        return (
          <Space>
            <ClockCircleOutlined />
            {start ? (
              <>
                {start}
                {end && <span> ~ {end}</span>}
              </>
            ) : (
              <Tag color="orange">未设置考试时间</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '最晚入场',
      width: 130,
      align: 'center' as const,
      render: (exam: ExamWithSubmission) => {
        // 最晚进入考场时间（固定时间戳，非倒计时）：
        // unified = 开始 + 迟到容忍；flexible = 结束 - 考试时长
        const ms = computeLatestEntryTime(exam);
        if (ms === null) return <span style={{ color: '#999' }}>—</span>;
        const passed = Date.now() > ms;
        return (
          <Tooltip title={passed ? '已过最晚入场时间' : '超过此时间将无法进入考场'}>
            <Tag color={passed ? 'default' : 'orange'} style={{ margin: 0 }}>
              {dayjs(ms).format('MM-DD HH:mm')}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '考试名称 / 批次',
      dataIndex: 'title',
      render: (title: string, exam: ExamWithSubmission) => (
        <Tooltip title={exam.description || undefined}>
          <div style={{ fontWeight: 500 }}>{title}</div>
          {exam.batch?.name && (
            <div style={{ fontSize: 12, color: '#888' }}>批次: {exam.batch.name}</div>
          )}
        </Tooltip>
      ),
    },
    {
      title: '考场名称',
      dataIndex: 'roomName',
      width: 180,
      render: (roomName: string | null) => (
        <Space>
          <EnvironmentOutlined />
          {roomName || '—'}
        </Space>
      ),
    },
    {
      title: '考试状态',
      width: 120,
      align: 'center' as const,
      render: (exam: ExamWithSubmission) => {
        const sub = exam.mySubmission;
        const status = sub ? sub.status : 'pending';
        const mapped = statusMap[status] || { color: 'default', text: status };
        return <Tag color={mapped.color}>{mapped.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 140,
      align: 'center' as const,
      render: (exam: ExamWithSubmission) => {
        const sub = exam.mySubmission;
        const status = sub ? sub.status : 'pending';
        if (status === 'graded') {
          return (
            <Button type="link" size="small" onClick={() => navigate(`/student/exam/${exam.id}/result`)}>
              查看成绩
            </Button>
          );
        }
        const windowClosed = isExamWindowClosed(exam);
        return (
          <Button
            type="primary"
            size="small"
            disabled={windowClosed}
            onClick={async () => {
              await enterFullscreen();
              navigate(`/student/exam/${exam.id}/check`);
            }}
          >
            {windowClosed ? '已结束' : status === 'in_progress' ? '继续答题' : '进入考试'}
          </Button>
        );
      },
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div
        className="page-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0 }}>我的考试</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <Input
            placeholder="搜索考试..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 140 }}>
            <Select.Option value="all">全部状态</Select.Option>
            <Select.Option value="pending">未参考</Select.Option>
            <Select.Option value="in_progress">考试中</Select.Option>
            <Select.Option value="submitted">已提交</Select.Option>
            <Select.Option value="graded">已结束</Select.Option>
          </Select>
        </div>
      </div>

      {filteredExams.length === 0 ? (
        <Empty description="暂无符合条件的考试" style={{ marginTop: 100 }} />
      ) : (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredExams}
          pagination={false}
          bordered
          size="middle"
        />
      )}
    </div>
  );
}
