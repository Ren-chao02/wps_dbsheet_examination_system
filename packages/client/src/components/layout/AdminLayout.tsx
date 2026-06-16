import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown } from 'antd';
import {
  LogoutOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  UserSwitchOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const selectedKey = location.pathname.startsWith('/admin/') ? location.pathname : '/admin/accounts';

  const menuItems = [
    {
      key: 'system-mgmt',
      icon: <SettingOutlined />,
      label: '系统管理',
      children: [
        { key: '/admin/accounts', icon: <UserSwitchOutlined />, label: '账户管理' },
        { key: '/admin/roles', icon: <SafetyCertificateOutlined />, label: '角色权限管理' },
        { key: '/admin/import-tasks', icon: <CloudUploadOutlined />, label: '导入导出任务' },
        { key: '/admin/cache', icon: <DatabaseOutlined />, label: '缓存管理' },
      ],
    },
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
            {collapsed ? '管理' : '管理后台'}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['system-mgmt']}
          items={menuItems}
          onClick={({ key }) => {
            if (!key.startsWith('system-')) navigate(key);
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
          <Text strong style={{ fontSize: 16 }}>管理员端</Text>
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
