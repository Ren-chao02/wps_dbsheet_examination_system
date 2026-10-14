import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Statistic, Row, Col, Collapse, Tag, Spin, Empty, message, Result, Tooltip, Button, Typography, Space } from 'antd';
import { TrophyOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { StudentSubmission } from '../../types';
import { friendlyRuleMessage } from '../../utils/rule-message';

const { Title } = Typography;

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

export function ExamResultPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  // 加载失败不再是死路：给「重试」与「返回我的考试」出口
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    setLoadError(false);
    api
      .get(`/my-exams/${id}/result`)
      .then((res) => setSubmission(res.data))
      .catch(() => {
        setLoadError(true);
        message.error('成绩加载失败，请重试');
      })
      .finally(() => setLoading(false));
  }, [id, reloadTick]);

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  // 加载失败：错误态 + 重试 + 返回我的考试（此前是只有一行「未找到成绩」的死路）
  if (loadError) {
    return (
      <div className="page-container" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/dashboard')}>
            返回我的考试
          </Button>
          <Title level={5} style={{ margin: 0 }}>成绩详情</Title>
        </div>
        <Result
          status="error"
          title="成绩加载失败"
          subTitle="可能是网络异常，请重试；若多次失败请联系任课老师"
          extra={[
            <Button type="primary" key="retry" icon={<ReloadOutlined />} onClick={() => setReloadTick((t) => t + 1)}>
              重试
            </Button>,
            <Button key="back" onClick={() => navigate('/student/dashboard')}>
              返回我的考试
            </Button>,
          ]}
        />
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="page-container" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/student/dashboard')}>
            返回我的考试
          </Button>
          <Title level={5} style={{ margin: 0 }}>成绩详情</Title>
        </div>
        <Card>
          <Empty description="未找到成绩">
            <Space>
              <Button type="primary" onClick={() => setReloadTick((t) => t + 1)}>重试</Button>
              <Button onClick={() => navigate('/student/dashboard')}>返回我的考试</Button>
            </Space>
          </Empty>
        </Card>
      </div>
    );
  }

  // 成绩查询详情页（/student/exam/:id/result）的返回按钮：
  // 已出分 -> 回到「成绩查询」列表；刚交卷未出分 -> 回到「我的考试」（可看到"已提交"状态）
  const handleBack = () =>
    navigate(submission.status === 'graded' ? '/student/history' : '/student/dashboard');

  const backHeader = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={handleBack}>
        返回
      </Button>
      <Title level={5} style={{ margin: 0 }}>成绩详情</Title>
    </div>
  );

  if (submission.status !== 'graded') {
    return (
      <div className="page-container" style={{ maxWidth: 900 }}>
        {backHeader}
        <Card>
          <Result
            icon={<TrophyOutlined />}
            title="答卷已提交"
            subTitle="请等待教师完成评分后查看成绩"
          />
        </Card>
      </div>
    );
  }

  const passed = submission.exam?.passScore ? (submission.totalScore ?? 0) >= submission.exam.passScore : null;

  return (
    <div className="page-container" style={{ maxWidth: 900 }}>
      {backHeader}
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
          items={(submission.details || []).map((detail, i) => {
            const vrs = detail.verificationResults || [];
            const passedCount = vrs.filter(vr => vr.passed && !vr.needsReview).length;
            const failedCount = vrs.filter(vr => !vr.passed && !vr.needsReview).length;

            return {
              key: detail.id,
              label: (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
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
                  <p><strong>得分：</strong>{detail.score}/{detail.question?.score}</p>

                  {vrs.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <strong style={{ display: 'block', marginBottom: 8 }}>判分详情：</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {vrs.map(vr => (
                          <Tooltip
                            key={vr.id}
                            // 缺表类错误翻成人话（"先去建这张表"）；其余 message 原样展示
                            title={friendlyRuleMessage(vr.errorMessage) || `${actionLabels[vr.action] || vr.action}`}
                          >
                            <Tag
                              color={vr.needsReview ? 'warning' : vr.passed ? 'success' : 'error'}
                              style={{ marginBottom: 4 }}
                            >
                              {actionLabels[vr.action] || vr.action}
                              {vr.needsReview ? (
                                <><ExclamationCircleOutlined /> 待复核</>
                              ) : vr.passed ? (
                                <> ✓ ({vr.score}分)</>
                              ) : (
                                <> ✗ (0分)</>
                              )}
                            </Tag>
                          </Tooltip>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                        通过 {passedCount} 项，未通过 {failedCount} 项
                      </div>
                    </div>
                  )}
                </div>
              ),
            };
          })}
        />
      </Card>
    </div>
  );
}
