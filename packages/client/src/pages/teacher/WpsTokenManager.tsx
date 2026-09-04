import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Typography,
  Button,
  Space,
  Alert,
  Statistic,
  Tag,
  Row,
  Col,
  message,
  Spin,
  Empty,
  Input,
  Form,
  Progress,
  Upload,
  Modal,
} from 'antd';
import {
  ReloadOutlined,
  SafetyOutlined,
  ClockCircleOutlined,
  KeyOutlined,
  SaveOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';
import api from '../../services/api';

const { Title, Text, Paragraph } = Typography;

interface WpsTokenRefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  tokenType: string;
}

export function WpsTokenManager() {
  const { wpsToken, setWpsToken, clearWpsToken, getWpsTokenRemainingSeconds } = useAuthStore();
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [manualFormVisible, setManualFormVisible] = useState(false);
  const [manualForm] = Form.useForm();
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [refreshForm] = Form.useForm();
  const [credentialForm] = Form.useForm();
  const [credConfigured, setCredConfigured] = useState(false);
  const [credSaving, setCredSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
    setRemainingSeconds(getWpsTokenRemainingSeconds());

    // 启动时从服务端加载持久化的 Token
    const loadFromServer = async () => {
      try {
        const res = await api.get('/wps-config');
        if (res.data?.data) {
          const serverToken = res.data.data;
          setWpsToken({
            accessToken: serverToken.accessToken,
            refreshToken: serverToken.refreshToken,
            expiresAt: serverToken.expiresAt,
            refreshExpiresAt: serverToken.refreshExpiresAt,
          });
        }
      } catch {
        // 服务端无数据，使用本地 localStorage 中的 token（已在 store init 中加载）
      }
    };
    loadFromServer();

    // 加载已保存的 WPS 应用凭据（DB 优先，回退环境变量）
    const loadCredentials = async () => {
      try {
        const cred = await api.get('/wps-token/credentials');
        if (cred.data?.apiKey || cred.data?.apiSecret) {
          credentialForm.setFieldsValue({
            clientId: cred.data.apiKey,
            clientSecret: cred.data.apiSecret,
          });
        }
        setCredConfigured(!!cred.data?.configured);
      } catch {
        // 忽略加载失败
      }
    };
    loadCredentials();
  }, [getWpsTokenRemainingSeconds, setWpsToken, credentialForm]);

  // 每秒更新倒计时
  useEffect(() => {
    if (!wpsToken) return;
    const timer = setInterval(() => {
      setRemainingSeconds(getWpsTokenRemainingSeconds());
    }, 1000);
    return () => clearInterval(timer);
  }, [wpsToken, getWpsTokenRemainingSeconds]);

  const formatRemainingTime = (seconds: number) => {
    if (seconds <= 0) return '已过期';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const statusColor = useMemo(() => {
    if (remainingSeconds <= 0) return 'error';
    if (remainingSeconds < 600) return 'warning'; // 小于10分钟
    if (remainingSeconds < 1800) return 'processing'; // 小于30分钟
    return 'success';
  }, [remainingSeconds]);

  const statusText = useMemo(() => {
    if (remainingSeconds <= 0) return '已过期';
    if (remainingSeconds < 600) return '即将过期';
    if (remainingSeconds < 1800) return '有效期较短';
    return '正常';
  }, [remainingSeconds]);

  const handleRefresh = async () => {
    if (!wpsToken?.refreshToken) {
      message.warning('没有可用的 refresh_token，请手动回填 Token');
      return;
    }
    // 预填表单
    refreshForm.setFieldsValue({
      grantType: 'refresh_token',
      refreshToken: wpsToken.refreshToken,
      clientId: '',
      clientSecret: '',
    });
    // 尝试从服务端拉取已保存的凭据
    try {
      const cred = await api.get('/wps-token/credentials');
      if (cred.data.apiKey && cred.data.apiSecret) {
        refreshForm.setFieldsValue({
          clientId: cred.data.apiKey,
          clientSecret: cred.data.apiSecret,
        });
      }
    } catch {
      // 获取失败，保持空值让用户手动填写
    }
    setRefreshModalOpen(true);
  };

  const handleRefreshSubmit = async () => {
    try {
      const values = await refreshForm.validateFields();
      setRefreshing(true);

      // 如果填写了 client_id/client_secret，同步保存到服务端 .env
      if (values.clientId && values.clientSecret) {
        try {
          await api.post('/wps-token/credentials', {
            apiKey: values.clientId,
            apiSecret: values.clientSecret,
          });
        } catch {
          // 凭据保存失败不阻塞刷新流程
        }
      }

      const res = await api.post<WpsTokenRefreshResponse>('/wps-token/refresh', {
        refreshToken: values.refreshToken,
        clientId: values.clientId || undefined,
        clientSecret: values.clientSecret || undefined,
      });

      const expiresAt = Date.now() + res.data.expiresIn * 1000;
      const refreshExpiresAt = Date.now() + res.data.refreshExpiresIn * 1000;

      setWpsToken({
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken,
        expiresAt,
        refreshExpiresAt,
      });

      setRemainingSeconds(res.data.expiresIn);
      setRefreshModalOpen(false);

      // 持久化到服务端
      try {
        await api.post('/wps-config', {
          accessToken: res.data.accessToken,
          refreshToken: res.data.refreshToken,
          expiresIn: res.data.expiresIn,
          refreshExpiresIn: res.data.refreshExpiresIn || 2592000,
        });
      } catch {
        // 服务端持久化失败不阻塞
      }

      message.success('access_token 刷新成功');
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.detail || '刷新失败';
      message.error(msg);
      if (err.response?.status === 400 || err.response?.data?.code) {
        // refresh_token 可能已失效
        clearWpsToken();
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleClear = () => {
    clearWpsToken();
    // 同时清除服务端 Token
    api.delete('/wps-config').catch(() => {});
    message.success('已清除本地和服务端 Token 缓存');
  };

  const handleManualUpdate = async (values: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn?: number;
  }) => {
    if (!values.accessToken) {
      message.warning('access_token 不能为空');
      return;
    }

    const expiresAt = Date.now() + values.expiresIn * 1000;
    const refreshExpiresAt = values.refreshExpiresIn
      ? Date.now() + values.refreshExpiresIn * 1000
      : wpsToken?.refreshExpiresAt;

    setWpsToken({
      accessToken: values.accessToken,
      refreshToken: values.refreshToken || wpsToken?.refreshToken || '',
      expiresAt,
      refreshExpiresAt,
    });

    setRemainingSeconds(values.expiresIn);
    setManualFormVisible(false);
    manualForm.resetFields();

    // 持久化到服务端
    try {
      await api.post('/wps-config', {
        accessToken: values.accessToken,
        refreshToken: values.refreshToken || '',
        expiresIn: values.expiresIn || 7200,
        refreshExpiresIn: values.refreshExpiresIn || 2592000,
      });
    } catch {
      // 服务端持久化失败不阻塞
    }

    message.success('Token 已手动更新');
  };

  const handleSaveCredentials = async () => {
    try {
      const values = await credentialForm.validateFields();
      setCredSaving(true);
      await api.post('/wps-token/credentials', {
        apiKey: values.clientId,
        apiSecret: values.clientSecret,
      });
      setCredConfigured(true);
      message.success('WPS 应用凭据已保存，自动刷新将立即使用');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || '保存凭据失败';
      message.error(msg);
    } finally {
      setCredSaving(false);
    }
  };

  if (!mounted) {
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
          <KeyOutlined style={{ marginRight: 12 }} />
          WPS Token 管理
        </Title>
        <Text type="secondary">
          管理调用 WPS 开放 API 所需的 access_token，每次从真实接口返回数据都需要有效的 access_token，有效期为 2 小时。
        </Text>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Card
          title={
            <Space>
              <SafetyOutlined />
              应用凭据配置（client_id / client_secret）
            </Space>
          }
          extra={
            <Tag color={credConfigured ? 'success' : 'warning'}>
              {credConfigured ? '已配置' : '未配置'}
            </Tag>
          }
        >
          <Alert
            type="info"
            showIcon
            message="克隆项目部署后，在此填写一次金山开放平台的应用凭据即可，无需修改 .env。保存后自动刷新会立即使用该凭据。"
            style={{ marginBottom: 16 }}
          />
          <Form form={credentialForm} layout="inline" onFinish={handleSaveCredentials}>
            <Form.Item
              name="clientId"
              label="client_id"
              rules={[{ required: true, message: '请输入 client_id' }]}
              style={{ flex: '1 1 300px', marginBottom: 12 }}
            >
              <Input.Password placeholder="金山开放平台应用 client_id" />
            </Form.Item>
            <Form.Item
              name="clientSecret"
              label="client_secret"
              rules={[{ required: true, message: '请输入 client_secret' }]}
              style={{ flex: '1 1 300px', marginBottom: 12 }}
            >
              <Input.Password placeholder="金山开放平台应用 client_secret" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 12 }}>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={credSaving}>
                保存凭据
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {!wpsToken && (
          <Card>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无 WPS access_token"
            >
              <Space direction="vertical" style={{ width: '100%' }} align="center">
                <Text type="secondary">
                  请从 WPS API Explorer 获取 access_token 后，点击下方按钮手动回填。
                </Text>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  size="large"
                  onClick={() => { setManualFormVisible(true); manualForm.resetFields(); }}
                >
                  手动回填 Token
                </Button>
              </Space>
            </Empty>
          </Card>
        )}

        {wpsToken && (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card title="access_token 剩余有效期">
                  <Statistic
                    value={formatRemainingTime(remainingSeconds)}
                    valueStyle={{ color: remainingSeconds <= 600 ? '#ff4d4f' : '#52c41a', fontSize: 32 }}
                    prefix={<ClockCircleOutlined />}
                  />
                  <Progress
                    percent={Math.max(0, Math.min(100, (remainingSeconds / 7200) * 100))}
                    status={remainingSeconds <= 600 ? 'exception' : 'success'}
                    showInfo={false}
                    style={{ marginTop: 16 }}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Tag color={statusColor}>{statusText}</Tag>
                    <Text type="secondary" style={{ marginLeft: 12 }}>
                      总有效期 2 小时
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="refresh_token 有效期">
                  <Statistic
                    value={wpsToken.refreshExpiresAt
                      ? formatRemainingTime(Math.floor((wpsToken.refreshExpiresAt - Date.now()) / 1000))
                      : '未知'}
                    valueStyle={{ fontSize: 32 }}
                    prefix={<SafetyOutlined />}
                  />
                  <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
                    <Text type="secondary">
                      refresh_token 通常有效期为 30 天，过期后需要重新授权。
                    </Text>
                  </Paragraph>
                </Card>
              </Col>
            </Row>

            <Card title="当前 access_token">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.Password
                  value={wpsToken.accessToken}
                  visibilityToggle={false}
                  readOnly
                  addonBefore={<KeyOutlined />}
                />
              </Space>
            </Card>

            <Card title="当前 refresh_token">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.Password
                  value={wpsToken.refreshToken || '无'}
                  visibilityToggle={false}
                  readOnly
                  addonBefore={<SafetyOutlined />}
                />
              </Space>
            </Card>
          </>
        )}

        <Card title="Token 操作" style={{ marginTop: 8 }}>
          <Space size="middle" wrap>
            {wpsToken && (
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={handleRefresh}
                size="large"
              >
                刷新 access_token
              </Button>
            )}
            <Button
              icon={<SaveOutlined />}
              onClick={() => { setManualFormVisible(v => !v); if (!manualFormVisible) manualForm.resetFields(); }}
              size="large"
            >
              手动回填 Token
            </Button>
            {wpsToken ? (
              <>
                <Button
                  danger
                  onClick={handleClear}
                  size="large"
                >
                  清除本地缓存
                </Button>
              </>
            ) : null}
          </Space>
        </Card>

        {manualFormVisible && (
          <Card title="手动回填 Token">
            <Alert
              type="info"
              showIcon
              message="从 WPS API Explorer 获得新 token 后，可在此回填到系统。"
              style={{ marginBottom: 16 }}
            />
            <Card size="small" title="一键解析 JSON" style={{ marginBottom: 16 }}>
              <Upload.Dragger
                accept=".json"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    try {
                      const json = JSON.parse(e.target?.result as string);
                      manualForm.setFieldsValue({
                        accessToken: json.access_token || '',
                        refreshToken: json.refresh_token || '',
                        expiresIn: json.expires_in || 7200,
                        refreshExpiresIn: json.refresh_expires_in || 2592000,
                      });
                      message.success('已自动识别并填充下方字段（有效期已从 JSON 中提取）');
                    } catch {
                      message.error('JSON 格式无效，请检查文件内容');
                    }
                  };
                  reader.readAsText(file);
                  return false; // 阻止自动上传
                }}
              >
                <p className="ant-upload-drag-icon" style={{ marginBottom: 0 }}>
                  <UploadOutlined style={{ fontSize: 24, color: '#1677ff' }} />
                </p>
                <p className="ant-upload-text">点击或拖拽上传 token.json</p>
                <p className="ant-upload-hint">从 API Explorer 下载的 JSON 文件</p>
              </Upload.Dragger>
            </Card>
            <Form
              form={manualForm}
              layout="vertical"
              onFinish={handleManualUpdate}
            >
              <Form.Item
                name="accessToken"
                label="access_token"
                rules={[{ required: true, message: '请输入 access_token' }]}
              >
                <Input.TextArea rows={3} placeholder="从 API Explorer 复制 access_token" />
              </Form.Item>
              <Form.Item
                name="refreshToken"
                label="refresh_token（可选）"
              >
                <Input.TextArea rows={3} placeholder="不填则保留当前 refresh_token" />
              </Form.Item>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="expiresIn"
                    label="有效期（秒）"
                    rules={[{ required: true, message: '请输入有效期' }]}
                  >
                    <Input type="number" placeholder="7200" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="refreshExpiresIn"
                    label="refresh_token 有效期（秒，可选）"
                  >
                    <Input type="number" placeholder="2592000" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit">
                    保存到系统
                  </Button>
                  <Button onClick={() => setManualFormVisible(false)}>
                    取消
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </Card>
        )}

        <Modal
          title="刷新 access_token"
          open={refreshModalOpen}
          onCancel={() => setRefreshModalOpen(false)}
          onOk={handleRefreshSubmit}
          confirmLoading={refreshing}
          okText="刷新"
          cancelText="取消"
          destroyOnClose
        >
          <Form form={refreshForm} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item name="grantType" label="grant_type">
              <Input readOnly disabled />
            </Form.Item>
            <Form.Item
              name="refreshToken"
              label="refresh_token"
              rules={[{ required: true, message: '请输入 refresh_token' }]}
            >
              <Input.Password placeholder="refresh_token" />
            </Form.Item>
            <Form.Item name="clientId" label="client_id（可选）">
              <Input.Password placeholder="App Key，不填则使用服务端配置" />
            </Form.Item>
            <Form.Item name="clientSecret" label="client_secret（可选）">
              <Input.Password placeholder="App Secret，不填则使用服务端配置" />
            </Form.Item>
          </Form>
        </Modal>

        {wpsToken && remainingSeconds <= 600 && remainingSeconds > 0 && (
          <Alert
            message="access_token 即将过期"
            description="Token 剩余有效期不足 10 分钟，建议立即刷新以避免接口调用失败。"
            type="warning"
            showIcon
            action={
              <Button type="primary" danger size="small" loading={refreshing} onClick={handleRefresh}>
                立即刷新
              </Button>
            }
          />
        )}

        {wpsToken && remainingSeconds <= 0 && (
          <Alert
            message="access_token 已过期"
            description="当前 Token 已失效，请手动回填新 Token。"
            type="error"
            showIcon
            action={
              <Button type="primary" danger size="small" loading={refreshing} onClick={handleRefresh}>
                立即刷新
              </Button>
            }
          />
        )}
      </Space>
    </div>
  );
}
