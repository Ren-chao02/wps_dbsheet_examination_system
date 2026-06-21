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
  Divider,
} from 'antd';
import {
  ReloadOutlined,
  LinkOutlined,
  SafetyOutlined,
  ClockCircleOutlined,
  KeyOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  CopyOutlined,
  ExperimentOutlined,
  SaveOutlined,
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
  const [showToken, setShowToken] = useState(false);
  const [manualFormVisible, setManualFormVisible] = useState(false);
  const [manualForm] = Form.useForm();

  useEffect(() => {
    setMounted(true);
    setRemainingSeconds(getWpsTokenRemainingSeconds());
  }, [getWpsTokenRemainingSeconds]);

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
      message.warning('没有可用的 refresh_token，请先完成 WPS 授权');
      return;
    }

    setRefreshing(true);
    try {
      const res = await api.post<WpsTokenRefreshResponse>('/wps-token/refresh', {
        refreshToken: wpsToken.refreshToken,
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

  const handleAuthorize = () => {
    const clientId = import.meta.env.VITE_WPS_CLIENT_ID || '';
    const redirectUri = `${window.location.origin}/teacher/wps-token`;
    const authUrl = `https://open.wps.cn/oauth2/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=all`;
    window.location.href = authUrl;
  };

  const handleClear = () => {
    clearWpsToken();
    message.success('已清除本地 Token 缓存');
  };

  const handleCopyToken = () => {
    if (!wpsToken?.accessToken) return;
    navigator.clipboard.writeText(wpsToken.accessToken).then(() => {
      message.success('access_token 已复制到剪贴板');
    }).catch(() => {
      message.error('复制失败，请手动复制');
    });
  };

  const handleOpenApiExplorer = () => {
    window.open('https://open.wps.cn/api-explorer/', '_blank');
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
    message.success('Token 已手动更新');
  };

  // 页面加载时处理 OAuth 回调 code
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    const exchangeCode = async () => {
      setRefreshing(true);
      try {
        const redirectUri = `${window.location.origin}/teacher/wps-token`;
        const res = await api.post<WpsTokenRefreshResponse>('/wps-token', {
          code,
          redirectUri,
        });

        const expiresAt = Date.now() + res.data.expiresIn * 1000;
        const refreshExpiresAt = Date.now() + res.data.refreshExpiresIn * 1000;

        setWpsToken({
          accessToken: res.data.accessToken,
          refreshToken: res.data.refreshToken,
          expiresAt,
          refreshExpiresAt,
        });

        // 清除 URL 上的 code 参数
        window.history.replaceState({}, document.title, window.location.pathname);
        message.success('WPS 授权成功，access_token 已获取');
      } catch (err: any) {
        const msg = err.response?.data?.message || err.response?.data?.detail || '授权失败';
        message.error(msg);
      } finally {
        setRefreshing(false);
      }
    };

    exchangeCode();
  }, [setWpsToken]);

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

      {!wpsToken ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无 WPS access_token"
          >
            <Space direction="vertical" style={{ width: '100%' }} align="center">
              <Text type="secondary">
                点击下方的"前往 WPS 授权"按钮，完成 OAuth2 授权后即可获取 access_token。
              </Text>
              <Button
                type="primary"
                icon={<LinkOutlined />}
                size="large"
                onClick={handleAuthorize}
              >
                前往 WPS 授权
              </Button>
            </Space>
          </Empty>
        </Card>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
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
                suffix={
                  <Space>
                    <Button
                      type="text"
                      icon={showToken ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                      onClick={() => setShowToken(s => !s)}
                      title={showToken ? '隐藏' : '显示'}
                    />
                    <Button
                      type="text"
                      icon={<CopyOutlined />}
                      onClick={handleCopyToken}
                      title="复制"
                    />
                  </Space>
                }
              />
              {showToken && (
                <Paragraph copyable={{ text: wpsToken.accessToken }}>
                  <Text code style={{ wordBreak: 'break-all' }}>{wpsToken.accessToken}</Text>
                </Paragraph>
              )}
            </Space>
          </Card>

          <Card title="Token 操作" style={{ marginTop: 8 }}>
            <Space size="middle" wrap>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={handleRefresh}
                size="large"
              >
                刷新 access_token
              </Button>
              <Button
                icon={<ExperimentOutlined />}
                onClick={handleOpenApiExplorer}
                size="large"
              >
                在 API Explorer 刷新
              </Button>
              <Button
                icon={<SaveOutlined />}
                onClick={() => setManualFormVisible(v => !v)}
                size="large"
              >
                手动回填 Token
              </Button>
              <Button
                icon={<LinkOutlined />}
                onClick={handleAuthorize}
                size="large"
              >
                重新授权
              </Button>
              <Button
                danger
                onClick={handleClear}
                size="large"
              >
                清除本地缓存
              </Button>
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
              <Form
                form={manualForm}
                layout="vertical"
                onFinish={handleManualUpdate}
                initialValues={{ expiresIn: 7200, refreshExpiresIn: 2592000 }}
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

          {remainingSeconds <= 600 && remainingSeconds > 0 && (
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

          {remainingSeconds <= 0 && (
            <Alert
              message="access_token 已过期"
              description="当前 Token 已失效，请刷新或重新授权。"
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
      )}
    </div>
  );
}
