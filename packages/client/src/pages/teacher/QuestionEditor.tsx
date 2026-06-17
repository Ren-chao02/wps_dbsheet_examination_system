import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Input, Select, InputNumber, Button, Card, Space, Divider, Tag, message, Spin, Row, Col, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { Question, QuestionCategory, AnswerRule } from '../../types';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';

const { TextArea } = Input;

const actionOptions = [
  { value: 'check_table_exists', label: '检查表存在' },
  { value: 'check_table_name', label: '检查表名称' },
  { value: 'check_table_count', label: '检查表数量' },
  { value: 'check_field', label: '检查字段' },
  { value: 'check_field_count', label: '检查字段数量' },
  { value: 'check_field_required', label: '检查必填设置' },
  { value: 'check_field_formula', label: '检查公式字段' },
  { value: 'check_linked_record', label: '检查关联记录' },
  { value: 'check_view_exists', label: '检查视图存在' },
  { value: 'check_view_type', label: '检查视图类型' },
  { value: 'check_view_filter', label: '检查视图筛选' },
  { value: 'check_view_sort', label: '检查视图排序' },
  { value: 'check_view_group', label: '检查视图分组' },
  { value: 'check_form_exists', label: '检查表单存在' },
  { value: 'check_form_fields', label: '检查表单字段' },
  { value: 'check_form_settings', label: '检查表单设置' },
  { value: 'check_record_exists', label: '检查记录存在' },
  { value: 'check_record_value', label: '检查记录值' },
  { value: 'check_record_count', label: '检查记录数量' },
];

const actionParamHints: Record<string, string> = {
  check_table_exists: '{"tableName":"表名"}',
  check_table_name: '{"tableName":"表名"}',
  check_table_count: '{"count":3}',
  check_field: '{"tableName":"表名","fieldName":"字段名","type":"text/number/single_select/date","options":["选项1","选项2"]}',
  check_field_count: '{"tableName":"表名","count":5}',
  check_field_required: '{"tableName":"表名","fieldName":"字段名"}',
  check_field_formula: '{"tableName":"表名","fieldName":"字段名","formula":"公式表达式"}',
  check_linked_record: '{"tableName":"表名","targetTable":"目标表名"}',
  check_view_exists: '{"tableName":"表名","viewName":"视图名"}',
  check_view_type: '{"tableName":"表名","viewName":"视图名","viewType":"kanban/gallery/grid/form"}',
  check_view_filter: '{"tableName":"表名","viewName":"视图名","field":"字段名","value":"筛选值"}',
  check_view_sort: '{"tableName":"表名","viewName":"视图名","field":"字段名","direction":"asc/desc"}',
  check_view_group: '{"tableName":"表名","viewName":"视图名","field":"字段名"}',
  check_form_exists: '{"tableName":"表名","formName":"表单名"}',
  check_form_fields: '{"tableName":"表名","formName":"表单名","hiddenFields":["隐藏字段"]}',
  check_form_settings: '{"tableName":"表名","formName":"表单名","submitMessage":"提交成功提示"}',
  check_record_exists: '{"tableName":"表名","field":"字段名","value":"值"}',
  check_record_value: '{"tableName":"表名","field":"字段名","expected":"期望值"}',
  check_record_count: '{"tableName":"表名","count":10}',
};

function RuleEditor({ rules, onChange }: { rules: AnswerRule[]; onChange: (rules: AnswerRule[]) => void }) {
  const addRule = () => {
    const newRule: AnswerRule = {
      id: `rule_${Date.now()}`,
      action: 'check_table_exists',
      params: {},
      score: 5,
    };
    onChange([...rules, newRule]);
  };

  const updateRule = (index: number, field: string, value: any) => {
    const updated = [...rules];
    (updated[index] as any)[field] = value;
    if (field === 'action') {
      try {
        updated[index].params = JSON.parse(actionParamHints[value] || '{}');
      } catch { updated[index].params = {}; }
    }
    onChange(updated);
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong>验证规则</strong>
        <Button type="dashed" icon={<PlusOutlined />} onClick={addRule} size="small">添加规则</Button>
      </div>
      {rules.length === 0 && <div style={{ color: '#999', padding: 16, textAlign: 'center', border: '1px dashed #ddd', borderRadius: 4 }}>暂无规则，请点击"添加规则"</div>}
      {rules.map((rule, index) => (
        <Card key={rule.id} size="small" style={{ marginBottom: 8 }} extra={<Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeRule(index)} />}>
          <Row gutter={8}>
            <Col span={8}>
              <Select value={rule.action} onChange={v => updateRule(index, 'action', v)} style={{ width: '100%' }} options={actionOptions} />
            </Col>
            <Col span={12}>
              <Input
                value={JSON.stringify(rule.params)}
                onChange={e => {
                  try { updateRule(index, 'params', JSON.parse(e.target.value)); } catch { /* allow typing */ }
                }}
                placeholder={actionParamHints[rule.action] || '{"key":"value"}'}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Col>
            <Col span={4}>
              <InputNumber value={rule.score} onChange={v => updateRule(index, 'score', v || 0)} min={0} addonAfter="分" style={{ width: '100%' }} />
            </Col>
          </Row>
        </Card>
      ))}
      {rules.length > 0 && (
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <Tag color="blue">总计：{rules.reduce((sum, r) => sum + r.score, 0)} 分</Tag>
        </div>
      )}
    </div>
  );
}

export function QuestionEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [categories, setCategories] = useState<QuestionCategory[]>([]);
  const [rules, setRules] = useState<AnswerRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const isEdit = !!id;
  const primaryCategoryId = Form.useWatch('primaryCategoryId', form);

  useEffect(() => {
    // ✅ 更新：获取分类列表（用于两级分类选择）
    api.get('/categories?mode=tree')
      .then(res => setCategories(res.data?.data || []))
      .catch(() => {});

    if (isEdit) {
      setLoading(true);
      api.get(`/questions/${id}`).then(res => {
        const q = res.data;
        form.setFieldsValue({
          ...q,
          // 确保新字段正确映射
          primaryCategoryId: q.primaryCategoryId,
          secondaryCategoryId: q.secondaryCategoryId,
          teacherName: q.teacherName,
        });
        setRules(q.answerRules || []);
      }).catch(() => message.error('加载失败')).finally(() => setLoading(false));
    }
  }, [id]);

  const onFinish = async (values: any) => {
    setSaving(true);
    try {
      const payload = { ...values, answerRules: rules };
      if (isEdit) {
        await api.put(`/questions/${id}`, payload);
        message.success('更新成功');
      } else {
        const res = await api.post('/questions', payload);
        message.success('创建成功');
        navigate(`/teacher/questions/${res.data.id}/edit`);
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
        <h2>{isEdit ? '编辑题目' : '新建题目'}</h2>
        <Space>
          <Button onClick={() => navigate('/teacher/questions')}>取消</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={() => form.submit()} loading={saving}>保存</Button>
        </Space>
      </div>

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ difficulty: 'medium', score: 10, tags: [] }}>
        <Card title="基本信息" style={{ marginBottom: 16 }}>
          <Form.Item name="title" label="题目标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：创建学生档案表" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="difficulty" label="难度" rules={[{ required: true }]}>
                <Select options={[{ value: 'easy', label: '简单' }, { value: 'medium', label: '中等' }, { value: 'hard', label: '困难' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="score" label="分值" rules={[{ required: true }]}>
                <InputNumber min={0} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {/* ✅ 替换为两级分类选择（带编辑按钮） */}
          <Row gutter={16} align="middle">
            <Col span={10}>
              <Form.Item name="primaryCategoryId" label="一级分类" style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="选择一级分类"
                  onChange={() => {
                    // 清空二级分类
                    form.setFieldsValue({ secondaryCategoryId: undefined });
                  }}
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={categories.map(c => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
              </Form.Item>
            </Col>

            <Col span={2}>
              <div style={{ paddingTop: 29 }}>
                <Tooltip title="编辑知识点分类">
                  <Button
                    type="text"
                    icon={<SettingOutlined />}
                    onClick={() => setCategoryModalVisible(true)}
                    style={{
                      color: '#667eea',
                      border: '1px solid #667eea33',
                      borderRadius: 6,
                      height: 32,
                      width: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  />
                </Tooltip>
              </div>
            </Col>

            <Col span={12}>
              <Form.Item name="secondaryCategoryId" label="二级分类" style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch
                  placeholder="先选择一级分类"
                  disabled={!primaryCategoryId}
                  filterOption={(input, option) =>
                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={
                    categories
                      .filter(cat => cat.parentId === primaryCategoryId)
                      .map(sub => ({
                        value: sub.id,
                        label: sub.name,
                      }))
                  }
                />
              </Form.Item>
            </Col>
          </Row>

          {/* ✅ 新增：出题老师字段 */}
          <Form.Item
            name="teacherName"
            label="出题老师"
            tooltip="留空则自动使用当前登录用户姓名"
          >
            <Input
              placeholder="输入出题老师姓名（可选）"
              maxLength={64}
            />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="输入标签后回车" />
          </Form.Item>
        </Card>

        <Card title="题目内容" style={{ marginBottom: 16 }}>
          <Form.Item name="description" label="题目描述" rules={[{ required: true, message: '请输入题目描述' }]}>
            <TextArea rows={5} placeholder="详细描述题目要求，如：请创建一个名为「学生档案」的数据表，并添加以下字段..." />
          </Form.Item>
          <Form.Item name="hints" label="提示（选填）">
            <TextArea rows={2} placeholder="给学生的操作提示" />
          </Form.Item>
        </Card>

        <Card title="验证规则" style={{ marginBottom: 16 }}>
          <RuleEditor rules={rules} onChange={setRules} />
        </Card>
      </Form>

      {/* ✨ 知识点分类管理弹窗 */}
      <CategoryManagerModal
        visible={categoryModalVisible}
        onClose={() => {
          setCategoryModalVisible(false);
          // 刷新分类列表
          api.get('/categories?mode=tree')
            .then(res => {
              // 转换为扁平列表格式
              const treeData = res.data?.data || [];
              const flattenCategories = (cats: any[], level: number = 1): QuestionCategory[] => {
                return cats.reduce((acc: QuestionCategory[], cat: any) => {
                  acc.push({
                    ...cat,
                    level,
                    children: cat.children || [],
                  });
                  if (cat.children && cat.children.length > 0) {
                    acc.push(...flattenCategories(cat.children, level + 1));
                  }
                  return acc;
                }, []);
              };
              setCategories(flattenCategories(treeData));
            })
            .catch(() => {});
        }}
      />
    </div>
  );
}
