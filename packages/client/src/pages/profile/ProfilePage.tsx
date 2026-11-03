import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import type { DescriptionsProps } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import './profile.css';

const { Title, Text } = Typography;

interface ProfileInfo {
  id: string;
  username: string;
  realName: string | null;
  role: 'admin' | 'teacher' | 'student';
  avatarUrl: string | null;
  email: string | null;
  phoneNumber: string | null;
  gender: string | null;
  studentId: string | null;
  employeeId: string | null;
  accountStatus: string;
  createdAt: string;
  lastLoginAt: string | null;
  wpsBoundAt: string | null;
  systemRole: { roleCode: string; roleName: string } | null;
  department: string | null;
  major: string | null;
  classRoom: string | null;
  academicYear: string | null;
}

interface ChangePasswordValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const ROLE_LABEL: Record<ProfileInfo['role'], string> = {
  admin: '管理员',
  teacher: '教师',
  student: '学生',
};

const ROLE_COLOR: Record<ProfileInfo['role'], string> = {
  admin: 'geekblue',
  teacher: 'blue',
  student: 'green',
};

/**
 * 个人信息：三种角色共用同一页面。
 *
 * 姓名/学号/工号/班级/院系来自名册（权威数据），这里只读；
 * 唯一可自助修改的是登录密码，改完立即退出并要求重新登录。
 */
export default function ProfilePage() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [form] = Form.useForm<ChangePasswordValues>();

  const [profile, setProfile] = useState<ProfileInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProfileInfo>('/profile/me')
      .then((res) => {
        if (!cancelled) setProfile(res.data);
      })
      .catch((err) => {
        message.error(err?.response?.data?.message || '加载个人信息失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChangePassword = async (values: ChangePasswordValues) => {
    setSaving(true);
    try {
      await api.post('/profile/change-password', {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      // 服务端已让旧 token 失效，留在页面上的任何请求都会 401，直接回登录页。
      message.success('密码已修改，请使用新密码重新登录');
      logout();
      navigate('/login', { replace: true });
    } catch (err: any) {
      message.error(err?.response?.data?.message || '修改密码失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <Card loading />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-page">
        <Card>
          <Text type="secondary">未获取到个人信息，请刷新重试。</Text>
        </Card>
      </div>
    );
  }

  const identifierLabel = profile.employeeId ? '工号' : profile.studentId ? '学号' : '登录名';
  const identifierValue = profile.employeeId || profile.studentId || profile.username;

  const items: DescriptionsProps['items'] = [
    { key: 'username', label: '登录账号', children: profile.username },
    { key: 'identifier', label: identifierLabel, children: identifierValue },
    { key: 'department', label: '院系', children: profile.department || '—' },
    { key: 'major', label: '专业', children: profile.major || '—' },
    ...(profile.role === 'student'
      ? [{ key: 'classRoom', label: '班级', children: profile.classRoom || '—' }]
      : []),
    { key: 'email', label: '邮箱', children: profile.email || <Text type="secondary">未填写</Text> },
    {
      key: 'phoneNumber',
      label: '手机号',
      children: profile.phoneNumber || <Text type="secondary">未填写</Text>,
    },
    {
      key: 'accountStatus',
      label: '账号状态',
      children:
        profile.accountStatus === 'ENABLED' ? (
          <Tag color="green">正常</Tag>
        ) : (
          <Tag color="red">已禁用</Tag>
        ),
    },
    {
      key: 'lastLoginAt',
      label: '上次登录',
      children: profile.lastLoginAt
        ? dayjs(profile.lastLoginAt).format('YYYY-MM-DD HH:mm')
        : '—',
    },
    {
      key: 'wpsBound',
      label: 'WPS 绑定',
      children: profile.wpsBoundAt ? (
        <Tag color="green">已绑定</Tag>
      ) : (
        <Tag>未绑定</Tag>
      ),
    },
  ];

  return (
    <div className="profile-page">
      <Card className="profile-card">
        <Space align="center" size={20}>
          <Avatar
            size={72}
            src={profile.avatarUrl || undefined}
            icon={<UserOutlined />}
            className="profile-avatar"
          />
          <div>
            <Space align="center" size={8} wrap>
              <Title level={3} className="profile-name">
                {profile.realName || profile.username}
              </Title>
              <Tag color={ROLE_COLOR[profile.role]}>{ROLE_LABEL[profile.role]}</Tag>
              {profile.systemRole && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {profile.systemRole.roleName}
                </Text>
              )}
            </Space>
            <div className="profile-sub">
              {identifierLabel} {identifierValue}
              {profile.classRoom ? ` · ${profile.classRoom}` : ''}
              {profile.academicYear ? ` · ${profile.academicYear}` : ''}
            </div>
          </div>
        </Space>
      </Card>

      <Card title="基本信息" className="profile-card">
        <Descriptions column={{ xs: 1, sm: 1, md: 2 }} items={items} />
      </Card>

      <Card
        title={
          <Space size={6}>
            <LockOutlined />
            修改密码
          </Space>
        }
        extra={<Text type="secondary" style={{ fontSize: 12 }}>修改成功后需重新登录</Text>}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleChangePassword}
          style={{ maxWidth: 420 }}
          requiredMark={false}
        >
          <Form.Item
            name="oldPassword"
            label="原密码"
            rules={[{ required: true, message: '请输入原密码' }]}
          >
            <Input.Password autoComplete="current-password" placeholder="请输入当前密码" />
          </Form.Item>

          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 8, message: '新密码至少 8 位' },
              { max: 64, message: '新密码最长 64 位' },
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="至少 8 位" />
          </Form.Item>

          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的新密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="再次输入新密码" />
          </Form.Item>

          <Button type="primary" htmlType="submit" loading={saving}>
            保存新密码
          </Button>
        </Form>
      </Card>
    </div>
  );
}
