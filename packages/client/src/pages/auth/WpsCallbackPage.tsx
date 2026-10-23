import { useEffect, useRef, useState } from 'react';
import { Button, Result, Spin } from 'antd';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { User } from '../../types';
import { AuthShell } from './AuthShell';
import { roleHome, takeLoginReturnUrl } from './auth-helpers';

/**
 * WPS 授权回调落点。
 *
 * 后端把本地 JWT 放在 URL fragment（不会发送到服务器、也不会进 Referer），
 * 这里读取后立即用 history.replaceState 清掉，再调 /auth/me 补齐用户信息。
 */
export function WpsCallbackPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // React StrictMode 下 effect 会跑两次；token 只能用一次，避免重复请求
    if (started.current) return;
    started.current = true;

    const hash = window.location.hash.replace(/^#/, '');
    const token = new URLSearchParams(hash).get('token');
    // 无论成功失败都先清理地址栏里的 token
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (!token) {
      setError('登录信息缺失，请重新使用 WPS 登录');
      return;
    }

    localStorage.setItem('token', token);
    api
      .get('/auth/me')
      .then((res) => {
        const { permissions = [], ...user } = res.data;
        login(user as User, token, permissions);
        navigate(takeLoginReturnUrl() || roleHome(user.role), { replace: true });
      })
      .catch((err) => {
        localStorage.removeItem('token');
        setError(err?.response?.data?.message || 'WPS 登录信息已失效，请重新登录');
      });
  }, [login, navigate]);

  return (
    <AuthShell>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        {error ? (
          <Result
            status="error"
            title="WPS 登录未完成"
            subTitle={error}
            extra={
              <Button type="primary" onClick={() => navigate('/login', { replace: true })}>
                返回登录
              </Button>
            }
          />
        ) : (
          <>
            <Spin size="large" />
            <div style={{ marginTop: 18, fontSize: 13, color: '#6f6767' }}>
              正在完成 WPS 登录…
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}
