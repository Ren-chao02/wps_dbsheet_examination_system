import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Select, InputNumber, Button, Card, Table, Transfer, message, Spin, Space, Row, Col } from 'antd';
import { SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Question } from '../../types';

const { TextArea } = Input;

export function ExamForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const isEdit = !!id;

  useEffect(() => {
    // Load published questions
    api.get('/questions?status=published&pageSize=100').then(res => setAllQuestions(res.data.data)).catch(() => {});
    if (isEdit) {
      setLoading(true);
      api.get(`/exams/${id}`).then(res => {
        const e = res.data;
        form.setFieldsValue({
          title: e.title,
          description: e.description,
          mode: e.mode,
          durationMinutes: e.durationMinutes,
          passScore: e.passScore,
        });
        if (e.examQuestions) {
          setSelectedKeys(e.examQuestions.map((eq: any) => eq.questionId));
        }
      }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
    }
  }, [id]);

  const onFinish = async (values: any) => {
    setSaving(true);
    try {
      const payload = { ...values };
      if (isEdit) {
        await api.put(`/exams/${id}`, payload);
        // Update questions
        await api.put(`/exams/${id}/questions`, {
          questionIds: selectedKeys.map((qid, i) => ({ questionId: qid, sortOrder: i })),
        });
        message.success('更新成功');
      } else {
        const res = await api.post('/exams', payload);
        if (selectedKeys.length > 0) {
          await api.put(`/exams/${res.data.id}/questions`, {
            questionIds: selectedKeys.map((qid, i) => ({ questionId: qid, sortOrder: i })),
          });
        }
        message.success('创建成功');
        navigate(`/teacher/exams/${res.data.id}/edit`);
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;

  return (
    <div className="page-container" style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/teacher/exams')} />
          <h2>{isEdit ? '编辑考试' : '创建考试'}</h2>
        </Space>
        <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={saving}>保存</Button>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ mode: 'exam', durationMinutes: 60 }}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="考试名称" rules={[{ required: true }]}>
            <Input placeholder="如：多维表格基础操作考核" />
          </Form.Item>
          <Form.Item name="description" label="考试说明">
            <TextArea rows={4} placeholder="考试说明（学生可见）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="mode" label="考试模式" rules={[{ required: true }]}>
                <Select options={[{ value: 'practice', label: '练习' }, { value: 'quiz', label: '测验' }, { value: 'exam', label: '正式考试' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="durationMinutes" label="时长（分钟）">
                <InputNumber min={1} max={480} style={{ width: '100%' }} placeholder="不限时" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="passScore" label="及格线（分）">
                <InputNumber min={0} max={1000} style={{ width: '100%' }} placeholder="不设及格线" />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="选择题目" style={{ marginBottom: 16 }}>
          <Transfer
            dataSource={allQuestions.map(q => ({
              key: q.id,
              title: q.title,
              description: `${q.type} | ${q.score}分 | ${q.difficulty}`,
            }))}
            targetKeys={selectedKeys}
            onChange={keys => setSelectedKeys(keys as string[])}
            render={item => item.title}
            listStyle={{ width: '100%', height: 400 }}
            showSearch
            filterOption={(inputValue, item) => item.title.toLowerCase().includes(inputValue.toLowerCase())}
          />
          <div style={{ marginTop: 12 }}>
            已选择 <strong>{selectedKeys.length}</strong> 道题目，
            总分：<strong>{selectedKeys.reduce((sum, qid) => {
              const q = allQuestions.find(q => q.id === qid);
              return sum + (q?.score || 0);
            }, 0)}</strong> 分
          </div>
        </Card>

        {isEdit && (
          <Card title="发布管理" style={{ marginBottom: 16 }}>
            <Space>
              <Button onClick={async () => {
                try { await api.post(`/exams/${id}/publish`); message.success('已发布'); window.location.reload(); }
                catch (err: any) { message.error(err.response?.data?.message || '发布失败'); }
              }}>发布考试</Button>
              <Button onClick={async () => {
                try { await api.post(`/exams/${id}/start`); message.success('考试已开始'); window.location.reload(); }
                catch (err: any) { message.error(err.response?.data?.message || '失败'); }
              }}>开始考试</Button>
              <Button onClick={async () => {
                try { await api.post(`/exams/${id}/end`); message.success('考试已结束'); window.location.reload(); }
                catch (err: any) { message.error(err.response?.data?.message || '失败'); }
              }}>结束考试</Button>
            </Space>
          </Card>
        )}
      </Form>
    </div>
  );
}
