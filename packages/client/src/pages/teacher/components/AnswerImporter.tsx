/**
 * 标准答案导入器（出题辅助第②段）
 *
 * 出题人在 WPS 多维表格中完成"标准答案"，将 fileId + accessToken 粘贴到此处，
 * 系统调用后端反向生成规则（参数 100% 来自真实 Schema）。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §4.3
 */
import { useState } from 'react';
import {
  Card, Form, Input, Button, Space, Alert, Table, Tag, Typography, message, Divider,
} from 'antd';
import { ThunderboltOutlined, FileSearchOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../../../services/api';
import type { QuestionSkeleton, ReverseOutput, SchemaSummary } from '../../../types';

const { Text, Paragraph } = Typography;

interface AnswerImporterProps {
  /** 已勾选的能力 id（来自第①段） */
  selectedCapabilityIds: string[];
  /** 是否禁用（未选能力时） */
  disabled?: boolean;
  /** 骨架生成成功回调（用于回填标题/描述/分值） */
  onSkeleton?: (skeleton: QuestionSkeleton) => void;
  /** 反向生成成功回调（传入第③段 RulePreviewer） */
  onGenerated: (output: ReverseOutput) => void;
  /** 凭据变更回调（Phase 2：上提凭据供 CoachingPanel 共用） */
  onCredentialsChange?: (creds: { fileId: string; accessToken: string; apiSecret?: string } | null) => void;
}

interface CredentialsForm {
  fileId: string;
  accessToken: string;
  apiSecret?: string;
}

export function AnswerImporter({
  selectedCapabilityIds, disabled, onSkeleton, onGenerated, onCredentialsChange,
}: AnswerImporterProps) {
  const [form] = Form.useForm<CredentialsForm>();
  const [schemaSummary, setSchemaSummary] = useState<SchemaSummary | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [loadingSkeleton, setLoadingSkeleton] = useState(false);
  const [loadingReverse, setLoadingReverse] = useState(false);

  const isDisabled = disabled || selectedCapabilityIds.length === 0;

  /** 生成题目骨架（仅依赖勾选能力，不需 WPS 凭据） */
  const handleGenerateSkeleton = async () => {
    if (selectedCapabilityIds.length === 0) {
      message.warning('请先选择能力');
      return;
    }
    setLoadingSkeleton(true);
    try {
      const res = await api.post<QuestionSkeleton>('/questions/skeleton', {
        capabilityIds: selectedCapabilityIds,
      });
      onSkeleton?.(res.data);
      message.success('骨架已生成，已回填标题/描述/分值');
    } catch (err: any) {
      message.error(err.response?.data?.message || '骨架生成失败');
    } finally {
      setLoadingSkeleton(false);
    }
  };

  /** 反向生成规则（需 fileId + accessToken，调用 WPS API） */
  const handleReverseRules = async () => {
    try {
      const values = await form.validateFields();
      setLoadingReverse(true);
      setNotes([]);
      const res = await api.post<ReverseOutput>('/questions/reverse-rules', {
        capabilities: selectedCapabilityIds,
        fileId: values.fileId,
        accessToken: values.accessToken,
        apiSecret: values.apiSecret || undefined,
      });
      const output = res.data;
      setSchemaSummary(output.schemaSummary);
      setNotes(output.notes || []);
      if (output.suggestions.length === 0) {
        message.warning('未生成任何规则建议，请检查标准答案是否包含所选能力');
      } else {
        message.success(`已生成 ${output.suggestions.length} 条规则建议`);
      }
      onGenerated(output);
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (msg && /WPS.*令牌|access_token/i.test(msg)) {
        message.error(msg);
      } else if (msg) {
        message.error(msg);
      } else if (err.errorFields) {
        message.error('请填写 fileId 和 accessToken');
      } else {
        message.error('反向生成失败');
      }
    } finally {
      setLoadingReverse(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <span>② 导入标准答案</span>
          {isDisabled && <Tag color="orange">请先选择能力</Tag>}
        </Space>
      }
      extra={
        <Button
          type="default"
          icon={<FileSearchOutlined />}
          onClick={handleGenerateSkeleton}
          loading={loadingSkeleton}
          disabled={isDisabled}
        >
          生成题目骨架
        </Button>
      }
      style={{ marginBottom: 16 }}
    >
      {isDisabled && (
        <Alert
          type="info"
          showIcon
          message="请先在第①段勾选要考察能力，再导入标准答案"
          style={{ marginBottom: 16 }}
        />
      )}

      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        <LinkOutlined /> 在 WPS 多维表格中按题目要求完成"标准答案"，然后粘贴文件的 fileId 和访问令牌。
        系统会读取真实 Schema 并反向生成参数 100% 真实的判分规则。
      </Paragraph>

      <Form
        form={form}
        layout="vertical"
        disabled={isDisabled}
        onValuesChange={(_, allValues) => {
          if (allValues.fileId && allValues.accessToken) {
            onCredentialsChange?.({
              fileId: allValues.fileId,
              accessToken: allValues.accessToken,
              apiSecret: allValues.apiSecret || undefined,
            });
          } else {
            onCredentialsChange?.(null);
          }
        }}
      >
        <Form.Item
          name="fileId"
          label="文件 ID（fileId）"
          rules={[{ required: true, message: '请输入 fileId' }]}
        >
          <Input placeholder="如：officelorexxxxxxxxxxxx" />
        </Form.Item>
        <Form.Item
          name="accessToken"
          label="访问令牌（access_token）"
          rules={[{ required: true, message: '请输入 accessToken' }]}
          tooltip="WPS 开放平台 access_token，用于读取标准答案文件 Schema"
        >
          <Input.Password placeholder="WPS 开放平台 access_token" />
        </Form.Item>
        <Form.Item name="apiSecret" label="API Secret（可选）" tooltip="v3 签名鉴权时需要">
          <Input.Password placeholder="仅 v3 鉴权需要" />
        </Form.Item>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={handleReverseRules}
          loading={loadingReverse}
          disabled={isDisabled}
        >
          反向生成规则
        </Button>
      </Form>

      {/* notes 提示 */}
      {notes.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0 8px' }} />
          <Alert
            type="warning"
            showIcon
            message="生成提示"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            }
            style={{ marginBottom: 12 }}
          />
        </>
      )}

      {/* Schema 预览 */}
      {schemaSummary && (
        <>
          <Divider style={{ margin: '16px 0 12px' }} />
          <Text strong>标准答案 Schema 概览</Text>
          <Table
            size="small"
            rowKey="name"
            style={{ marginTop: 8 }}
            pagination={false}
            dataSource={schemaSummary.sheets}
            columns={[
              { title: '工作表', dataIndex: 'name', key: 'name' },
              { title: '字段数', dataIndex: 'fieldCount', key: 'fieldCount', width: 80 },
              { title: '视图数', dataIndex: 'viewCount', key: 'viewCount', width: 80 },
            ]}
          />
          {schemaSummary.forms.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">表单：</Text>
              {schemaSummary.forms.map(f => (
                <Tag key={f.name} style={{ marginLeft: 4 }}>{f.name}（{f.fieldCount} 字段）</Tag>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
