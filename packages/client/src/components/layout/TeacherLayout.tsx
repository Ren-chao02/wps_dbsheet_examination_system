import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown } from 'antd';
import {
  DashboardOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export function TeacherLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const menuItems = [
    { key: '/teacher/dashboard', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/teacher/questions', icon: <QuestionCircleOutlined />, label: '题库管理' },
    { key: '/teacher/exams', icon: <FileTextOutlined />, label: '考试管理' },
  ];

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
    ],
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark">
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontSize: collapsed ? 14 : 18, fontWeight: 'bold' }}>
            {collapsed ? '考试' : '考试系统'}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname.startsWith('/teacher/questions') ? '/teacher/questions' : location.pathname.startsWith('/teacher/exams') ? '/teacher/exams' : location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <Text strong style={{ fontSize: 16 }}>教师端</Text>
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Text>{user?.realName || user?.username}</Text>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
