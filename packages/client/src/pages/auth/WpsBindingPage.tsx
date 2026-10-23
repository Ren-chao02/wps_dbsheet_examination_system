import { useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Button, Form, Input, Result, Spin } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { LoginResponse } from '../../types';
import { AuthShell } from './AuthShell';
import { roleHome, takeLoginReturnUrl } from './auth-helpers';

interface WpsPending {
  name: string;
  avatar: string;
}

interface BindFormValues {
  identifier: string;
  password: string;
}

/**
 * WPS 首次登录绑定页：
 * WPS 授权成功但本地账号还没绑定 WPS 身份时，要求验证一次本地学号/工号 + 密码。
 * 绑定成功后写入 User.wpsUserId，下次 SSO 直接登录。
 */
export function WpsBindingPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [form] = Form.useForm<BindFormValues>();

  const [pending, setPending] = useState<WpsPending | null>(null);
  const [loadingPending, setLoadingPending] = useState(true);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  const initialIdentifier = useMemo(
    () => localStorage.getItem('login_last_identifier') || '',
    [],
  );

  useEffect(() => {
    let alive = true;
    api
      .get('/auth/wps/pending')
      .then((res) => {
        if (alive) setPending(res.data);
      })
      .catch((err) => {
        if (!alive) return;
        if (err?.response?.status === 401) setExpired(true);
        else setErrorText(err?.response?.data?.message || 'WPS 登录信息已失效');
      })
      .finally(() => {
        if (alive) setLoadingPending(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onFinish = async (values: BindFormValues) => {
    setSubmitting(true);
    setErrorText('');
    try {
      const res = await api.post<LoginResponse>('/auth/wps/bind', {
        identifier: values.identifier.trim(),
        password: values.password,
      });
      login(res.data.user, res.data.token, res.data.permissions);
      localStorage.setItem('login_last_identifier', values.identifier.trim());
      navigate(takeLoginReturnUrl() || roleHome(res.data.user.role), { replace: true });
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;

      if (status === 401 && data?.code === 'WPS_BIND_EXPIRED') {
        setExpired(true);
      } else if (status === 423) {
        const until = data?.lockedUntil ? new Date(data.lockedUntil) : null;
        setErrorText(
          until
            ? `登录失败次数过多，账号已锁定，请在 ${until.toLocaleTimeString('zh-CN', {
                hour12: false,
              })} 后重试`
            : '登录失败次数过多，账号已锁定，请稍后重试',
        );
      } else if (status === 400 && data?.code === 'INVALID_CREDENTIALS') {
        setErrorText(data?.message || '账号或密码错误');
        form.setFieldValue('password', '');
      } else {
        setErrorText(data?.message || '绑定失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingPending) {
    return (
      <AuthShell>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, fontSize: 13, color: '#6f6767' }}>
            正在读取 WPS 账号信息…
          </div>
        </div>
      </AuthShell>
    );
  }

  if (expired) {
    return (
      <AuthShell>
        <Result
          status="warning"
          title="绑定会话已过期"
          subTitle="请重新使用 WPS 账号登录；如果仍然无法绑定，请联系管理员。"
          extra={[
            <Button
              key="retry"
              type="primary"
              onClick={() => {
                window.location.href = '/api/auth/wps/authorize';
              }}
            >
              重新使用 WPS 登录
            </Button>,
            <Button key="back" onClick={() => navigate('/login', { replace: true })}>
              返回登录
            </Button>,
          ]}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="auth-form">
        <div className="auth-eyebrow">WPS ACCOUNT</div>
        <h2 className="auth-title">绑定 WPS 账号</h2>
        <p className="auth-subtitle">
          首次使用 WPS 登录，需要验证一次本地账号，之后即可一键登录。
        </p>

        <div className="auth-binding-profile">
          <Avatar size={44} src={pending?.avatar || undefined} icon={<UserOutlined />} />
          <div>
            <div className="auth-binding-name">{pending?.name || 'WPS 用户'}</div>
            <div className="auth-binding-hint">WPS 身份已授权，等待绑定</div>
          </div>
        </div>

        {errorText && (
          <Alert
            className="auth-alert"
            type="error"
            showIcon
            message={errorText}
            style={{ marginTop: 16 }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={onFinish}
          initialValues={{ identifier: initialIdentifier }}
          className="auth-form__fields"
        >
          <Form.Item
            name="identifier"
            label="学号 / 工号 / 系统账号"
            rules={[{ required: true, message: '请输入学号、工号或系统账号' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="学号 / 工号 / 系统账号"
              autoComplete="username"
              size="large"
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="本地账号密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="请输入密码"
              autoComplete="current-password"
              size="large"
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={submitting}
            className="auth-submit"
          >
            绑定并登录
          </Button>
        </Form>

        <div className="auth-binding-links">
          <button
            type="button"
            className="auth-text-link"
            onClick={() => {
              window.location.href = '/api/auth/wps/authorize';
            }}
          >
            换一个 WPS 账号
          </button>
          <span>·</span>
          <button type="button" className="auth-text-link" onClick={() => navigate('/login')}>
            返回账号密码登录
          </button>
        </div>

        <div className="auth-note">
          绑定后，该 WPS 账号只能登录当前本地账号；如需换绑请联系管理员。
        </div>
      </div>
    </AuthShell>
  );
}
