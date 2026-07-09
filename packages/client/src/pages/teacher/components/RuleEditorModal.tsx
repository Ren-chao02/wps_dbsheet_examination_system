/**
 * 规则编辑弹窗
 *
 * 用于在 RulePreviewer 中编辑单条规则建议的 params 和分值。
 * action 不可改（由能力模板决定），仅可改 params 和 score。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §4.3
 */
import { useEffect, useState } from 'react';
import { Modal, Input, InputNumber, Form, Tag, Alert, Descriptions, Typography, message } from 'antd';
import type { AnswerRule, RuleSuggestion } from '../../../types';

const { Text } = Typography;
const { TextArea } = Input;

interface RuleEditorModalProps {
  visible: boolean;
  suggestion: RuleSuggestion | null;
  onSave: (rule: AnswerRule) => void;
  onCancel: () => void;
}

export function RuleEditorModal({ visible, suggestion, onSave, onCancel }: RuleEditorModalProps) {
  const [form] = Form.useForm();
  const [paramsText, setParamsText] = useState('');
  const [paramsError, setParamsError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && suggestion) {
      setParamsText(JSON.stringify(suggestion.rule.params, null, 2));
      setParamsError(null);
      form.setFieldsValue({ score: suggestion.rule.score });
    }
  }, [visible, suggestion, form]);

  const handleOk = async () => {
    if (!suggestion) return;
    try {
      const parsed = JSON.parse(paramsText);
      const values = await form.validateFields();
      onSave({
        ...suggestion.rule,
        params: parsed,
        score: values.score ?? 0,
      });
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        setParamsError(`JSON 解析失败：${err.message}`);
      } else if (err.errorFields) {
        message.error('请检查分值');
      } else {
        message.error('保存失败');
      }
    }
  };

  if (!suggestion) return null;

  return (
    <Modal
      title="编辑规则"
      open={visible}
      onOk={handleOk}
      onCancel={onCancel}
      width={640}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
        <Descriptions.Item label="规则动作">
          <Tag color="blue">{suggestion.rule.action}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="来源">
          <Text style={{ fontSize: 13 }}>
            表「{suggestion.source.sheetName}」
            {suggestion.source.fieldName ? ` · 字段「${suggestion.source.fieldName}」` : ''}
            {' · '}
            <Text type="secondary" style={{ fontSize: 12 }}>{suggestion.source.capabilityId}</Text>
          </Text>
        </Descriptions.Item>
      </Descriptions>

      {suggestion.missingParams.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="该规则缺少自动填充的参数，请手动补全"
          description={
            <span>
              缺失参数：
              {suggestion.missingParams.map(p => (
                <Tag key={p} color="orange" style={{ marginLeft: 4 }}>{p}</Tag>
              ))}
            </span>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Form form={form} layout="vertical">
        <Form.Item
          label="规则参数（JSON）"
          required
          validateStatus={paramsError ? 'error' : undefined}
          help={paramsError}
        >
          <TextArea
            value={paramsText}
            onChange={e => {
              setParamsText(e.target.value);
              setParamsError(null);
            }}
            autoSize={{ minRows: 6, maxRows: 16 }}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </Form.Item>
        <Form.Item
          name="score"
          label="分值"
          rules={[{ required: true, message: '请输入分值' }]}
        >
          <InputNumber min={0} max={100} addonAfter="分" style={{ width: 200 }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
