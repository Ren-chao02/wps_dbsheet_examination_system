import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Steps, Button, Modal, message, Spin, Typography, Tag, Divider } from 'antd';
import { CheckOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Question } from '../../types';

const { Text, Paragraph } = Typography;

const typeLabels: Record<string, string> = {
  create_table: '建表', add_field: '字段', config_view: '视图', create_form: '表单', comprehensive: '综合',
};

export function ExamDoingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/my-exams/${id}`).then(res => setData(res.data)).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = () => {
    Modal.confirm({
      title: '确认提交',
      content: '提交后将无法修改，确定要提交答卷吗？',
      okText: '确认提交',
      cancelText: '再检查一下',
      onOk: async () => {
        setSubmitting(true);
        try {
          await api.post(`/my-exams/${id}/submit`);
          message.success('提交成功！');
          navigate(`/student/exam/${id}/result`);
        } catch (err: any) {
          message.error(err.response?.data?.message || '提交失败');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!data) return null;

  const questions: Question[] = data.questions || [];
  const currentQuestion = questions[currentStep];

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>{data.exam?.title || '答题'}</h2>
        <Button type="primary" danger onClick={handleSubmit} loading={submitting} icon={<CheckOutlined />}>
          提交答卷
        </Button>
      </div>

      <Steps
        current={currentStep}
        onChange={setCurrentStep}
        size="small"
        style={{ marginBottom: 24 }}
        items={questions.map((q, i) => ({ title: `第${i + 1}题` }))}
      />

      {currentQuestion && (
        <Card
          title={
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Text strong>第 {currentStep + 1} 题</Text>
              <Tag color="blue">{typeLabels[currentQuestion.type] || currentQuestion.type}</Tag>
              <Tag>{currentQuestion.difficulty === 'easy' ? '简单' : currentQuestion.difficulty === 'medium' ? '中等' : '困难'}</Tag>
              <Text type="secondary">{currentQuestion.score} 分</Text>
            </div>
          }
        >
          <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, marginBottom: 16 }}>
            {currentQuestion.description}
          </Paragraph>

          {currentQuestion.hints && (
            <Card type="inner" size="small" title="提示" style={{ marginBottom: 16, background: '#fffbe6' }}>
              <Text type="warning">{currentQuestion.hints}</Text>
            </Card>
          )}

          <Divider />

          <div style={{ background: '#f0f5ff', padding: 16, borderRadius: 8, marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              <LinkOutlined /> 操作指引
            </Text>
            <Text type="secondary">
              请打开金山多维表格，根据上述要求完成操作。完成后请确认无误再提交。
            </Text>
          </div>

          <div style={{ marginTop: 16, background: '#fafafa', padding: 16, borderRadius: 8 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              验证规则（共 {currentQuestion.answerRules.length} 项）：
            </Text>
            {currentQuestion.answerRules.map((rule, i) => (
              <Tag key={rule.id} style={{ marginBottom: 4 }}>
                {rule.action}: {JSON.stringify(rule.params).slice(0, 60)}
                {JSON.stringify(rule.params).length > 60 ? '...' : ''}
                ({rule.score}分)
              </Tag>
            ))}
          </div>
        </Card>
      )}

      <div style={{ textAlign: 'center', marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Button disabled={currentStep === 0} onClick={() => setCurrentStep(s => s - 1)}>
          上一题
        </Button>
        <Button type="primary" onClick={() => {
          if (currentStep < questions.length - 1) setCurrentStep(s => s + 1);
          else handleSubmit();
        }}>
          {currentStep < questions.length - 1 ? '下一题' : '提交答卷'}
        </Button>
      </div>
    </div>
  );
}
