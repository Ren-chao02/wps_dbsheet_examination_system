import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Row, Col, Statistic, Button, Spin, message, Avatar, Typography, Space } from 'antd';
import {
  BookOutlined,
  FileTextOutlined,
  TrophyOutlined,
  StarOutlined,
  UserOutlined,
  TeamOutlined,
  BankOutlined,
  ProfileOutlined,
} from '@ant-design/icons';
import api from '../../services/api';

const { Title, Text } = Typography;

interface StudentProfile {
  realName: string | null;
  username: string;
  studentId: string | null;
  department?: string;
  major?: string;
  classRoom?: string;
  academicYear?: string;
  stats: {
    examCount: number;
    gradedCount: number;
    practiceCount: number;
    favoriteCount: number;
    wrongCount: number;
  };
}

export function StudentHome() {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get('/student-profile/me')
      .then((res) => setProfile(res.data))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="page-container">
      <Card style={{ marginBottom: 24 }}>
        <Space align="start" size="large">
          <Avatar size={80} icon={<UserOutlined />} />
          <div>
            <Title level={3} style={{ marginBottom: 8 }}>
              {profile.realName || profile.username}
            </Title>
            <Space wrap>
              {profile.studentId && <Text type="secondary">学号：{profile.studentId}</Text>}
              {profile.classRoom && (
                <Text type="secondary">
                  <TeamOutlined /> {profile.classRoom}
                </Text>
              )}
              {profile.major && (
                <Text type="secondary">
                  <BankOutlined /> {profile.major}
                </Text>
              )}
              {profile.department && (
                <Text type="secondary">
                  <ProfileOutlined /> {profile.department}
                </Text>
              )}
            </Space>
          </div>
        </Space>
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card hoverable onClick={() => navigate('/student/dashboard')}>
            <Statistic title="我的考试" value={profile.stats.examCount} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card hoverable onClick={() => navigate('/student/practice')}>
            <Statistic title="练习次数" value={profile.stats.practiceCount} prefix={<BookOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card hoverable onClick={() => navigate('/student/history')}>
            <Statistic title="已出成绩" value={profile.stats.gradedCount} prefix={<TrophyOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card hoverable onClick={() => navigate('/student/favorites')}>
            <Statistic title="收藏题目" value={profile.stats.favoriteCount} prefix={<StarOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="快捷入口">
            <Space wrap>
              <Button type="primary" onClick={() => navigate('/student/dashboard')}>
                进入考试
              </Button>
              <Button onClick={() => navigate('/student/practice')}>题库练习</Button>
              <Button onClick={() => navigate('/student/history')}>成绩查询</Button>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
