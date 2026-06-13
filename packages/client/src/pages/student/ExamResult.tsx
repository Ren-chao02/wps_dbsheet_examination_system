import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Statistic, Row, Col, Collapse, Tag, Spin, Empty, message, Result } from 'antd';
import { TrophyOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { StudentSubmission } from '../../types';

export function ExamResultPage() {
  const { id } = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/my-exams/${id}/result`).then(res => setSubmission(res.data)).catch(() => message.error('加载失败')).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  if (!submission) return <Empty description="未找到成绩" />;

  if (submission.status !== 'graded') {
    return (
      <Result
        icon={<TrophyOutlined />}
        title="答卷已提交"
        subTitle="请等待教师完成评分后查看成绩"
      />
    );
  }

  const passed = submission.exam?.passScore ? (submission.totalScore ?? 0) >= submission.exam.passScore : null;

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      <Card>
        <Result
          status={passed ? 'success' : 'error'}
          title={submission.exam?.title}
          subTitle={passed !== null ? (passed ? '恭喜通过！' : '未通过，继续加油！') : undefined}
        />
        <Row gutter={24} justify="center" style={{ marginBottom: 32 }}>
          <Col><Statistic title="总分" value={submission.totalScore ?? 0} suffix={`/ ${submission.exam?.totalScore}`} prefix={<TrophyOutlined />} /></Col>
          {submission.exam?.passScore !== null && (
            <Col><Statistic title="及格线" value={submission.exam?.passScore} /></Col>
          )}
        </Row>

        {submission.graderComment && (
          <Card type="inner" title="教师评语" style={{ marginBottom: 24, background: '#f6ffed' }}>
            {submission.graderComment}
          </Card>
        )}

        <Collapse
          items={(submission.details || []).map((detail, i) => ({
            key: detail.id,
            label: (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>第 {i + 1} 题：{detail.question?.title}</span>
                <span>
                  {detail.isCorrect !== null && (
                    <Tag icon={detail.isCorrect ? <CheckCircleOutlined /> : <CloseCircleOutlined />} color={detail.isCorrect ? 'success' : 'error'}>
                      {detail.score}/{detail.question?.score}分
                    </Tag>
                  )}
                </span>
              </div>
            ),
            children: (
              <div>
                <p><strong>题目类型：</strong>{detail.question?.type}</p>
                <p><strong>得分：</strong>{detail.score}/{detail.question?.score}</p>
                {detail.verificationResults && detail.verificationResults.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <strong>判分详情：</strong>
                    {detail.verificationResults.map(vr => (
                      <Tag key={vr.id} color={vr.passed ? 'success' : 'error'} style={{ marginBottom: 4 }}>
                        {vr.action}: {vr.passed ? '✓' : '✗'} ({vr.score}分)
                        {vr.errorMessage && ` — ${vr.errorMessage}`}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
            ),
          }))}
        />
      </Card>
    </div>
  );
}
