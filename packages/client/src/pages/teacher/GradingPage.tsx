import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Table, Button, Drawer, InputNumber, Tag, message, Space, Card, Descriptions, Divider, Alert, Spin, Tooltip, Collapse } from 'antd';
import { CheckOutlined, CloseOutlined, ThunderboltOutlined, EyeOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { StudentSubmission, SubmissionDetail, VerificationResult } from '../../types';

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'processing', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
};

const actionLabels: Record<string, string> = {
  check_table_exists: '表存在',
  check_table_name: '表名称',
  check_table_count: '表数量',
  check_field: '字段检查',
  check_field_count: '字段数量',
  check_field_required: '必填设置',
  check_field_formula: '公式字段',
  check_linked_record: '关联记录',
  check_view_exists: '视图存在',
  check_view_type: '视图类型',
  check_view_filter: '视图筛选',
  check_view_sort: '视图排序',
  check_view_group: '视图分组',
  check_form_exists: '表单存在',
  check_form_fields: '表单字段',
  check_form_settings: '表单设置',
  check_record_exists: '记录存在',
  check_record_value: '记录值',
  check_record_count: '记录数量',
};

export function GradingPage() {
  const { id } = useParams<{ id: string }>();
  const [submissions, setSubmissions] = useState<StudentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<StudentSubmission | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [corrects, setCorrects] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [autoGrading, setAutoGrading] = useState(false);
  const [gradingResult, setGradingResult] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/exams/${id}/submissions`);
      setSubmissions(res.data);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  const openGrading = async (submission: StudentSubmission) => {
    try {
      const res = await api.get(`/grading/${submission.id}`);
      const detail = res.data;
      setSelected(detail);
      const newScores: Record<string, number> = {};
      const newCorrects: Record<string, boolean> = {};
      (detail.details || []).forEach((d: SubmissionDetail) => {
        if (d.score !== null) newScores[d.id] = d.score;
        if (d.isCorrect !== null) newCorrects[d.id] = d.isCorrect;
      });
      setScores(newScores);
      setCorrects(newCorrects);
      setGradingResult(null);
      setDrawerOpen(true);
    } catch { message.error('加载详情失败'); }
  };

  const triggerAutoGrading = async (submission: StudentSubmission) => {
    setAutoGrading(true);
    try {
      const res = await api.post(`/grading/${submission.id}`);
      setGradingResult(res.data);
      message.success(res.data.message || '自动判分完成');
      // 重新加载详情
      await openGrading(submission);
      fetchData();
    } catch (err: any) {
      message.error(err.response?.data?.message || '自动判分失败');
    } finally { setAutoGrading(false); }
  };

  const handleMark = async (detailId: string) => {
    await api.post(`/grading/${selected!.id}/detail/${detailId}`, {
      score: scores[detailId] ?? 0,
      isCorrect: corrects[detailId] ?? false,
    });
  };

  const handleReviewRule = async (detailId: string, ruleId: string, passed: boolean, score: number) => {
    try {
      await api.post(`/grading/${selected!.id}/review/${detailId}`, { ruleId, passed, score });
      message.success('复核完成');
      // 刷新
      if (selected) await openGrading(selected as any);
    } catch (err: any) {
      message.error(err.response?.data?.message || '复核失败');
    }
  };

  const markAll = async () => {
    setSaving(true);
    try {
      const details = selected?.details || [];
      await Promise.all(details.map(d => handleMark(d.id)));
      message.success('已保存');
    } catch { message.error('保存失败'); } finally { setSaving(false); }
  };

  const finalizeGrading = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await markAll();
      await api.post(`/grading/${selected.id}/finalize`, { comment: '' });
      message.success('评分完成');
      setDrawerOpen(false);
      fetchData();
    } catch (err: any) { message.error(err.response?.data?.message || '操作失败'); } finally { setSaving(false); }
  };

  // Count needsReview across all details
  const totalNeedsReview = selected?.details?.reduce(
    (sum, d) => sum + (d.verificationResults?.filter(vr => vr.needsReview).length || 0), 0
  ) || 0;

  const columns = [
    { title: '学生', key: 'student', render: (_: any, r: any) => r.student?.realName || r.student?.username || '—' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = statusMap[v] || { color: 'default', text: v }; return <Tag color={s.color}>{s.text}</Tag>; } },
    { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
    { title: '得分', dataIndex: 'totalScore', key: 'totalScore', render: (v: number | null) => v !== null ? v : '—' },
    {
      title: '操作', key: 'actions', render: (_: any, r: StudentSubmission) => (
        <Space>
          {r.status === 'submitted' && (
            <Space>
              <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => triggerAutoGrading(r)} loading={autoGrading}>自动判分</Button>
              <Button size="small" onClick={() => openGrading(r)}>手动评分</Button>
            </Space>
          )}
          {r.status === 'grading' && (
            <Space>
              <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={() => triggerAutoGrading(r)} loading={autoGrading}>重新判分</Button>
              <Button size="small" onClick={() => openGrading(r)}>继续评分</Button>
            </Space>
          )}
          {r.status === 'graded' && (
            <Button size="small" onClick={() => openGrading(r)}>查看详情</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>阅卷</h2>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={async () => {
          try {
            const res = await api.post(`/grading/batch/${id}`);
            message.success(res.data.message || '批量判分完成');
            fetchData();
          } catch (err: any) { message.error(err.response?.data?.message || '操作失败'); }
        }}>批量自动判分</Button>
      </div>

      <Table dataSource={submissions} columns={columns} rowKey="id" loading={loading} pagination={false} />

      <Drawer
        title="评分详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={750}
        extra={
          <Space>
            <Button onClick={markAll} loading={saving}>保存评分</Button>
            <Button type="primary" onClick={finalizeGrading} loading={saving}>完成评分</Button>
          </Space>
        }
      >
        {selected && (
          <>
            <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="学生">{selected.student?.realName || selected.student?.username}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={statusMap[selected.status]?.color}>{statusMap[selected.status]?.text}</Tag></Descriptions.Item>
              {selected.totalScore !== null && (
                <Descriptions.Item label="总分">{selected.totalScore}</Descriptions.Item>
              )}
            </Descriptions>

            {totalNeedsReview > 0 && (
              <Alert
                type="warning"
                showIcon
                icon={<ExclamationCircleOutlined />}
                message={`有 ${totalNeedsReview} 条规则需要人工复核`}
                description={'标记为「需复核」的规则无法自动判分，请教师根据实际情况手动确认。'}
                style={{ marginBottom: 16 }}
              />
            )}

            <Divider />

            {(selected.details || []).map((detail: SubmissionDetail, i: number) => {
              const vrs = detail.verificationResults || [];
              const hasAutoResults = vrs.length > 0;
              const needsReviewItems = vrs.filter(vr => vr.needsReview);
              const passedCount = vrs.filter(vr => vr.passed && !vr.needsReview).length;
              const failedCount = vrs.filter(vr => !vr.passed && !vr.needsReview).length;

              return (
                <Card
                  key={detail.id}
                  size="small"
                  style={{ marginBottom: 12 }}
                  title={
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span>第 {i + 1} 题：{detail.question?.title || ''}</span>
                      {hasAutoResults && (
                        <Space size={4}>
                          {passedCount > 0 && <Tag color="success">{passedCount} 通过</Tag>}
                          {failedCount > 0 && <Tag color="error">{failedCount} 未通过</Tag>}
                          {needsReviewItems.length > 0 && <Tag color="warning">{needsReviewItems.length} 待复核</Tag>}
                        </Space>
                      )}
                    </div>
                  }
                >
                  <p><strong>类型：</strong>{detail.question?.type} &nbsp; <strong>满分：</strong>{detail.question?.score}</p>

                  {/* 自动判分结果 */}
                  {hasAutoResults && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ThunderboltOutlined style={{ color: '#1890ff' }} /> 自动验证结果
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                        {vrs.map(vr => (
                          <Tooltip
                            key={vr.id}
                            title={
                              <div style={{ fontSize: 12 }}>
                                <div>期望: {JSON.stringify(vr.expected)}</div>
                                <div>实际: {JSON.stringify(vr.actual)}</div>
                                {vr.errorMessage && <div style={{ color: '#ff7875' }}>{vr.errorMessage}</div>}
                              </div>
                            }
                          >
                            <Tag
                              color={vr.needsReview ? 'warning' : vr.passed ? 'success' : 'error'}
                              style={{ cursor: 'pointer' }}
                            >
                              {actionLabels[vr.action] || vr.action}
                              {vr.needsReview ? ' ⚠' : vr.passed ? ' ✓' : ' ✗'}
                              ({vr.score}/{vr.score > 0 ? vr.score : 0}分)
                            </Tag>
                          </Tooltip>
                        ))}
                      </div>

                      {/* needsReview 复核区域 */}
                      {needsReviewItems.length > 0 && (
                        <Collapse
                          size="small"
                          items={needsReviewItems.map(vr => ({
                            key: vr.id,
                            label: (
                              <span>
                                <ExclamationCircleOutlined style={{ color: '#faad14', marginRight: 8 }} />
                                {actionLabels[vr.action] || vr.action} — {vr.errorMessage || '需人工确认'}
                              </span>
                            ),
                            children: (
                              <div>
                                <p style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                                  <strong>期望：</strong>{JSON.stringify(vr.expected)}
                                </p>
                                <Space>
                                  <Button
                                    size="small"
                                    type="primary"
                                    icon={<CheckOutlined />}
                                    onClick={() => handleReviewRule(detail.id, vr.ruleId, true, vr.score || 0)}
                                  >
                                    确认通过 (+{vr.score || 0}分)
                                  </Button>
                                  <Button
                                    size="small"
                                    danger
                                    icon={<CloseOutlined />}
                                    onClick={() => handleReviewRule(detail.id, vr.ruleId, false, 0)}
                                  >
                                    确认不通过
                                  </Button>
                                </Space>
                              </div>
                            ),
                          }))}
                        />
                      )}
                    </div>
                  )}

                  <Divider style={{ margin: '12px 0' }} />

                  {/* 手动评分覆盖 */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div>
                      <span style={{ marginRight: 8 }}>得分：</span>
                      <InputNumber
                        min={0}
                        max={detail.question?.score || 100}
                        value={scores[detail.id] ?? undefined}
                        onChange={v => setScores(s => ({ ...s, [detail.id]: v || 0 }))}
                        style={{ width: 100 }}
                      />
                    </div>
                    <div>
                      <span style={{ marginRight: 8 }}>判对：</span>
                      <Button
                        type={corrects[detail.id] ? 'primary' : 'default'}
                        icon={corrects[detail.id] ? <CheckOutlined /> : <CloseOutlined />}
                        onClick={() => setCorrects(c => ({ ...c, [detail.id]: !c[detail.id] }))}
                        danger={corrects[detail.id] === false}
                      />
                    </div>
                    <Button size="small" onClick={() => handleMark(detail.id)}>保存</Button>
                  </div>
                </Card>
              );
            })}
          </>
        )}
      </Drawer>
    </div>
  );
}
