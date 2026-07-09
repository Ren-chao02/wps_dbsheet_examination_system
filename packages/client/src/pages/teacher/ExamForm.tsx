import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Select, InputNumber, Button, Card, message, Spin, Space, Row, Col, Switch, Table, Tag, Modal, DatePicker } from 'antd';
import { SaveOutlined, ArrowLeftOutlined, BookOutlined, EyeOutlined, LinkOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import type { Paper, PaperQuestion } from '../../types';

const { TextArea } = Input;

export function ExamForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paperModalOpen, setPaperModalOpen] = useState(false);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);
  const [paperQuestions, setPaperQuestions] = useState<PaperQuestion[]>([]);
  const [existingExam, setExistingExam] = useState<any>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const isEdit = !!id;

  useEffect(() => {
    if (isEdit) {
      setLoading(true);
      api.get(`/exams/${id}`).then(res => {
        const e = res.data;
        setExistingExam(e);
        const settings = typeof e.settings === 'object' && e.settings !== null ? e.settings : {};
        form.setFieldsValue({
          title: e.title,
          description: e.description,
          mode: e.mode,
          durationMinutes: e.durationMinutes,
          passScore: e.passScore,
          shuffleQuestions: settings.shuffleQuestions === true,
          paperId: e.paperId,
          batchId: e.batchId,
          startTime: e.startTime ? dayjs(e.startTime) : undefined,
          endTime: e.endTime ? dayjs(e.endTime) : undefined,
        });
        if (e.paperId) {
          loadPaper(e.paperId);
        }
      }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
    }
    fetchBatches();
  }, [id]);

  const fetchBatches = async () => {
    try {
      const res = await api.get('/batches?pageSize=200');
      setBatches(res.data?.data || []);
    } catch { /* ignore */ }
  };

  const loadPaper = async (paperId: string) => {
    try {
      const res = await api.get(`/papers/${paperId}`);
      setSelectedPaper(res.data);
      setPaperQuestions(res.data.paperQuestions || []);
    } catch {
      console.error('Error loading paper');
    }
  };

  const fetchPapers = async () => {
    try {
      const res = await api.get('/papers?pageSize=100');
      setPapers(res.data?.data || []);
    } catch {
      message.error('加载试卷列表失败');
    }
  };

  const onFinish = async (values: any) => {
    setSaving(true);
    try {
      const payload = {
        ...values,
        paperId: values.paperId || null,
        durationMinutes: values.durationMinutes ?? null,
        passScore: values.passScore ?? null,
        startTime: values.startTime ? values.startTime.toISOString() : null,
        endTime: values.endTime ? values.endTime.toISOString() : null,
        settings: {
          ...(typeof existingExam?.settings === 'object' && existingExam?.settings !== null ? existingExam.settings : {}),
          shuffleQuestions: values.shuffleQuestions === true,
        },
      };
      delete payload.shuffleQuestions;
      if (isEdit) {
        await api.put(`/exams/${id}`, payload);
        message.success('更新成功');
      } else {
        const res = await api.post('/exams', payload);
        message.success('创建成功');
        navigate(`/teacher/exams/${res.data.id}/edit`);
      }
    } catch (err: any) {
      const errors = err.response?.data?.errors;
      if (errors?.length) {
        message.error(errors.map((e: any) => `${e.path?.join('.')}: ${e.message}`).join('; '));
      } else {
        message.error(err.response?.data?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSelectPaper = (paper: Paper) => {
    setSelectedPaper(paper);
    form.setFieldsValue({ paperId: paper.id });
    setPaperModalOpen(false);
    // Load paper questions
    api.get(`/papers/${paper.id}`).then(res => {
      setPaperQuestions(res.data.paperQuestions || []);
    });
  };

  const handleClearPaper = () => {
    setSelectedPaper(null);
    form.setFieldsValue({ paperId: null });
    setPaperQuestions([]);
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

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ mode: 'exam' }}>
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
          <Form.Item name="batchId" label="所属批次">
            <Select placeholder="选择批次以继承公共参数（可选）" allowClear showSearch optionFilterProp="children">
              {batches.map((b: any) => (
                <Select.Option key={b.id} value={b.id}>{b.name}</Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="startTime" label="考试开始时间">
                <DatePicker showTime style={{ width: '100%' }} placeholder="选择开始时间" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endTime" label="考试结束时间">
                <DatePicker showTime style={{ width: '100%' }} placeholder="选择结束时间" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="shuffleQuestions" label="随机出卷" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            <span style={{ marginLeft: 8, color: '#999' }}>开启后每位学生看到不同的题目顺序</span>
          </Form.Item>
        </Card>

        <Card title="绑定试卷" style={{ marginBottom: 16 }}
          extra={
            <Space>
              {selectedPaper && (
                <Button icon={<EyeOutlined />} onClick={() => navigate(`/teacher/papers/${selectedPaper.id}/edit?tab=preview`)}>查看试卷</Button>
              )}
              <Button type="primary" icon={<LinkOutlined />} onClick={() => { fetchPapers(); setPaperModalOpen(true); }}>
                {selectedPaper ? '更换试卷' : '选择试卷'}
              </Button>
              {selectedPaper && (
                <Button danger onClick={handleClearPaper}>清除绑定</Button>
              )}
            </Space>
          }
        >
          <Form.Item name="paperId" hidden>
            <Input />
          </Form.Item>
          {selectedPaper ? (
            <div>
              <div style={{ marginBottom: 12 }}>
                <strong>试卷名称：</strong>{selectedPaper.name}
                <Tag color="blue" style={{ marginLeft: 8 }}>{selectedPaper.difficulty || '未设置难度'}</Tag>
                <Tag color="green">{paperQuestions.length} 题</Tag>
                <Tag color="orange">总分 {selectedPaper.totalScore} 分</Tag>
                {selectedPaper.passScore && <Tag color="red">及格 {selectedPaper.passScore} 分</Tag>}
              </div>
              <Table dataSource={paperQuestions} rowKey="questionId" pagination={false} size="small">
                <Table.Column title="序号" width={60} render={(_, __, i) => i + 1} />
                <Table.Column title="题型" width={100} dataIndex={['question', 'type']} render={(v: string) => <Tag>{v}</Tag>} />
                <Table.Column title="题目" dataIndex={['question', 'title']} ellipsis />
                <Table.Column title="分值" width={80} dataIndex="score" />
              </Table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
              <BookOutlined style={{ fontSize: 48, marginBottom: 16 }} />
              <div>暂未绑定试卷</div>
              <div>请从试卷库选择一份试卷，或先前往试卷库创建试卷</div>
            </div>
          )}
        </Card>

        {isEdit && (
          <Card title="发布管理" style={{ marginBottom: 16 }}>
            <Space>
              <Button onClick={async () => {
                try { await api.post(`/exams/${id}/publish`); message.success('已发布'); navigate('/teacher/exams'); }
                catch (err: any) { message.error(err.response?.data?.message || '发布失败'); }
              }}>发布考试</Button>
              <Button onClick={async () => {
                try { await api.post(`/exams/${id}/end`); message.success('考试已结束'); window.location.reload(); }
                catch (err: any) { message.error(err.response?.data?.message || '失败'); }
              }}>结束考试</Button>
            </Space>
          </Card>
        )}
      </Form>

      <Modal
        title="选择试卷"
        open={paperModalOpen}
        onCancel={() => setPaperModalOpen(false)}
        footer={null}
        width={800}
      >
        <Table dataSource={papers} rowKey="id" pagination={{ pageSize: 10 }}
          columns={[
            { title: '试卷名称', dataIndex: 'name' },
            { title: '难度', dataIndex: 'difficulty', render: (v: string) => v || '-' },
            { title: '题目数', key: 'count', render: (_: any, r: Paper) => r._count?.paperQuestions ?? 0 },
            { title: '总分', dataIndex: 'totalScore' },
            { title: '操作', width: 100, render: (_: any, r: Paper) => (
              <Button type="primary" size="small" onClick={() => handleSelectPaper(r)}>选择</Button>
            )},
          ]}
        />
      </Modal>
    </div>
  );
}
