import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, Select, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text } = Typography;

export function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      await api.post('/auth/register', values);
      message.success('注册成功，请登录');
      navigate('/login');
    } catch (err: any) {
      message.error(err.response?.data?.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <Title level={2} style={{ textAlign: 'center', marginBottom: 8 }}>
          注册账号
        </Title>
        <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 32 }}>
          创建您的考试系统账号
        </Text>

        <Form onFinish={onFinish} size="large">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }, { min: 2, message: '至少2个字符' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="realName" rules={[{ required: true, message: '请输入真实姓名' }]}>
            <Input prefix={<UserOutlined />} placeholder="真实姓名" />
          </Form.Item>
          <Form.Item name="email" rules={[{ type: 'email', message: '请输入有效邮箱' }]}>
            <Input prefix={<MailOutlined />} placeholder="邮箱（选填）" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '至少6个字符' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item name="role" rules={[{ required: true, message: '请选择角色' }]}>
            <Select placeholder="选择角色" options={[
              { value: 'student', label: '学生' },
              { value: 'teacher', label: '教师' },
            ]} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              注册
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center' }}>
          <Text type="secondary">已有账号？</Text>
          <Link to="/login">去登录</Link>
        </div>
      </div>
    </div>
  );
}
