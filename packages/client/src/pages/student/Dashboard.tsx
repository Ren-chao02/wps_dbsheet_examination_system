import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Tag, Button, Spin, Empty, message } from 'antd';
import { ClockCircleOutlined, FileTextOutlined, CheckCircleOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Exam } from '../../types';

interface ExamWithSubmission extends Exam {
  mySubmission: { id: string; status: string; totalScore: number | null; startedAt: string | null; submittedAt: string | null } | null;
}

export function StudentDashboard() {
  const [exams, setExams] = useState<ExamWithSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/my-exams').then(res => setExams(res.data)).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (exams.length === 0) return <Empty description="暂无考试" style={{ marginTop: 100 }} />;

  const statusMap: Record<string, { color: string; text: string }> = {
    pending: { color: 'default', text: '未开始' },
    in_progress: { color: 'processing', text: '进行中' },
    submitted: { color: 'warning', text: '待评分' },
    grading: { color: 'warning', text: '评分中' },
    graded: { color: 'success', text: '已完成' },
  };

  return (
    <div className="page-container">
      <div className="page-header"><h2>我的考试</h2></div>
      <Row gutter={[16, 16]}>
        {exams.map(exam => {
          const sub = exam.mySubmission;
          const status = sub ? statusMap[sub.status] : { color: 'default', text: '未开始' };
          return (
            <Col xs={24} sm={12} lg={8} key={exam.id}>
              <Card
                hoverable
                title={exam.title}
                extra={<Tag color={status.color}>{status.text}</Tag>}
                onClick={() => {
                  if (sub?.status === 'graded') navigate(`/student/exam/${exam.id}/result`);
                  else if (sub?.status === 'in_progress') navigate(`/student/exam/${exam.id}/doing`);
                  else navigate(`/student/exam/${exam.id}`);
                }}
              >
                <div style={{ color: '#666', marginBottom: 12, minHeight: 40 }}>
                  {exam.description || '暂无描述'}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 13, color: '#888' }}>
                  <span><FileTextOutlined /> {exam._count?.examQuestions || 0} 题</span>
                  <span>满分 {exam.totalScore} 分</span>
                  {exam.durationMinutes && <span><ClockCircleOutlined /> {exam.durationMinutes} 分钟</span>}
                </div>
                {sub?.status === 'graded' && (
                  <div style={{ marginTop: 12 }}>
                    <Tag color="blue"><CheckCircleOutlined /> 得分：{sub.totalScore}/{exam.totalScore}</Tag>
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <Button type="primary" size="small">
                    {sub?.status === 'graded' ? '查看成绩' : sub?.status === 'in_progress' ? '继续答题' : '查看详情'}
                  </Button>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
