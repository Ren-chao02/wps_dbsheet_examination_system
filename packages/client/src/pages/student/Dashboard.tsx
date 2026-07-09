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
import type { Exam } from '../../types';

interface ExamWithSubmission extends Exam {
  roomName?: string | null;
  mySubmission: { id: string; status: string; totalScore: number | null; startedAt: string | null; submittedAt: string | null } | null;
}

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未参考' },
  in_progress: { color: 'processing', text: '考试中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'warning', text: '评分中' },
  graded: { color: 'success', text: '已结束' },
};

export function StudentDashboard() {
  const [exams, setExams] = useState<ExamWithSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const navigate = useNavigate();

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
        return (
          <Button
            type="primary"
            size="small"
            onClick={async () => {
              await enterFullscreen();
              navigate(`/student/exam/${exam.id}/check`);
            }}
          >
            {status === 'in_progress' ? '继续答题' : '进入考试'}
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
