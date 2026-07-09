import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, message, Typography, Space } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { LoginResponse } from '../../types';

const { Title, Text } = Typography;

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [form] = Form.useForm();

  const fetchCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const res = await api.get('/auth/captcha');
      setCaptchaSvg(res.data.svg);
      setCaptchaToken(res.data.captchaToken);
      form.setFieldValue('captchaText', '');
    } catch {
      message.error('获取验证码失败');
    } finally {
      setCaptchaLoading(false);
    }
  }, [form]);

  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha]);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', {
        username: values.username,
        password: values.password,
        captchaToken,
        captchaText: values.captchaText,
      });
      login(res.data.user, res.data.token, res.data.permissions);

      const role = res.data.user.role;
      if (role === 'student') navigate('/student');
      else if (role === 'admin') navigate('/admin');
      else navigate('/teacher');

      message.success('登录成功！');
    } catch (err: any) {
      message.error(err.response?.data?.message || '登录失败');
      // 验证码错误时自动刷新
      if (err.response?.status === 400 && err.response?.data?.message?.includes('验证码')) {
        fetchCaptcha();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>
          金山多维表格考试系统
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 32 }}>
          登录您的账号
        </Text>

        <Form form={form} onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item name="captchaText" rules={[{ required: true, message: '请输入验证码' }]}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                prefix={<SafetyOutlined />}
                placeholder="验证码"
                style={{ flex: 1 }}
              />
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  border: '1px solid #d9d9d9',
                  borderRadius: 6,
                  padding: '0 4px',
                  cursor: 'pointer',
                  height: 40,
                  marginLeft: 8,
                  minWidth: 100,
                  justifyContent: 'center',
                  background: '#fafafa',
                }}
                onClick={fetchCaptcha}
                title="点击刷新验证码"
              >
                {captchaLoading ? (
                  <ReloadOutlined spin style={{ fontSize: 18 }} />
                ) : captchaSvg ? (
                  <span dangerouslySetInnerHTML={{ __html: captchaSvg }} />
                ) : (
                  <ReloadOutlined style={{ fontSize: 18, color: '#999' }} />
                )}
              </span>
            </Space.Compact>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary">还没有账号？</Text>
          <Link to="/register">立即注册</Link>
        </div>

        {import.meta.env.DEV && (
          <div style={{ marginTop: 24, padding: 16, background: '#f0f5ff', borderRadius: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              测试账号：admin/123456 (管理员) | teacher1/123456 (教师) | student1/123456 (学生)
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
