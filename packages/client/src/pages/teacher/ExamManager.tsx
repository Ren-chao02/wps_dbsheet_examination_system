import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, message, Card } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Exam, PaginatedResponse } from '../../types';
import { ExamConfigWizard } from './ExamConfigWizard';

const modeLabels: Record<string, string> = { practice: '练习', quiz: '测验', exam: '正式考试' };
const statusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'blue', text: '已发布' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'purple', text: '已结束' },
  archived: { color: 'orange', text: '已归档' },
};

function formatTimeSlot(exam: Exam): string {
  if (!exam.startTime) return '未设置';
  const start = dayjs(exam.startTime);
  const end = exam.endTime ? dayjs(exam.endTime) : null;
  if (end && !start.isSame(end, 'day')) {
    return `${start.format('YYYY-MM-DD HH:mm')} ~ ${end.format('YYYY-MM-DD HH:mm')}`;
  }
  const date = start.format('YYYY-MM-DD');
  const startTime = start.format('HH:mm');
  const endTime = end ? end.format('HH:mm') : '';
  return `${date} ${startTime}${endTime ? ` ~ ${endTime}` : ''}`;
}

function formatRoomSettings(rooms?: Exam['rooms']): string {
  if (!rooms || rooms.length === 0) return '未设置';
  return rooms.map(r => r.code).join(', ');
}

function countAssignedStudents(rooms?: Exam['rooms']): number {
  return rooms?.reduce((sum, r) => sum + (r._count?.students ?? 0), 0) ?? 0;
}

export function ExamManager() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Exam>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const fetchExams = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get(`/exams?page=${page}&pageSize=20`);
      setData(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchExams(); }, []);

  const handleDelete = async (id: string) => {
    try { await api.delete(`/exams/${id}`); message.success('删除成功'); fetchExams(); }
    catch (err: any) { message.error(err.response?.data?.message || '删除失败'); }
  };

  const columns: ColumnsType<Exam> = [
    { title: '名称', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '所属批次',
      key: 'batch',
      render: (_: any, r: Exam) => r.batch?.name ?? '未归属',
    },
    { title: '模式', dataIndex: 'mode', key: 'mode', render: (v: string) => modeLabels[v] },
    {
      title: '绑定试卷', key: 'paper',
      render: (_: any, r: Exam) => (
        r.paper ? (
          <Tag color="blue">{r.paper.name}</Tag>
        ) : (
          <Tag color="default">未绑定</Tag>
        )
      ),
    },
    { title: '题目数', key: 'questions', render: (_: any, r: Exam) => r._count?.examQuestions ?? 0 },
    { title: '提交数', key: 'submissions', render: (_: any, r: Exam) => r._count?.submissions ?? 0 },
    { title: '总分', dataIndex: 'totalScore', key: 'totalScore' },
    {
      title: '时间场次',
      key: 'timeSlot',
      width: 180,
      render: (_: any, r: Exam) => formatTimeSlot(r),
    },
    {
      title: '考场设置',
      key: 'rooms',
      ellipsis: true,
      render: (_: any, r: Exam) => formatRoomSettings(r.rooms),
    },
    {
      title: '考生数量',
      key: 'studentCount',
      render: (_: any, r: Exam) => countAssignedStudents(r.rooms),
    },
    {
      title: '创建人',
      key: 'creator',
      render: (_: any, r: Exam) => r.creator?.realName ?? '-',
    },
    {
      title: '创建时间',
      key: 'createdAt',
      width: 140,
      render: (_: any, r: Exam) => r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions', width: 260, fixed: 'right', render: (_: any, r: Exam) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/edit`)} disabled={r.status === 'in_progress'}>编辑</Button>
          <Button size="small" icon={<BarChartOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}>统计</Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/grading`)}>阅卷</Button>
          <Button size="small" icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} disabled={r.status === 'in_progress'}>删除</Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>考试管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>创建考试</Button>
      </div>
      <Table dataSource={data.data} columns={columns} rowKey="id" loading={loading} scroll={{ x: 1500 }} pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchExams }} />
      <ExamConfigWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => fetchExams()}
      />
    </div>
  );
}
