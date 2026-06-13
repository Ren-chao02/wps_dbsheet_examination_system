import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Button, message, Spin } from 'antd';
import { ClockCircleOutlined, FileTextOutlined, TrophyOutlined } from '@ant-design/icons';
import api from '../../services/api';

export function ExamIntroPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.get(`/my-exams/${id}`).then(res => {
      setExam(res.data.exam);
    }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await api.post(`/my-exams/${id}/start`);
      navigate(`/student/exam/${id}/doing`);
    } catch (err: any) {
      message.error(err.response?.data?.message || '开始失败');
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!exam) return null;

  return (
    <div className="page-container" style={{ maxWidth: 700 }}>
      <Card title={exam.title}>
        <Descriptions column={1} style={{ marginBottom: 24 }}>
          <Descriptions.Item label={<><FileTextOutlined /> 题目数量</>}>
            {exam._count?.examQuestions || '—'} 题
          </Descriptions.Item>
          <Descriptions.Item label={<><TrophyOutlined /> 总分</>}>
            {exam.totalScore} 分{exam.passScore && `（及格线：${exam.passScore}分）`}
          </Descriptions.Item>
          <Descriptions.Item label={<><ClockCircleOutlined /> 考试时长</>}>
            {exam.durationMinutes ? `${exam.durationMinutes} 分钟` : '不限时'}
          </Descriptions.Item>
        </Descriptions>

        {exam.description && (
          <Card type="inner" title="考试说明" style={{ marginBottom: 24 }}>
            <div style={{ whiteSpace: 'pre-wrap' }}>{exam.description}</div>
          </Card>
        )}

        <div style={{ textAlign: 'center' }}>
          <Button type="primary" size="large" onClick={handleStart} loading={starting}>
            开始答题
          </Button>
        </div>
      </Card>
    </div>
  );
}
