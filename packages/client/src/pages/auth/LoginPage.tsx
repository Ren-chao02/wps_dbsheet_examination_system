import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { LoginResponse } from '../../types';

const { Title, Text } = Typography;

export function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await api.post<LoginResponse>('/auth/login', values);
      login(res.data.user, res.data.token);

      const role = res.data.user.role;
      if (role === 'student') navigate('/student');
      else if (role === 'admin') navigate('/admin');
      else navigate('/teacher');

      message.success('登录成功！');
    } catch (err: any) {
      message.error(err.response?.data?.message || '登录失败');
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

        <Form onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
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

        <div style={{ marginTop: 24, padding: 16, background: '#f0f5ff', borderRadius: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            测试账号：admin/123456 (管理员) | teacher1/123456 (教师) | student1/123456 (学生)
          </Text>
        </div>
      </div>
    </div>
  );
}
