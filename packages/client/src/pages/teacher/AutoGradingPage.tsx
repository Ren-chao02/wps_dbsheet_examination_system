/**
 * 自动阅卷 - 待批改试卷列表
 *
 * 功能：
 * - 展示所有考试的答卷列表，筛选需要批改的（submitted / grading 状态）
 * - 显示 WPS 多维表格链接信息
 * - 操作：自动阅卷（通过 API 比对判分）
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Tag,
  Space,
  message,
  Card,
  Input,
  Button,
  Modal,
  Tooltip,
  Typography,
} from 'antd';
import {
  ThunderboltOutlined,
  SearchOutlined,
  LinkOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ExpandAltOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { Exam, StudentSubmission } from '../../types';

const { Text } = Typography;

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'processing', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
};

const examStatusLabels: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'blue', text: '已发布' },
  scheduled: { color: 'cyan', text: '已排期' },
  in_progress: { color: 'processing', text: '进行中' },
  ended: { color: 'blue', text: '已结束' },
  cancelled: { color: 'red', text: '已取消' },
  archived: { color: 'orange', text: '已归档' },
};

/** 从 tableSpaceId 中提取 WPS 文件 ID，用于构造查看链接 */
function extractFileId(tableSpaceId: string | null): string | null {
  if (!tableSpaceId) return null;
  const parts = tableSpaceId.split(':');
  return parts[0] || null;
}

/** 构造 WPS 多维表格查看 URL */
function buildWpsUrl(fileId: string): string {
  return `https://www.kdocs.cn/l/${fileId}`;
}

interface ExamWithCounts extends Exam {
  submittedCount: number;
  gradingCount: number;
  gradedCount: number;
  totalSubmissions: number;
}

export function AutoGradingPage() {
  const navigate = useNavigate();
  const { wpsToken } = useAuthStore();
  const [exams, setExams] = useState<ExamWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // 展开的考试 ID
  const [expandedExamId, setExpandedExamId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  // WPS 表格分配映射：studentId -> fileId（当 tableSpaceId 为空时回退使用）
  const [wpsAssignMap, setWpsAssignMap] = useState<Map<string, string>>(new Map());

  // 自动阅卷 loading 状态
  const [autoGradingIds, setAutoGradingIds] = useState<Set<string>>(new Set());

  const fetchExams = async (page = 1, searchVal = '') => {
    setLoading(true);
    try {
      const res = await api.get(
        `/exams?page=${page}&pageSize=50${searchVal ? `&search=${searchVal}` : ''}`
      );
      const examList: Exam[] = res.data.data || [];

      // 获取每个考试的答卷统计
      const examsWithCounts: ExamWithCounts[] = [];
      for (const exam of examList) {
        try {
          const subRes = await api.get(`/exams/${exam.id}/submissions`);
          const subs: StudentSubmission[] = subRes.data || [];
          examsWithCounts.push({
            ...exam,
            totalSubmissions: subs.length,
            submittedCount: subs.filter((s) => s.status === 'submitted').length,
            gradingCount: subs.filter((s) => s.status === 'grading').length,
            gradedCount: subs.filter((s) => s.status === 'graded').length,
          });
        } catch {
          examsWithCounts.push({
            ...exam,
            totalSubmissions: 0,
            submittedCount: 0,
            gradingCount: 0,
            gradedCount: 0,
          });
        }
      }
      setExams(examsWithCounts);
    } catch {
      message.error('加载考试列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, []);

  // 展开考试，加载答卷列表
  const loadSubmissions = async (examId: string) => {
    if (expandedExamId === examId) {
      setExpandedExamId(null);
      return;
    }
    setExpandedExamId(examId);
    setSubmissionsLoading(true);
    try {
      const [subRes, assignRes] = await Promise.all([
        api.get(`/exams/${examId}/submissions`),
        api.get(`/exam-table-assignments/${examId}`).catch(() => ({ data: { assignments: [] } })),
      ]);
      const allSubs: StudentSubmission[] = subRes.data || [];
      // 构建 studentId -> fileId 映射
      const assignMap = new Map<string, string>();
      const assignments: any[] = assignRes.data?.assignments || [];
      for (const a of assignments) {
        assignMap.set(a.studentId, a.fileId);
      }
      setWpsAssignMap(assignMap);
      // 只显示需要批改的：submitted 和 grading 状态
      const needGrading = allSubs.filter(
        (s) => s.status === 'submitted' || s.status === 'grading'
      );
      setSubmissions(needGrading);
    } catch {
      message.error('加载答卷列表失败');
    } finally {
      setSubmissionsLoading(false);
    }
  };

  // 自动阅卷
  const handleAutoGrade = async (submission: StudentSubmission) => {
    if (!wpsToken?.accessToken) {
      message.warning('未配置 WPS access_token，请先在「WPS Token 管理」中手动回填');
      return;
    }
    setAutoGradingIds((prev) => new Set(prev).add(submission.id));
    try {
      const res = await api.post(`/grading/${submission.id}`, {
        accessToken: wpsToken?.accessToken,
      });
      message.success(res.data.message || '自动阅卷完成');

      // 刷新列表
      if (expandedExamId) {
        await loadSubmissions(expandedExamId);
      }
      // 更新考试统计数据
      await fetchExams(1, search);
    } catch (err: any) {
      message.error(err.response?.data?.message || '自动阅卷失败');
    } finally {
      setAutoGradingIds((prev) => {
        const next = new Set(prev);
        next.delete(submission.id);
        return next;
      });
    }
  };

  // 批量自动阅卷（对某场考试所有待批改答卷）
  const handleBatchAutoGrade = async (examId: string) => {
    if (!wpsToken?.accessToken) {
      message.warning('未配置 WPS access_token，请先在「WPS Token 管理」中手动回填');
      return;
    }
    Modal.confirm({
      title: '确认批量自动阅卷',
      icon: <ExclamationCircleOutlined />,
      content: '将对该考试所有已提交和评分中的答卷执行自动阅卷，确定继续？',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await api.post(`/grading/batch/${examId}`, {
            accessToken: wpsToken?.accessToken,
          });
          message.success(res.data.message || '批量阅卷完成');
          if (expandedExamId === examId) {
            await loadSubmissions(examId);
          }
          await fetchExams(1, search);
        } catch (err: any) {
          message.error(err.response?.data?.message || '操作失败');
        }
      },
    });
  };

  // 考试列表列定义
  const examColumns = [
    {
      title: '考试名称',
      dataIndex: 'title',
      key: 'title',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const s = examStatusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '答卷统计',
      key: 'submissionStats',
      width: 300,
      render: (_: any, r: ExamWithCounts) => (
        <Space size="small" wrap>
          <Tag color="warning">待批改 {r.submittedCount + r.gradingCount}</Tag>
          <Tag color="success">已评分 {r.gradedCount}</Tag>
          <Tag>总计 {r.totalSubmissions}</Tag>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: any, r: ExamWithCounts) => (
        <Space>
          <Button
            size="small"
            type={expandedExamId === r.id ? 'default' : 'primary'}
            icon={<ExpandAltOutlined />}
            onClick={() => loadSubmissions(r.id)}
          >
            {expandedExamId === r.id ? '收起详情' : '查看答卷'}
          </Button>
          {(r.submittedCount > 0 || r.gradingCount > 0) && (
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => handleBatchAutoGrade(r.id)}
            >
              批量自动阅卷
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // 答卷详情列定义
  const submissionColumns = [
    {
      title: '学生',
      key: 'student',
      render: (_: any, r: StudentSubmission) =>
        r.student?.realName || r.student?.username || '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => {
        const s = statusMap[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: 'WPS 多维表格链接',
      key: 'tableConnection',
      width: 200,
      render: (_: any, r: StudentSubmission) => {
        let fileId = extractFileId(r.tableSpaceId);
        if (!fileId) {
          fileId = wpsAssignMap.get(r.studentId) || null;
        }
        if (!fileId) {
          return <Text type="secondary">—</Text>;
        }
        const url = buildWpsUrl(fileId);
        return (
          <Tooltip title={`文件ID: ${fileId}`}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <LinkOutlined /> 查看表格
            </a>
          </Tooltip>
        );
      },
    },
    {
      title: '提交时间',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      width: 170,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('zh-CN') : '—',
    },
    {
      title: '当前得分',
      dataIndex: 'totalScore',
      key: 'totalScore',
      width: 100,
      render: (v: number | null) => (v !== null ? v : '—'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      render: (_: any, r: StudentSubmission) => (
        <Space>
          {(r.status === 'submitted' || r.status === 'grading') && (
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={autoGradingIds.has(r.id)}
              onClick={() => handleAutoGrade(r)}
            >
              自动阅卷
            </Button>
          )}
          {r.status === 'grading' && (
            <Button
              size="small"
              onClick={() => navigate(`/teacher/grading/${expandedExamId}`)}
            >
              人工复核
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // 待批改总数
  const totalNeedGrading = exams.reduce(
    (sum, e) => sum + e.submittedCount + e.gradingCount,
    0
  );

  return (
    <div className="page-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h2>
          自动阅卷
          {totalNeedGrading > 0 && (
            <Tag color="warning" style={{ marginLeft: 12 }}>
              待批改 {totalNeedGrading} 份
            </Tag>
          )}
        </h2>
        <Input
          placeholder="搜索考试名称"
          prefix={<SearchOutlined />}
          style={{ width: 250 }}
          allowClear
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={() => fetchExams(1, search)}
        />
      </div>

      <Card>
        <Table
          dataSource={exams}
          columns={examColumns}
          rowKey="id"
          loading={loading}
          pagination={false}
          expandable={{
            expandedRowRender: (record) => {
              if (expandedExamId !== record.id) return null;
              return (
                <div style={{ padding: '8px 0' }}>
                  {submissionsLoading ? (
                    <div style={{ textAlign: 'center', padding: 24 }}>加载中...</div>
                  ) : submissions.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: 24,
                        color: '#999',
                      }}
                    >
                      <CheckCircleOutlined style={{ fontSize: 20, marginRight: 8 }} />
                      暂无待批改答卷
                    </div>
                  ) : (
                    <Table
                      dataSource={submissions}
                      columns={submissionColumns}
                      rowKey="id"
                      pagination={false}
                      size="small"
                    />
                  )}
                </div>
              );
            },
            expandedRowKeys: [expandedExamId].filter(Boolean) as string[],
            onExpand: (expanded, record) => {
              if (expanded) {
                loadSubmissions(record.id);
              } else {
                setExpandedExamId(null);
              }
            },
            showExpandColumn: false,
          }}
        />
      </Card>
    </div>
  );
}
