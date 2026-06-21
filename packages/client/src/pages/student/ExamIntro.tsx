import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Descriptions, Button, message, Spin, Checkbox, Modal } from 'antd';
import { ClockCircleOutlined, FileTextOutlined, TrophyOutlined } from '@ant-design/icons';
import api from '../../services/api';

export function ExamIntroPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [exam, setExam] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    api
      .get(`/my-exams/${id}`)
      .then((res) => setExam(res.data.exam))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleStart = async () => {
    if (!agreed) {
      message.warning('请先阅读并同意考试规则');
      return;
    }

    Modal.confirm({
      title: '确认开始考试',
      content: '开始后计时器将启动，请确保环境安静、网络稳定。',
      okText: '确认开始',
      cancelText: '取消',
      onOk: async () => {
        const settings = exam?.settings || {};
        if (settings.requiresWpsTable) {
          navigate(`/student/exam/${id}/wps`);
        } else {
          setStarting(true);
          try {
            await api.post(`/my-exams/${id}/start`);
            navigate(`/student/exam/${id}/doing`);
          } catch (err: any) {
            message.error(err.response?.data?.message || '开始失败');
          } finally {
            setStarting(false);
          }
        }
      },
    });
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

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

        <div
          style={{
            marginBottom: 24,
            padding: 16,
            background: '#f6ffed',
            borderRadius: 8,
            border: '1px solid #b7eb8f',
          }}
        >
          <h4 style={{ marginTop: 0 }}>考试规则</h4>
          <ul style={{ paddingLeft: 20, marginBottom: 12 }}>
            <li>考试期间请勿切换屏幕或离开考试页面；</li>
            <li>考试时间结束后系统将自动提交答卷；</li>
            <li>操作题答案请保存至考生文件夹，否则可能影响评分。</li>
          </ul>
          <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)}>
            我已阅读并同意遵守考试规则
          </Checkbox>
        </div>

        <div style={{ textAlign: 'center' }}>
          <Button type="primary" size="large" onClick={handleStart} loading={starting}>
            开始答题
          </Button>
        </div>
      </Card>
    </div>
  );
}
