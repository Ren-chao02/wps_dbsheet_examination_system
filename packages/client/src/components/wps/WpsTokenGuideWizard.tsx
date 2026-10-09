/**
 * WPS Token 获取引导向导
 *
 * 把《WPS TOKEN获取详细步骤》里原先需要 Postman 手工完成的流程，收敛成站内 5 步：
 *   1. 准备应用凭据（APPID / APPKEY）
 *   2. 开通多维表格权限
 *   3. 配置回调地址
 *   4. 获取授权码 code
 *   5. 一键换取并保存 Token（由后端代发请求，用户无需 Postman）
 *
 * 截图素材抽取自原始 PDF，位于 public/help/wps-token-steps/（webp 格式，避免被 .gitignore 的 *.png 规则忽略）。
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Steps,
  Button,
  Form,
  Input,
  Alert,
  Typography,
  Space,
  Image,
  Tag,
  message,
} from 'antd';
import {
  SaveOutlined,
  ExportOutlined,
  CopyOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import api from '../../services/api';

const { Text, Paragraph, Link } = Typography;

/** 回调地址固定为百度首页：它只负责把 code 转发回来，不需要自建服务器 */
const REDIRECT_URI = 'https://www.baidu.com/';
const SCOPE = 'kso.dbsheet.readwrite';
const AUTH_BASE = 'https://openapi.wps.cn/oauth2/auth';
const OPEN_PLATFORM_URL = 'https://open.wps.cn/';

const STEP_IMAGES = {
  createApp: '/help/wps-token-steps/create-app.webp',
  credentials: '/help/wps-token-steps/app-credentials.webp',
  permission: '/help/wps-token-steps/permission-dbsheet.webp',
  callback: '/help/wps-token-steps/callback-config.webp',
};

export interface WpsTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

interface CredentialValues {
  clientId: string;
  clientSecret: string;
}

/** 从粘贴内容中提取授权码：既支持整条跳转 URL，也支持纯 code */
function extractCode(input: string): string {
  const text = input.trim();
  if (!text) return '';
  const matched = text.match(/[?&]code=([^&\s]+)/);
  if (matched) return decodeURIComponent(matched[1]);
  return text.replace(/^code=/i, '').trim();
}

function buildAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state: `wps-exam-${Date.now()}`,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

/** 复制到剪贴板；非安全上下文（如局域网 http 访问）时回退到 execCommand */
async function copyText(text: string, label: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    message.success(`${label}已复制`);
  } catch {
    message.error('复制失败，请手动选择并复制');
  }
}

/** 步骤内的小节标题 */
function StepSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13.5 }}>
        {title}
      </Text>
      {children}
    </div>
  );
}

/** 截图 + 说明 */
function StepFigure({ src, caption }: { src: string; caption: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Image
        src={src}
        alt={caption}
        preview={{ mask: '点击放大' }}
        style={{ width: '100%', borderRadius: 8, border: '0.5px solid #ececf0' }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>
        {caption}
      </Text>
    </div>
  );
}

export function WpsTokenGuideWizard({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (payload: WpsTokenPayload) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [form] = Form.useForm<CredentialValues>();
  const [credConfigured, setCredConfigured] = useState(false);
  const [savingCred, setSavingCred] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [exchanging, setExchanging] = useState(false);
  const [exchangeDone, setExchangeDone] = useState(false);

  // 凭据同时存一份到组件状态：Form 只在第 1 步挂载，离开该步后 useWatch 会拿不到值，
  // 会导致第 4 步误判「未获取到应用ID」并禁用授权按钮。
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const extractedCode = extractCode(codeInput);

  // 打开时加载已保存的凭据
  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const res = await api.get('/wps-token/credentials');
        if (res.data?.apiKey || res.data?.apiSecret) {
          const savedId = res.data.apiKey || '';
          const savedSecret = res.data.apiSecret || '';
          form.setFieldsValue({ clientId: savedId, clientSecret: savedSecret });
          setClientId(savedId);
          setClientSecret(savedSecret);
        }
        setCredConfigured(!!res.data?.configured);
      } catch {
        // 加载失败保持空值，用户手动填写
      }
    };
    load();
  }, [open, form]);

  const resetAndClose = () => {
    setCurrent(0);
    setCodeInput('');
    setExchangeDone(false);
    onClose();
  };

  const handleSaveCredentials = async () => {
    try {
      const values = await form.validateFields();
      setSavingCred(true);
      await api.post('/wps-token/credentials', {
        apiKey: values.clientId,
        apiSecret: values.clientSecret,
      });
      setCredConfigured(true);
      message.success('应用凭据已保存');
    } catch (err: any) {
      if (err?.errorFields) return; // 表单校验失败，antd 已就地提示
      message.error(err?.response?.data?.message || '保存凭据失败');
    } finally {
      setSavingCred(false);
    }
  };

  const handleExchange = async () => {
    if (!extractedCode) {
      message.warning('请先粘贴授权码');
      return;
    }
    if (!clientId.trim() || !clientSecret.trim()) {
      message.warning('请先在第 1 步填写并保存应用凭据');
      return;
    }
    try {
      setExchanging(true);
      const res = await api.post<WpsTokenPayload>('/wps-token/exchange-code', {
        code: extractedCode,
        redirectUri: REDIRECT_URI,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      });
      setExchangeDone(true);
      onSuccess({
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken,
        expiresIn: res.data.expiresIn,
        refreshExpiresIn: res.data.refreshExpiresIn || 2592000,
      });
      message.success('Token 获取成功，已保存到系统');
    } catch (err: any) {
      const msg = err?.response?.data?.message || '换取 Token 失败';
      message.error(msg);
    } finally {
      setExchanging(false);
    }
  };

  const steps = [
    { title: '准备应用凭据' },
    { title: '开通表格权限' },
    { title: '配置回调地址' },
    { title: '获取授权码' },
    { title: '换取 Token' },
  ];

  // 各步骤的「下一步」是否可用
  const canGoNext = (() => {
    if (current === 0) return !!clientId.trim() && !!clientSecret.trim();
    if (current === 3) return !!extractedCode;
    return true;
  })();

  const renderStep = () => {
    switch (current) {
      case 0:
        return (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="系统已经帮你把后面所有接口调用都做好了，你只需要在 WPS 开放平台点几下，拿到两个值填进来。"
            />
            <StepSection title="① 打开 WPS 开放平台，创建应用">
              <StepFigure src={STEP_IMAGES.createApp} caption="填写应用名称后点击「确定」，应用模式保持「企业自建应用」" />
              <Link href={OPEN_PLATFORM_URL} target="_blank">
                打开 WPS 开放平台 <ExportOutlined />
              </Link>
            </StepSection>
            <StepSection title="② 在「应用信息 → 应用凭证」复制两个值">
              <StepFigure src={STEP_IMAGES.credentials} caption="应用ID 就是 client_id，应用密钥就是 client_secret（点击眼睛图标可显示）" />
              <Form
                form={form}
                layout="vertical"
                onValuesChange={(_, all) => {
                  setClientId(all.clientId || '');
                  setClientSecret(all.clientSecret || '');
                }}
              >
                <Form.Item
                  name="clientId"
                  label="应用ID（client_id）"
                  rules={[{ required: true, message: '请填写应用ID' }]}
                >
                  <Input placeholder="形如 AK20260611YSDOAE" />
                </Form.Item>
                <Form.Item
                  name="clientSecret"
                  label="应用密钥（client_secret）"
                  rules={[{ required: true, message: '请填写应用密钥' }]}
                >
                  <Input.Password placeholder="WPS 开放平台生成的应用密钥" />
                </Form.Item>
              </Form>
              <Space>
                <Button icon={<SaveOutlined />} loading={savingCred} onClick={handleSaveCredentials}>
                  保存凭据
                </Button>
                {credConfigured && <Tag color="success">已配置</Tag>}
              </Space>
            </StepSection>
          </>
        );

      case 1:
        return (
          <>
            <StepSection title="左侧菜单进入「开发配置 → 权限管理」">
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                在「多维表格」分类下，把下面 4 项权限都开通。少任何一项，系统读取表格数据都会失败。
              </Paragraph>
              <StepFigure src={STEP_IMAGES.permission} caption="红色框内为已开通状态：kso.dbsheet.read / kso.dbsheet.readwrite" />
              <Space direction="vertical" size={4}>
                <Text code>kso.dbsheet.read</Text>
                <Text code>kso.dbsheet.readwrite</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  每个 scope 分别有 app 和 user 两种权限类型，共 4 条，全部开通即可。
                </Text>
              </Space>
            </StepSection>
          </>
        );

      case 2:
        return (
          <StepSection title="左侧菜单进入「开发配置 → 历史配置」">
            <Paragraph type="secondary" style={{ marginBottom: 12 }}>
              把「旧版 OAuth2.0 回调地址」设置为下面这个地址。它只用于把授权码转发回浏览器，你不需要自己搭服务器。
            </Paragraph>
            <StepFigure src={STEP_IMAGES.callback} caption="填入后记得保存，地址需与下一步完全一致" />
            <Input
              readOnly
              value={REDIRECT_URI}
              addonAfter={
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copyText(REDIRECT_URI, '回调地址')}
                >
                  复制
                </Button>
              }
            />
          </StepSection>
        );

      case 3:
        return (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="授权码 code 只能用一次，且几分钟内有效。拿到后请立刻粘贴到下面并进入下一步。"
            />
            <StepSection title="① 打开授权页并同意授权">
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                链接会带上你刚才填的应用ID，点开后在 WPS 登录并点击「同意」。
              </Paragraph>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<ExportOutlined />}
                  disabled={!clientId.trim()}
                  onClick={() =>
                    window.open(buildAuthUrl(clientId.trim()), '_blank', 'noopener,noreferrer')
                  }
                >
                  打开 WPS 授权页
                </Button>
                <Button
                  icon={<CopyOutlined />}
                  disabled={!clientId.trim()}
                  onClick={() => copyText(buildAuthUrl(clientId.trim()), '授权链接')}
                >
                  复制授权链接
                </Button>
              </Space>
              {!clientId.trim() && (
                <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                  未获取到应用ID，请回到第 1 步填写并保存凭据。
                </Paragraph>
              )}
            </StepSection>
            <StepSection title="② 复制地址栏里的 code 并粘贴到下面">
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                授权成功后浏览器会跳到 <Text code>https://www.baidu.com/?code=...</Text>，
                把<Text strong>整条地址</Text>或其中 code 部分粘贴即可，系统会自动识别。
              </Paragraph>
              <Input.TextArea
                rows={3}
                value={codeInput}
                onChange={e => setCodeInput(e.target.value)}
                placeholder="https://www.baidu.com/?code=kso_ac_xxxxxxxx&state=..."
              />
              {extractedCode && (
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    已识别授权码：
                  </Text>
                  <Paragraph
                    copyable={{ text: extractedCode, tooltips: ['复制授权码', '已复制'] }}
                    style={{ marginBottom: 0 }}
                  >
                    <Text code>{extractedCode.slice(0, 40)}…</Text>
                  </Paragraph>
                </div>
              )}
            </StepSection>
          </>
        );

      default:
        return (
          <>
            {exchangeDone ? (
              <Alert
                type="success"
                showIcon
                icon={<CheckCircleOutlined />}
                message="Token 已获取并保存"
                description="系统后续会自动刷新 access_token，无需再手动操作。点击「完成」关闭向导。"
                style={{ marginBottom: 16 }}
              />
            ) : (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="这一步原本需要在 Postman 里手工拼请求，现在由系统代发，你只需点一个按钮。"
              />
            )}
            <StepSection title="点击下方按钮完成换取">
              <Paragraph type="secondary" style={{ marginBottom: 12 }}>
                系统会把授权码连同应用凭据一起发给 WPS，换取 access_token 与 refresh_token，并立即保存到数据库。
              </Paragraph>
              <Button
                type="primary"
                size="large"
                icon={<ThunderboltOutlined />}
                loading={exchanging}
                disabled={!extractedCode || exchangeDone}
                onClick={handleExchange}
              >
                换取并保存 Token
              </Button>
            </StepSection>
          </>
        );
    }
  };

  return (
    <Modal
      open={open}
      title="WPS Token 获取引导（约 2 分钟）"
      onCancel={resetAndClose}
      width={880}
      style={{ top: 24 }}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      destroyOnHidden
      footer={[
        <Button key="prev" disabled={current === 0} onClick={() => setCurrent(c => c - 1)}>
          上一步
        </Button>,
        current < steps.length - 1 ? (
          <Button key="next" type="primary" disabled={!canGoNext} onClick={() => setCurrent(c => c + 1)}>
            下一步
          </Button>
        ) : (
          <Button key="done" type="primary" onClick={resetAndClose}>
            完成
          </Button>
        ),
      ]}
    >
      <Steps
        current={current}
        size="small"
        items={steps}
        onChange={index => {
          // 只允许回看已完成的步骤，避免跳过前置条件
          if (index < current) setCurrent(index);
        }}
        style={{ marginBottom: 24 }}
      />
      {renderStep()}
    </Modal>
  );
}