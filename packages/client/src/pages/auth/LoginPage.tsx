import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, Form, Input, Modal, Segmented, Typography, message } from 'antd';
import {
  LockOutlined,
  UserOutlined,
  SafetyOutlined,
  ReloadOutlined,
  RightOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { LoginResponse } from '../../types';
import { AuthShell } from './AuthShell';
import { roleHome, takeLoginReturnUrl } from './auth-helpers';
import {
  LEGACY_IDENTIFIER_STORAGE_KEY,
  LOGIN_ROLE_STORAGE_KEY,
  getLoginRoleMeta,
  identifierStorageKey,
  normalizeLoginRole,
  readRememberedIdentifier,
  type LoginRole,
} from './login-roles';
import { extractInvitationCode } from '../../utils/invitation-code';

const { Paragraph } = Typography;

interface LoginFormValues {
  identifier: string;
  password: string;
  captchaText: string;
}

interface CaptchaFieldProps {
  value?: string;
  onChange?: (value: string) => void;
  svg: string;
  loading: boolean;
  onRefresh: () => void;
}

/** 验证码输入 + 可点击刷新的 SVG 图片（Form.Item 会把 value/onChange 注入进来） */
function CaptchaField({ value, onChange, svg, loading, onRefresh }: CaptchaFieldProps) {
  return (
    <div className="auth-captcha-row">
      <Input
        prefix={<SafetyOutlined />}
        placeholder="验证码"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        autoComplete="off"
        size="large"
      />
      <button
        type="button"
        className="auth-captcha"
        onClick={onRefresh}
        aria-label="刷新验证码"
        title="点击刷新验证码"
      >
        {loading ? (
          <ReloadOutlined spin />
        ) : svg ? (
          <span dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <ReloadOutlined />
        )}
      </button>
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

const SSO_ERROR_MESSAGES: Record<string, string> = {
  wps_cancelled: '已取消 WPS 授权登录',
  wps_error: 'WPS 登录失败，请稍后重试或使用账号密码登录',
  wps_unavailable: 'WPS 登录暂不可用，请使用账号密码登录',
  invalid_state: '登录请求已过期，请重新尝试',
  account_disabled: '账号已被禁用，请联系管理员',
};

const ROLE_ICONS: Record<LoginRole, ReactNode> = {
  student: <UserOutlined />,
  teacher: <ReadOutlined />,
  admin: <SafetyCertificateOutlined />,
};

const ROLE_OPTIONS = (['student', 'teacher', 'admin'] as LoginRole[]).map((value) => ({
  value,
  label: (
    <span className="auth-role-switch__label">
      {ROLE_ICONS[value]}
      {getLoginRoleMeta(value).label}
    </span>
  ),
}));

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isLoading, user } = useAuthStore();
  const [form] = Form.useForm<LoginFormValues>();

  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [rememberAccount, setRememberAccount] = useState(true);
  const [rememberMe, setRememberMe] = useState(false);

  const [errorText, setErrorText] = useState('');
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // 刚在本页登录成功时不要被「已登录自动回首页」的 effect 抢先跳走：
  // 那条 effect 只负责处理「本来已登录却访问 /login」的情况。
  const didJustLogin = useRef(false);

  // 身份入口只是引导：默认学生，下次打开沿用上次选中的入口。
  const [role, setRole] = useState<LoginRole>(() =>
    normalizeLoginRole(localStorage.getItem(LOGIN_ROLE_STORAGE_KEY)),
  );
  const roleMeta = getLoginRoleMeta(role);
  const [initialIdentifier] = useState(() => readRememberedIdentifier(role, localStorage));
  // 每个身份各自保留正在输入的账号，切回来不丢；密码永不跨身份携带。
  const identifierDrafts = useRef<Partial<Record<LoginRole, string>>>({});

  const fetchCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await api.get('/auth/captcha');
      setCaptchaSvg(res.data.svg);
      setCaptchaToken(res.data.captchaToken);
      form.setFieldValue('captchaText', '');
    } catch {
      setErrorText('验证码加载失败，请点击验证码区域重试');
    } finally {
      setCaptchaLoading(false);
    }
  }, [form]);

  useEffect(() => {
    void fetchCaptcha();
    let alive = true;
    api
      .get('/auth/config')
      .then((res) => {
        if (alive) setSsoEnabled(Boolean(res.data?.wpsSsoEnabled));
      })
      .catch(() => {
        // SSO 是否可用不影响账号密码登录
      });
    return () => {
      alive = false;
    };
  }, [fetchCaptcha]);

  // 已登录用户访问 /login：直接回角色首页（优先回到会话过期前的位置）
  useEffect(() => {
    if (didJustLogin.current) return;
    if (isLoading || !isAuthenticated || !user) return;
    navigate(takeLoginReturnUrl() || roleHome(user.role), { replace: true });
  }, [isLoading, isAuthenticated, user, navigate]);

  // SSO 回跳失败时在表单顶部给出可读原因，并清理 URL 参数
  useEffect(() => {
    const code = new URLSearchParams(location.search).get('sso_error');
    if (!code) return;
    setErrorText(SSO_ERROR_MESSAGES[code] || 'WPS 登录失败，请使用账号密码登录');
    navigate('/login', { replace: true });
  }, [location.search, navigate]);

  // 锁定时每秒刷新倒计时
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const lockRemaining = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil.getTime() - now) / 1000))
    : 0;

  useEffect(() => {
    if (lockedUntil && lockRemaining <= 0) {
      setLockedUntil(null);
      setNow(Date.now());
      setErrorText('');
      void fetchCaptcha();
    }
  }, [lockedUntil, lockRemaining, fetchCaptcha]);

  const handleLoginError = (err: any) => {
    const status = err?.response?.status;
    const data = err?.response?.data;

    if (status === 423) {
      const until = data?.lockedUntil ? new Date(data.lockedUntil) : null;
      const validUntil = until && !Number.isNaN(until.getTime()) ? until : null;
      setLockedUntil(validUntil);
      setErrorText(validUntil ? '' : '登录失败次数过多，账号已锁定，请稍后重试');
      setNow(Date.now());
    } else if (status === 429) {
      setErrorText(data?.message || '登录尝试过于频繁，请稍后再试');
    } else if (status === 403 && data?.code === 'ACCOUNT_DISABLED') {
      setErrorText(data?.message || '账号已被禁用，请联系管理员');
    } else if (status === 400 && data?.code === 'CAPTCHA_INVALID') {
      setErrorText(data?.message || '验证码错误或已过期，请重新输入');
    } else if (status === 401) {
      setErrorText('账号或密码错误，请检查后重试');
      form.setFieldValue('password', '');
    } else {
      setErrorText(data?.message || '登录失败，请稍后重试');
    }

    // 服务端在验证码校验后就会消费掉 token，失败后必须换一张
    void fetchCaptcha();
  };

  const handleRoleChange = (nextRole: LoginRole) => {
    if (nextRole === role) return;

    identifierDrafts.current[role] = String(form.getFieldValue('identifier') ?? '');
    // 切换后只找该身份自己的记录，旧版单一账号只在首次进入时兜底，
    // 避免把学生账号带到管理员输入框里。
    const nextIdentifier =
      identifierDrafts.current[nextRole] ??
      localStorage.getItem(identifierStorageKey(nextRole)) ??
      '';

    setRole(nextRole);
    localStorage.setItem(LOGIN_ROLE_STORAGE_KEY, nextRole);
    // 换身份就是换一次登录尝试：清掉上一位的报错/锁定提示，密码不随行；
    // 验证码仍属于同一张表单，保留不刷新。
    setErrorText('');
    setLockedUntil(null);
    setNow(Date.now());
    form.setFieldsValue({ identifier: nextIdentifier, password: '' });
    form.setFields([
      { name: 'identifier', errors: [] },
      { name: 'password', errors: [] },
      { name: 'captchaText', errors: [] },
    ]);
  };

  const onFinish = async (values: LoginFormValues) => {
    if (lockRemaining > 0) return;
    setSubmitting(true);
    setErrorText('');

    try {
      const res = await api.post<LoginResponse & { expiresIn?: string }>('/auth/login', {
        identifier: values.identifier.trim(),
        password: values.password,
        captchaToken,
        captchaText: values.captchaText,
        rememberMe,
      });

      didJustLogin.current = true;
      login(res.data.user, res.data.token, res.data.permissions);

      // 按账号真实角色记忆，而不是按当前选中的入口：
      // 学生在教师入口登录，也能把学号记到学生这一栏。
      const actualRole = normalizeLoginRole(res.data.user.role);
      const identifier = values.identifier.trim();
      if (rememberAccount) {
        localStorage.setItem(identifierStorageKey(actualRole), identifier);
        localStorage.removeItem(LEGACY_IDENTIFIER_STORAGE_KEY);
      } else {
        localStorage.removeItem(identifierStorageKey(actualRole));
        localStorage.removeItem(LEGACY_IDENTIFIER_STORAGE_KEY);
      }
      // 下次打开直接落在真实身份的入口
      localStorage.setItem(LOGIN_ROLE_STORAGE_KEY, actualRole);

      navigate(takeLoginReturnUrl() || roleHome(res.data.user.role), { replace: true });
      message.success('登录成功');
    } catch (err: any) {
      handleLoginError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitInvite = async () => {
    const code = extractInvitationCode(inviteCode);
    if (!code) {
      setInviteError('请输入正确的邀请链接或邀请码');
      return;
    }

    setInviteLoading(true);
    setInviteError('');
    try {
      const res = await api.get(`/invitations/${code}/info`);
      if (res.data?.status !== 'ACTIVE') {
        setInviteError(
          res.data?.status === 'EXPIRED' ? '该邀请链接已过期' : '该邀请链接已被禁用',
        );
        return;
      }
      setInviteOpen(false);
      navigate(`/join/${code}`);
    } catch (err: any) {
      setInviteError(err?.response?.data?.message || '邀请链接无效或已失效');
    } finally {
      setInviteLoading(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-form">
        <div className="auth-eyebrow">EXAM SYSTEM</div>
        <h2 className="auth-title">登录考试系统</h2>
        <Segmented
          block
          className="auth-role-switch"
          aria-label="选择登录身份"
          value={role}
          options={ROLE_OPTIONS}
          disabled={submitting}
          onChange={(value) => handleRoleChange(value as LoginRole)}
        />
        <p className="auth-subtitle">{roleMeta.subtitle}</p>

        {lockedUntil && lockRemaining > 0 ? (
          <Alert
            className="auth-alert"
            type="warning"
            showIcon
            message={`账号已锁定，请在 ${formatRemaining(lockRemaining)} 后重试`}
            description={`连续登录失败 10 次会触发 15 分钟锁定；${roleMeta.lockAlertHint}`}
          />
        ) : errorText ? (
          <Alert className="auth-alert" type="error" showIcon message={errorText} />
        ) : null}

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
            label={roleMeta.identifierLabel}
            rules={[{ required: true, message: roleMeta.identifierRequired }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder={roleMeta.identifierPlaceholder}
              autoComplete="username"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              autoComplete="current-password"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="captchaText"
            label="验证码"
            rules={[{ required: true, message: '请输入验证码' }]}
          >
            <CaptchaField
              svg={captchaSvg}
              loading={captchaLoading}
              onRefresh={() => void fetchCaptcha()}
            />
          </Form.Item>

          <div className="auth-form__meta">
            <Checkbox checked={rememberAccount} onChange={(e) => setRememberAccount(e.target.checked)}>
              记住账号
            </Checkbox>
            <Checkbox checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}>
              7 天内免登录
            </Checkbox>
            <button type="button" className="auth-text-link" onClick={() => setHelpOpen(true)}>
              登录遇到问题？
            </button>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={submitting}
            disabled={lockRemaining > 0}
            className="auth-submit"
          >
            登 录
          </Button>
          <div className="auth-safe-note">
            连续失败 10 次将锁定 15 分钟 · 公用电脑请勿勾选免登录
          </div>

          {ssoEnabled && roleMeta.showWpsSso && (
            <>
              <div className="auth-divider">其他登录方式</div>
              <Button
                block
                className="auth-sso"
                onClick={() => {
                  window.location.href = '/api/auth/wps/authorize';
                }}
              >
                <span className="auth-sso__mark">W</span>
                WPS 账号登录
              </Button>
            </>
          )}

          {roleMeta.showInvitation && (
            <div className="auth-invite">
              有班级邀请链接？
              <button type="button" className="auth-text-link" onClick={() => setInviteOpen(true)}>
                加入班级 <RightOutlined />
              </button>
            </div>
          )}

          <div className="auth-note">{roleMeta.footerNote}</div>

          {import.meta.env.DEV && (
            <div className="auth-dev">
              测试账号：T2026001 / T2026002（教师）| 20260001 ~ 20260004（学生）| 密码 123456
            </div>
          )}
        </Form>
      </div>

      <Modal
        open={inviteOpen}
        title="加入班级"
        rootClassName="auth-modal"
        okText="继续"
        cancelText="取消"
        confirmLoading={inviteLoading}
        onOk={() => void submitInvite()}
        onCancel={() => setInviteOpen(false)}
        destroyOnHidden
      >
        <Paragraph type="secondary">
          粘贴教师发给你的邀请链接，或直接输入邀请码。提交后按页面提示填写入班信息。
        </Paragraph>
        <Input
          size="large"
          value={inviteCode}
          onChange={(e) => {
            setInviteCode(e.target.value);
            setInviteError('');
          }}
          onPressEnter={() => void submitInvite()}
          placeholder="邀请链接或邀请码"
          autoFocus
        />
        {inviteError && (
          <Alert style={{ marginTop: 12 }} type="error" showIcon message={inviteError} />
        )}
      </Modal>

      <Modal
        open={helpOpen}
        title="登录遇到问题"
        rootClassName="auth-modal"
        footer={
          <Button type="primary" onClick={() => setHelpOpen(false)}>
            知道了
          </Button>
        }
        onCancel={() => setHelpOpen(false)}
      >
        <Paragraph>
          <strong>忘记密码：</strong>
          {roleMeta.help.forgotPassword}
        </Paragraph>
        <Paragraph>
          <strong>账号被锁定：</strong>
          {roleMeta.help.locked}
        </Paragraph>
        <Paragraph>
          <strong>没有账号：</strong>
          {roleMeta.help.noAccount}
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {roleMeta.help.footer}
        </Paragraph>
      </Modal>
    </AuthShell>
  );
}
