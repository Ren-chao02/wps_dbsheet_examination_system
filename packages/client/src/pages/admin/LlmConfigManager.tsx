/**
 * LLM 大模型配置管理页 — 管理员前端配置 AI 服务的 API Key 等
 *
 * 目标用户：不懂计算机的老师/管理员，因此：
 * - Provider 选择即预设推荐模型，避免不知道填什么
 * - API Key 用密码框，占位符显示当前脱敏值，留空 = 保留旧值
 * - 高级参数（temperature/maxTokens/timeout/速率）默认折叠
 *
 * API：
 *   GET    /api/llm-config  → 脱敏配置（apiKeyMasked, hasApiKey, source）
 *   POST   /api/llm-config  → 保存（apiKey 空 = 保留旧值）
 *   DELETE /api/llm-config  → 清除 DB 配置（回退到 .env）
 *
 * @see packages/server/src/routes/llm-config.ts
 */
import { useEffect, useState } from 'react';
import {
  Card,
  Typography,
  Button,
  Space,
  Alert,
  Tag,
  Form,
  Input,
  InputNumber,
  Select,
  Slider,
  Collapse,
  Popconfirm,
  message,
  Spin,
  Descriptions,
} from 'antd';
import {
  RobotOutlined,
  SaveOutlined,
  DeleteOutlined,
  ReloadOutlined,
  KeyOutlined,
  SettingOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text, Paragraph } = Typography;

// ── Provider 元数据：用于下拉项 + 推荐模型 + 是否需要 API Key ──
interface ProviderMeta {
  value: string;
  label: string;
  defaultModel: string;
  needsApiKey: boolean;
  helpUrl: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    value: 'deepseek',
    label: 'DeepSeek（深度求索，推荐）',
    defaultModel: 'deepseek-chat',
    needsApiKey: true,
    helpUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    value: 'qwen',
    label: '通义千问 Qwen（阿里云百炼）',
    defaultModel: 'qwen-plus',
    needsApiKey: true,
    helpUrl: 'https://bailian.console.aliyun.com/overview#/api-key',
  },
  {
    value: 'glm',
    label: '智谱 GLM（ChatGLM）',
    defaultModel: 'glm-4',
    needsApiKey: true,
    helpUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    value: 'sensenova',
    label: '商汤日日新 SenseNova（Token Plan 公测免费）',
    defaultModel: 'deepseek-v4-flash',
    needsApiKey: true,
    helpUrl: 'https://platform.sensenova.cn/console',
  },
  {
    value: 'ollama',
    label: 'Ollama（本地部署，无需 API Key）',
    defaultModel: 'qwen2.5:7b',
    needsApiKey: false,
    helpUrl: 'https://ollama.com/library',
  },
];

// ── 后端返回的脱敏配置类型 ──
interface LlmMaskedConfig {
  provider: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseURL: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  rateLimitPerMin: number;
  source: 'db' | 'env';
}

// ── POST /api/llm-config/test 的返回结果 ──
interface TestResult {
  ok: boolean;
  provider?: string;
  model?: string;
  latencyMs?: number;
  reply?: string;
  message?: string;
  detail?: string;
  errorType?: string;
}

export default function LlmConfigManager() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<LlmMaskedConfig | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('deepseek');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // 加载脱敏配置
  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: LlmMaskedConfig }>('/llm-config');
      const cfg = res.data.data;
      setConfig(cfg);
      // 回填表单（apiKey 留空，提示用户保留旧值）
      form.setFieldsValue({
        provider: cfg.provider,
        apiKey: '',
        baseURL: cfg.baseURL,
        model: cfg.model,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
        timeoutMs: cfg.timeoutMs,
        rateLimitPerMin: cfg.rateLimitPerMin,
      });
      setSelectedProvider(cfg.provider);
    } catch (err: any) {
      message.error(err.response?.data?.message || '加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Provider 切换时：若 model 还是空或是上一个 provider 的默认值，自动切换到新 provider 的推荐模型
  const handleProviderChange = (value: string) => {
    setSelectedProvider(value);
    const meta = PROVIDERS.find(p => p.value === value);
    const currentModel = form.getFieldValue('model');
    // 若当前 model 为空，或是任一 provider 的默认模型，则替换为新 provider 的推荐模型
    const isDefault = !currentModel || PROVIDERS.some(p => p.defaultModel === currentModel);
    if (meta && isDefault) {
      form.setFieldValue('model', meta.defaultModel);
    }
  };

  // 保存
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.post('/llm-config', values);
      message.success('配置已保存');
      fetchConfig();
    } catch (err: any) {
      if (err.response) {
        message.error(err.response.data?.message || '保存失败');
      } else if (err.errorFields) {
        // antd 表单校验失败，已有字段级提示
      } else {
        message.error(err.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // 测试连接：用表单当前值发起一次最小请求（不保存配置）
  const handleTestConnection = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      setTestResult(null);
      try {
        const res = await api.post('/llm-config/test', values);
        const data = res.data as TestResult;
        if (data.ok) {
          setTestResult(data);
          message.success(
            data.latencyMs != null
              ? `连接成功（${data.latencyMs}ms）`
              : '连接成功',
          );
        } else {
          setTestResult(data);
          message.error(data.message || '连接失败');
        }
      } catch (err: any) {
        const data = {
          ok: false,
          message: err.response?.data?.message || '连接失败',
          detail: err.response?.data?.detail || err.message || '未知错误',
        } as TestResult;
        setTestResult(data);
        message.error('连接失败');
      } finally {
        setTesting(false);
      }
    } catch (err) {
      // 表单校验失败，字段级错误提示已展示
    }
  };

  // 清除 DB 配置（回退到 env）
  const handleClear = async () => {
    try {
      await api.delete('/llm-config');
      message.success('已清除数据库配置，回退到环境变量');
      fetchConfig();
    } catch (err: any) {
      message.error(err.response?.data?.message || '清除失败');
    }
  };

  const selectedMeta = PROVIDERS.find(p => p.value === selectedProvider);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <Title level={2}>
          <RobotOutlined style={{ marginRight: 12 }} />
          AI 模型配置
        </Title>
        <Text type="secondary">
          配置 AI 对话教练所用的大模型服务（API Key、模型、参数等）。配置后立即生效，无需重启服务。
        </Text>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* 当前生效配置概览 */}
        <Card
          title={
            <Space>
              <SettingOutlined />
              <span>当前生效配置</span>
              {config && (
                <Tag color={config.source === 'db' ? 'green' : 'orange'}>
                  {config.source === 'db' ? '来源：前端配置（数据库）' : '来源：环境变量（.env）'}
                </Tag>
              )}
            </Space>
          }
          extra={
            <Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>
              刷新
            </Button>
          }
        >
          {config ? (
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Provider">
                {PROVIDERS.find(p => p.value === config.provider)?.label || config.provider}
              </Descriptions.Item>
              <Descriptions.Item label="模型">{config.model}</Descriptions.Item>
              <Descriptions.Item label="API Key" span={2}>
                {config.hasApiKey ? (
                  <Space>
                    <KeyOutlined style={{ color: '#52c41a' }} />
                    <Text code>{config.apiKeyMasked}</Text>
                    <Tag color="success">已配置</Tag>
                  </Space>
                ) : (
                  <Space>
                    <Text type="danger">未配置 API Key</Text>
                    {config.provider !== 'ollama' && (
                      <Tag color="warning">AI 教练将不可用</Tag>
                    )}
                  </Space>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Base URL">
                {config.baseURL || '（使用 provider 默认端点）'}
              </Descriptions.Item>
              <Descriptions.Item label="温度 Temperature">
                {config.temperature}
              </Descriptions.Item>
              <Descriptions.Item label="最大 Tokens">
                {config.maxTokens}
              </Descriptions.Item>
              <Descriptions.Item label="速率限制（次/分钟）">
                {config.rateLimitPerMin}
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Text type="secondary">暂无配置信息</Text>
          )}
        </Card>

        {/* 配置表单 */}
        <Card title={<Space><RobotOutlined />配置大模型服务</Space>}>
          <Alert
            type="info"
            showIcon
            message="如何获取 API Key？"
            description={
              selectedMeta ? (
                <span>
                  请前往 {selectedMeta.label.split('（')[0]} 官方平台申请 API Key：
                  <a href={selectedMeta.helpUrl} target="_blank" rel="noopener noreferrer">
                    {' '}{selectedMeta.helpUrl}
                  </a>
                  {selectedMeta.needsApiKey && (
                    <Text type="warning" style={{ marginLeft: 8 }}>
                      （粘贴后系统会加密保存到数据库，不会明文回显）
                    </Text>
                  )}
                </span>
              ) : '请选择 Provider 后查看申请指引。'
            }
            style={{ marginBottom: 24 }}
          />

          <Form
            form={form}
            layout="vertical"
            initialValues={{
              provider: 'deepseek',
              apiKey: '',
              baseURL: '',
              model: 'deepseek-chat',
              temperature: 0.4,
              maxTokens: 2048,
              timeoutMs: 60000,
              rateLimitPerMin: 20,
            }}
          >
            <Form.Item
              name="provider"
              label="大模型服务商（Provider）"
              rules={[{ required: true, message: '请选择服务商' }]}
            >
              <Select
                placeholder="请选择大模型服务商"
                onChange={handleProviderChange}
                options={PROVIDERS.map(p => ({ value: p.value, label: p.label }))}
              />
            </Form.Item>

            <Form.Item
              name="apiKey"
              label="API Key"
              tooltip={selectedMeta && !selectedMeta.needsApiKey
                ? 'Ollama 本地部署无需 API Key，可留空'
                : '留空表示保留已配置的 API Key 不变'}
            >
              <Input.Password
                placeholder={config?.hasApiKey
                  ? `当前：${config.apiKeyMasked}（留空保留不变）`
                  : selectedMeta && !selectedMeta.needsApiKey
                    ? '本地部署，无需 API Key'
                    : '请粘贴 API Key，例如 sk-xxxxxxxxxxxx'
                }
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="model"
              label="模型名称（Model）"
              rules={[{ required: true, message: '请输入模型名称' }]}
              extra={selectedMeta ? `推荐：${selectedMeta.defaultModel}` : undefined}
            >
              <Input placeholder="例如 deepseek-chat、qwen-plus、glm-4、deepseek-v4-flash" />
            </Form.Item>

            <Form.Item
              name="baseURL"
              label="Base URL（可选）"
              tooltip="留空则使用 provider 的官方默认端点。仅当使用代理或自部署端点时填写。"
            >
              <Input placeholder="例如 https://api.deepseek.com（留空使用默认）" />
            </Form.Item>

            {/* 高级参数（默认折叠） */}
            <Collapse
              ghost
              items={[{
                key: 'advanced',
                label: '高级参数（温度 / Tokens / 超时 / 速率）',
                children: (
                  <>
                    <Form.Item
                      name="temperature"
                      label={`温度 Temperature：${form.getFieldValue('temperature') ?? 0.4}`}
                      tooltip="0 = 严谨确定性，2 = 发散创造性。AI 教练建议 0.2~0.6。"
                    >
                      <Slider min={0} max={2} step={0.1} />
                    </Form.Item>
                    <Form.Item
                      name="maxTokens"
                      label="最大 Tokens（单次回复上限）"
                      tooltip="模型单次生成的最大 token 数。建议 1024~4096。"
                    >
                      <InputNumber min={1} max={32768} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      name="timeoutMs"
                      label="超时时间（毫秒）"
                      tooltip="调用 LLM 的超时时间，网络慢可适当调大。"
                    >
                      <InputNumber min={1000} max={600000} step={1000} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      name="rateLimitPerMin"
                      label="速率限制（每分钟最大请求数）"
                      tooltip="防止单位时间内调用过多导致服务商限流或扣费过高。"
                    >
                      <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                ),
              }]}
            />

            <Form.Item>
              <Space>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saving}
                  onClick={handleSave}
                  size="large"
                >
                  保存配置
                </Button>
                <Button
                  icon={<ApiOutlined />}
                  loading={testing}
                  onClick={handleTestConnection}
                  size="large"
                  disabled={testing}
                >
                  测试连接
                </Button>
                <Popconfirm
                  title="确定清除数据库中的配置？"
                  description="清除后将回退到 .env 环境变量中的配置（若存在）。"
                  onConfirm={handleClear}
                  okText="确定清除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger icon={<DeleteOutlined />} size="large" disabled={config?.source !== 'db'}>
                    清除配置（回退到环境变量）
                  </Button>
                </Popconfirm>
              </Space>
              <div style={{ marginTop: 12 }}>
                <Text type="secondary">
                  先「测试连接」再保存，可验证 API Key / 模型 / Base URL 是否可用，测试不会写入配置。
                </Text>
              </div>
            </Form.Item>

            {/* 测试连接结果 */}
            {testResult && (
              <Alert
                type={testResult.ok ? 'success' : 'error'}
                showIcon
                closable
                onClose={() => setTestResult(null)}
                message={
                  testResult.ok
                    ? '连接成功'
                    : testResult.message || '连接失败'
                }
                description={
                  testResult.ok ? (
                    <span>
                      模型 <Text code>{testResult.model}</Text> 响应正常
                      {testResult.latencyMs != null && <>，耗时 {testResult.latencyMs}ms</>}
                      {testResult.reply && <>，回复：<Text code>{testResult.reply}</Text></>}
                    </span>
                  ) : (
                    <span>
                      {testResult.detail ? (
                        <>
                          <div>{testResult.message}</div>
                          <div style={{ marginTop: 8 }}>
                            <Text code type="danger">
                              {testResult.detail}
                            </Text>
                          </div>
                        </>
                      ) : (
                        testResult.message
                      )}
                    </span>
                  )
                }
                style={{ marginBottom: 24 }}
              />
            )}
          </Form>
        </Card>

        {/* 使用说明 */}
        <Card title="使用说明" size="small">
          <Paragraph>
            <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
              <li>
                <Text strong>Provider</Text>：选择大模型服务商。
                {selectedMeta?.needsApiKey
                  ? '该服务商需要 API Key，请在官方平台申请。'
                  : '该服务商为本地部署，无需 API Key。'}
              </li>
              <li>
                <Text strong>API Key</Text>：粘贴完整 Key 后保存即可，系统会加密存储。
                若只是修改其他参数而不想改 Key，<Text mark>留空</Text>即可保留原 Key。
              </li>
              <li>
                <Text strong>模型</Text>：填写服务商支持的模型名，例如
                <Text code> deepseek-chat</Text>、<Text code>qwen-plus</Text>、
                <Text code>glm-4</Text>、<Text code>deepseek-v4-flash</Text>。
              </li>
              <li>
                <Text strong>Base URL</Text>：使用官方默认端点时留空即可；
                若走代理或自部署，填写完整地址。
              </li>
              <li>
                <Text strong>测试连接</Text>：用当前表单填写的内容（未保存）发起一次最小请求，
                验证 Key / 模型 / Base URL 是否可用，不写入配置。API Key 留空时使用已保存的 Key 测试。
              </li>
              <li>
                <Text strong>清除配置</Text>：仅清除数据库中由前端保存的配置，
                回退到服务器 <Text code>.env</Text> 环境变量（若配置过）。
              </li>
            </ul>
          </Paragraph>
        </Card>
      </Space>
    </div>
  );
}
