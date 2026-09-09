import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Tag, Space, message, Card, Popconfirm, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, EditOutlined, DeleteOutlined, BarChartOutlined, EyeOutlined, SendOutlined, RollbackOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Exam, PaginatedResponse } from '../../types';
import { ExamConfigWizard } from './ExamConfigWizard';
import { ExamDetailDrawer } from './ExamDetailDrawer';
import { useAuthStore } from '../../stores/auth';
import { modeLabels, statusLabels, formatTimeSlot, formatRoomSettings, countAssignedStudents, examEditGuard } from '../../utils/examDisplay';

export function ExamManager() {
  const navigate = useNavigate();
  const currentUser = useAuthStore((s) => s.user);
  const [data, setData] = useState<PaginatedResponse<Exam>>({ data: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailExam, setDetailExam] = useState<Exam | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // 判断当前用户是否为考试创建者（admin 视为所有者）
  const isOwner = (r: Exam) =>
    currentUser?.role === 'admin' || r.creator?.id === currentUser?.id;

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

  // 发布考试
  const handlePublish = async (id: string) => {
    try {
      await api.post(`/exams/${id}/publish`);
      message.success('考试已发布');
      fetchExams();
    } catch (err: any) {
      message.error(err.response?.data?.message || '发布失败');
    }
  };

  // 撤销发布
  const handleUnpublish = async (id: string) => {
    try {
      await api.post(`/exams/${id}/unpublish`);
      message.success('已撤销发布，考试退回草稿');
      fetchExams();
    } catch (err: any) {
      message.error(err.response?.data?.message || '撤销失败');
    }
  };

  // 强制结束
  const handleForceEnd = async (id: string) => {
    try {
      await api.post(`/exams/${id}/end`);
      message.success('考试已强制结束');
      fetchExams();
    } catch (err: any) {
      message.error(err.response?.data?.message || '强制结束失败');
    }
  };

  const columns: ColumnsType<Exam> = [
    { title: '名称', dataIndex: 'title', key: 'title', ellipsis: true, width: 180 },
    {
      title: '所属批次',
      key: 'batch',
      width: 160,
      render: (_: any, r: Exam) => {
        if (!r.batch) return <Tag color="default">未归属</Tag>;
        const modeLabel = r.batch.examMode === 'unified' ? '集中' : r.batch.examMode === 'flexible' ? '随到随考' : '';
        return (
          <Space size={4}>
            <span>{r.batch.name}</span>
            {modeLabel && <Tag style={{ fontSize: 10, lineHeight: '18px', padding: '0 4px' }}>{modeLabel}</Tag>}
          </Space>
        );
      },
    },
    { title: '模式', dataIndex: 'mode', key: 'mode', width: 80, render: (v: string) => modeLabels[v] },
    {
      title: '绑定试卷', key: 'paper',
      width: 140,
      ellipsis: true,
      render: (_: any, r: Exam) => (
        r.paper ? (
          <Tag color="blue">{r.paper.name}</Tag>
        ) : (
          <Tag color="default">未绑定</Tag>
        )
      ),
    },
    { title: '题目数', key: 'questions', width: 70, render: (_: any, r: Exam) => {
      // ✅ 如果绑定了试卷，显示试卷中的题目数；否则显示直接添加的题目数
      if (r.paper?._count?.paperQuestions !== undefined) {
        return r.paper._count.paperQuestions;
      }
      return r._count?.examQuestions ?? 0;
    } },
    { title: '提交数', key: 'submissions', width: 70, render: (_: any, r: Exam) => r._count?.submissions ?? 0 },
    { title: '总分', dataIndex: 'totalScore', key: 'totalScore', width: 60 },
    {
      title: '时间场次',
      key: 'timeSlot',
      width: 180,
      render: (_: any, r: Exam) => formatTimeSlot(r),
    },
    {
      title: '考场设置',
      key: 'rooms',
      width: 100,
      ellipsis: true,
      render: (_: any, r: Exam) => formatRoomSettings(r),
    },
    {
      title: '考生数量',
      key: 'studentCount',
      width: 70,
      render: (_: any, r: Exam) => countAssignedStudents(r),
    },
    {
      title: '创建人',
      key: 'creator',
      width: 80,
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
      width: 130,
      render: (v: string, record: Exam) => {
        // published 状态根据时间动态显示，避免已过期的考试仍显示"已发布（待考）"
        // - endTime 已过 → 已过期未开考（红色，提示教师需关注）
        // - startTime 在未来 → 已排期待开考（青色，与 scheduled 一致）
        // - 其他（含 null，如随到随考）→ 已发布（待考）（蓝色，原样）
        if (v === 'published') {
          const now = dayjs();
          if (record.endTime && dayjs(record.endTime).isBefore(now)) {
            return <Tag color="red">已过期未开考</Tag>;
          }
          if (record.startTime && dayjs(record.startTime).isAfter(now)) {
            return <Tag color="cyan">已排期待开考</Tag>;
          }
          return <Tag color="blue">已发布（待考）</Tag>;
        }
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions', width: 400, fixed: 'right', render: (_: any, r: Exam) => {
        const owner = isOwner(r);
        const notOwnerTip = '仅支持本人创建的考试';
        const edit = examEditGuard(r.status, owner);
        return (
          <Space>
            <Tooltip title={edit.tip}>
              <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/edit`)} disabled={edit.disabled}>编辑</Button>
            </Tooltip>
            <Tooltip title="查看考试详情">
              <Button size="small" icon={<EyeOutlined />} onClick={() => { setDetailExam(r); setDetailOpen(true); }}>详情</Button>
            </Tooltip>
            <Button size="small" icon={<BarChartOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}>统计</Button>
            <Tooltip title={owner ? undefined : notOwnerTip}>
              <Button size="small" icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} disabled={r.status === 'in_progress' || !owner}>删除</Button>
            </Tooltip>

            {/* 状态驱动主按钮 */}
            {r.status === 'draft' && (
              <Popconfirm
                title="确认发布考试？"
                description={r.batch?.status !== 'active' ? '注意：所属批次尚未激活，建议先激活批次' : '发布后学生即可在考试列表中查看'}
                onConfirm={() => handlePublish(r.id)}
                okText="确定发布"
                cancelText="取消"
                disabled={!owner}
              >
                <Tooltip title={owner ? undefined : notOwnerTip}>
                  <Button size="small" type="primary" icon={<SendOutlined />} disabled={!owner}>
                    发布考试
                  </Button>
                </Tooltip>
              </Popconfirm>
            )}
            {r.status === 'published' && (
              <Popconfirm
                title="确认撤销发布？"
                description="撤销后考试退回草稿状态，学生将无法查看"
                onConfirm={() => handleUnpublish(r.id)}
                okText="确定撤销"
                cancelText="取消"
                disabled={!owner}
              >
                <Tooltip title={owner ? undefined : notOwnerTip}>
                  <Button size="small" icon={<RollbackOutlined />} disabled={!owner}>
                    撤销发布
                  </Button>
                </Tooltip>
              </Popconfirm>
            )}
            {r.status === 'in_progress' && (
              <Popconfirm
                title="确认强制结束？"
                description="强制收卷后所有考生将被终止答题，考试状态变为已结束"
                onConfirm={() => handleForceEnd(r.id)}
                okText="确定结束"
                cancelText="取消"
                disabled={!owner}
              >
                <Tooltip title={owner ? undefined : notOwnerTip}>
                  <Button size="small" danger icon={<StopOutlined />} disabled={!owner}>
                    强制结束/收卷
                  </Button>
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>考试管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>创建考试</Button>
      </div>
      <Table dataSource={data.data} columns={columns} rowKey="id" loading={loading} scroll={{ x: 1600 }} pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchExams }} />
      <ExamConfigWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => fetchExams()}
      />
      <ExamDetailDrawer
        exam={detailExam}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}
