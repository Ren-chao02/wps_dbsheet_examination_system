import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Button, Steps, message, Spin, Space, Tag, Modal } from 'antd';
import { ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, SendOutlined } from '@ant-design/icons';
import api from '../../services/api';

interface PracticeQuestion {
  id: string;
  questionId: string;
  sortOrder: number;
  score: number;
  question: {
    id: string;
    title: string;
    description: string | null;
    type: string;
    difficulty: string;
    score: number;
    hints: string | null;
  };
}

export function PracticeDoing() {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [paperName, setPaperName] = useState('');
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [startTime] = useState(new Date());
  const [showResult, setShowResult] = useState(false);
  const [resultData, setResultData] = useState<any>(null);

  useEffect(() => {
    if (!paperId) return;
    api.get(`/papers/${paperId}`).then(res => {
      setPaperName(res.data.name);
      if (res.data.paperQuestions) {
        setQuestions(res.data.paperQuestions);
      }
      setLoading(false);
    }).catch(() => {
      message.error('加载试卷失败');
      setLoading(false);
    });
  }, [paperId]);

  const currentQ = questions[currentIndex];

  const handleAnswerChange = (questionId: string, answer: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const handleSubmit = async () => {
    if (Object.keys(answers).length < questions.length) {
      Modal.confirm({
        title: '确认提交',
        content: `您还有 ${questions.length - Object.keys(answers).length} 题未作答，确定要提交吗？`,
        okText: '提交',
        cancelText: '继续答题',
        onOk: () => submitAll(),
      });
    } else {
      await submitAll();
    }
  };

  const submitAll = async () => {
    setSubmitting(true);
    try {
      // Build submission payload
      const payload = questions.map(q => ({
        questionId: q.questionId,
        answerJson: answers[q.questionId] || {},
      }));

      const res = await api.post(`/practice/submit`, {
        paperId,
        answers: payload,
      });

      setResultData(res.data);
      setShowResult(true);
      message.success('练习已提交');
    } catch (err: any) {
      message.error(err.response?.data?.message || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDuration = (start: Date) => {
    const diff = Math.floor((Date.now() - start.getTime()) / 1000);
    const min = Math.floor(diff / 60);
    const sec = diff % 60;
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  if (showResult && resultData) {
    return (
      <div className="page-container" style={{ maxWidth: 800 }}>
        <Card>
          <div style={{ textAlign: 'center' }}>
            <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a' }} />
            <h2>练习完成！</h2>
            <p>{paperName}</p>
            <Space direction="vertical" size="middle" style={{ margin: '24px 0' }}>
              <Tag color="blue" style={{ fontSize: 16, padding: '4px 16px' }}>
                得分：{resultData.totalScore ?? 0} / {resultData.maxScore ?? questions.reduce((s, q) => s + q.score, 0)}
              </Tag>
              <Tag color={resultData.passed ? 'green' : 'red'} style={{ fontSize: 14 }}>
                {resultData.passed ? '及格' : '未及格'}
              </Tag>
              <span style={{ color: '#666' }}>用时：{formatDuration(startTime)}</span>
            </Space>

            {/* Question-by-question results */}
            <Card title="答题详情" style={{ marginTop: 24, textAlign: 'left' }}>
              {questions.map((q, i) => {
                const detail = resultData.details?.find((d: any) => d.questionId === q.questionId);
                return (
                  <Card key={q.id} size="small" style={{ marginBottom: 8, borderLeft: detail?.isCorrect ? '4px solid #52c41a' : '4px solid #ff4d4f' }}>
                    <strong>{i + 1}. {q.question.title}</strong>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <Tag color={detail?.isCorrect ? 'green' : 'red'}>
                        {detail?.isCorrect ? `+${detail.score}` : '+0'} 分
                      </Tag>
                      <span style={{ color: '#999' }}>满分 {q.score} 分</span>
                    </div>
                  </Card>
                );
              })}
            </Card>

            <div style={{ marginTop: 24 }}>
              <Button onClick={() => navigate('/student/practice')}>返回题库</Button>
              <Button type="primary" onClick={() => { window.location.reload(); }} style={{ marginLeft: 12 }}>再练一次</Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/practice')}>返回</Button>
          <h3>{paperName}</h3>
          <Tag icon={<ClockCircleOutlined />}>{formatDuration(startTime)}</Tag>
        </Space>
        <Space>
          <span style={{ color: '#888' }}>{currentIndex + 1} / {questions.length}</span>
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={submitting}
            onClick={handleSubmit}
          >
            提交练习
          </Button>
        </Space>
      </div>

      {/* Progress steps */}
      <Steps
        size="small"
        current={currentIndex}
        onChange={(step) => setCurrentIndex(step)}
        items={questions.map((q, i) => ({
          title: `第${i + 1}题`,
          status: answers[q.questionId] ? 'finish' : 'wait',
        }))}
        style={{ marginBottom: 16 }}
      />

      {currentQ ? (
        <Card key={currentQ.questionId}>
          <div style={{ marginBottom: 12 }}>
            <Tag color="blue">第 {currentIndex + 1} 题</Tag>
            <Tag>{currentQ.question.type}</Tag>
            <Tag color={currentQ.question.difficulty === 'easy' ? 'green' : currentQ.question.difficulty === 'medium' ? 'blue' : 'red'}>
              {currentQ.question.difficulty === 'easy' ? '简单' : currentQ.question.difficulty === 'medium' ? '中等' : '困难'}
            </Tag>
            <span style={{ float: 'right', fontWeight: 'bold', color: '#1890ff' }}>{currentQ.score} 分</span>
          </div>
          <h3 style={{ marginBottom: 8 }}>{currentQ.question.title}</h3>
          {currentQ.question.description && (
            <div style={{ color: '#666', marginBottom: 16, whiteSpace: 'pre-wrap' }}>
              {currentQ.question.description}
            </div>
          )}

          {/* Answer area - simplified for practice */}
          <div style={{ background: '#fafafa', padding: 16, borderRadius: 4, border: '1px dashed #d9d9d9' }}>
            <h4>答题区域</h4>
            <textarea
              placeholder="请在此输入您的答案或操作说明..."
              value={answers[currentQ.questionId]?.text || ''}
              onChange={e => handleAnswerChange(currentQ.questionId, { text: e.target.value })}
              style={{
                width: '100%',
                minHeight: 120,
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                padding: 8,
                fontFamily: 'inherit',
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <Button disabled={currentIndex === 0} onClick={() => setCurrentIndex(i => i - 1)}>
              上一题
            </Button>
            <Button
              type="primary"
              disabled={currentIndex >= questions.length - 1}
              onClick={() => setCurrentIndex(i => i + 1)}
            >
              下一题
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
