import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Table, Button, Drawer, InputNumber, Tag, message, Space, Card, Descriptions, Divider } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { StudentSubmission, SubmissionDetail } from '../../types';

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '答题中' },
  submitted: { color: 'warning', text: '已提交' },
  grading: { color: 'warning', text: '评分中' },
  graded: { color: 'success', text: '已评分' },
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
      // Initialize scores from existing data
      const newScores: Record<string, number> = {};
      const newCorrects: Record<string, boolean> = {};
      (detail.details || []).forEach((d: SubmissionDetail) => {
        if (d.score !== null) newScores[d.id] = d.score;
        if (d.isCorrect !== null) newCorrects[d.id] = d.isCorrect;
      });
      setScores(newScores);
      setCorrects(newCorrects);
      setDrawerOpen(true);
    } catch { message.error('加载详情失败'); }
  };

  const handleMark = async (detailId: string) => {
    await api.post(`/grading/${selected!.id}/detail/${detailId}`, {
      score: scores[detailId] ?? 0,
      isCorrect: corrects[detailId] ?? false,
    });
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

  const columns = [
    { title: '学生', key: 'student', render: (_: any, r: any) => r.student?.realName || r.student?.username || '—' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => { const s = statusMap[v] || { color: 'default', text: v }; return <Tag color={s.color}>{s.text}</Tag>; } },
    { title: '提交时间', dataIndex: 'submittedAt', key: 'submittedAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '—' },
    { title: '得分', dataIndex: 'totalScore', key: 'totalScore', render: (v: number | null) => v !== null ? v : '—' },
    {
      title: '操作', key: 'actions', render: (_: any, r: StudentSubmission) => (
        <Space>
          {r.status === 'submitted' && (
            <Button size="small" type="primary" onClick={async () => {
              await api.post(`/grading/${r.id}`);
              openGrading(r);
            }}>开始评分</Button>
          )}
          {(r.status === 'grading' || r.status === 'graded') && (
            <Button size="small" onClick={() => openGrading(r)}>{r.status === 'graded' ? '查看详情' : '继续评分'}</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>阅卷</h2>
        <Button onClick={async () => {
          try { await api.post(`/grading/batch/${id}`); message.success('已批量开始评分'); fetchData(); }
          catch (err: any) { message.error(err.response?.data?.message || '操作失败'); }
        }}>批量开始评分</Button>
      </div>

      <Table dataSource={submissions} columns={columns} rowKey="id" loading={loading} pagination={false} />

      <Drawer
        title="评分详情"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={700}
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
            </Descriptions>
            <Divider />
            {(selected.details || []).map((detail, i) => (
              <Card key={detail.id} size="small" style={{ marginBottom: 12 }} title={`第 ${i + 1} 题：${detail.question?.title || ''}`}>
                <p><strong>类型：</strong>{detail.question?.type}</p>
                <p><strong>满分：</strong>{detail.question?.score}</p>
                <div style={{ marginTop: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
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
                {detail.verificationResults && detail.verificationResults.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong>自动判分结果：</strong>
                    {detail.verificationResults.map(vr => (
                      <Tag key={vr.id} color={vr.passed ? 'success' : 'error'} style={{ marginBottom: 4 }}>
                        {vr.action}: {vr.passed ? '✓' : '✗'} ({vr.score}分)
                      </Tag>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </>
        )}
      </Drawer>
    </div>
  );
}
