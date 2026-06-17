import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Card, Form, Input, Button, Radio, Result, Spin, Typography, Space, Divider, message
} from 'antd';
import {
  UserOutlined, IdcardOutlined, PhoneOutlined, TeamOutlined
} from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text } = Typography;

interface InvitationInfo {
  code: string;
  classRoom: {
    name: string;
    academicYear?: string;
    major?: { name: string };
    department?: { name: string };
  };
  expiresAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'DISABLED';
}

type PageState = 'loading' | 'ready' | 'success' | 'invalid';

export default function StudentJoinPage() {
  const { code } = useParams<{ code: string }>();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [invitationInfo, setInvitationInfo] = useState<InvitationInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [form] = Form.useForm();

  useEffect(() => {
    if (!code) {
      setPageState('invalid');
      setErrorMsg('无效的邀请链接');
      return;
    }
    api.get(`/invitations/${code}/info`)
      .then((res) => {
        const info: InvitationInfo = res.data;
        if (info.status !== 'ACTIVE') {
          setErrorMsg(
            info.status === 'EXPIRED' ? '该邀请链接已过期' : '该邀请链接已被禁用'
          );
          setPageState('invalid');
        } else {
          setInvitationInfo(info);
          setPageState('ready');
        }
      })
      .catch((e) => {
        setErrorMsg(e?.response?.data?.message || '邀请链接无效或已失效');
        setPageState('invalid');
      });
  }, [code]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await api.post(`/invitations/${code}/apply`, {
        realName: values.realName,
        studentId: values.studentId,
        gender: values.gender,
        phoneNumber: values.phoneNumber,
      });
      setPageState('success');
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #e8f4ff 0%, #f0f2f5 100%)',
    padding: '24px',
  };

  if (pageState === 'loading') {
    return (
      <div style={containerStyle}>
        <Spin size="large" tip="正在加载邀请信息..." />
      </div>
    );
  }

  if (pageState === 'invalid') {
    return (
      <div style={containerStyle}>
        <Card style={{ width: 480, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', borderRadius: 12 }}>
          <Result
            status="error"
            title="邀请链接无效"
            subTitle={errorMsg || '该邀请链接不存在、已过期或已被禁用。'}
            extra={
              <Button type="primary" href="/login">
                返回登录
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (pageState === 'success') {
    return (
      <div style={containerStyle}>
        <Card style={{ width: 480, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', borderRadius: 12 }}>
          <Result
            status="success"
            title="申请已提交！"
            subTitle="您的入班申请已成功提交，请等待教师审批。审批通过后您将可以使用学号登录系统。"
            extra={
              <Button type="primary" href="/login">
                去登录
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const cls = invitationInfo?.classRoom;

  return (
    <div style={containerStyle}>
      <Card
        style={{
          width: 480,
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          borderRadius: 12,
        }}
        bodyStyle={{ padding: '32px 40px' }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #1677ff, #4096ff)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}>
            <TeamOutlined style={{ fontSize: 26, color: '#fff' }} />
          </div>
          <Title level={3} style={{ margin: 0, color: '#1a1a1a' }}>加入班级</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>填写信息申请加入以下班级</Text>
        </div>

        {/* 班级信息展示 */}
        {cls && (
          <Card
            size="small"
            style={{
              marginBottom: 24,
              background: '#f6f8ff',
              border: '1px solid #d6e4ff',
              borderRadius: 8,
            }}
          >
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>院系</Text>
                <Text style={{ fontSize: 13 }}>{cls.department?.name || '-'}</Text>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>专业</Text>
                <Text style={{ fontSize: 13 }}>{cls.major?.name || '-'}</Text>
              </div>
              <Divider style={{ margin: '4px 0' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>班级</Text>
                <Text strong style={{ color: '#1677ff', fontSize: 14 }}>{cls.name}</Text>
              </div>
              {cls.academicYear && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>学年</Text>
                  <Text style={{ fontSize: 13 }}>{cls.academicYear}</Text>
                </div>
              )}
            </Space>
          </Card>
        )}

        {/* 申请表单 */}
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="realName"
            label="真实姓名"
            rules={[{ required: true, message: '请输入真实姓名' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: '#bbb' }} />}
              placeholder="请输入真实姓名"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="studentId"
            label="学号"
            rules={[
              { required: true, message: '请输入学号' },
              { pattern: /^[a-zA-Z0-9]+$/, message: '学号只能包含字母和数字' },
            ]}
          >
            <Input
              prefix={<IdcardOutlined style={{ color: '#bbb' }} />}
              placeholder="请输入学号"
              size="large"
            />
          </Form.Item>

          <Form.Item name="gender" label="性别">
            <Radio.Group>
              <Radio value="MALE">男</Radio>
              <Radio value="FEMALE">女</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            name="phoneNumber"
            label="手机号"
            rules={[
              { pattern: /^1[3-9]\d{9}$/, message: '请输入有效的手机号码' },
            ]}
          >
            <Input
              prefix={<PhoneOutlined style={{ color: '#bbb' }} />}
              placeholder="选填，方便联系"
              size="large"
              maxLength={11}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              size="large"
              block
              loading={submitting}
              onClick={handleSubmit}
              style={{ borderRadius: 8, height: 44, fontWeight: 500 }}
            >
              提交申请
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            提交后需等待教师审批，审批通过后方可使用学号登录
          </Text>
        </div>
      </Card>
    </div>
  );
}
