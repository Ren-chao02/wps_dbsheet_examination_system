/**
 * ✅ 学生端布局 — Apple HIG Design
 */

import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown, Tooltip } from 'antd';
import {
  DashboardOutlined,
  BookOutlined,
  LogoutOutlined,
  UserOutlined,
  HomeOutlined,
  TrophyOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';
import { NotificationCenter } from '../NotificationCenter';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const springTransition = 'all 0.2s cubic-bezier(0,0,0.2,1)';

export function StudentLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();

  // 考试模式：全屏界面，隐藏导航
  const isExamMode = /^\/student\/exam\/[^/]+\/(check|entry|wps)$/.test(location.pathname);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const menuItems = [
    { key: '/student/home', icon: <HomeOutlined />, label: '个人主页' },
    { key: '/student/dashboard', icon: <DashboardOutlined />, label: '我的考试' },
    { key: '/student/practice', icon: <BookOutlined />, label: '题库练习' },
    { key: '/student/history', icon: <TrophyOutlined />, label: '成绩查询' },
    { key: '/student/favorites', icon: <StarOutlined />, label: '我的收藏' },
  ];

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
    ],
  };

  if (isExamMode) {
    return <Outlet />;
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', background: '#f2f2f7' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        collapsedWidth={64}
        trigger={null}
        style={{
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          zIndex: 100,
          background: '#f9f9fb',
          borderRight: '0.5px solid #ececf0',
          transition: 'width 0.22s cubic-bezier(0.25,0.1,0.25,1)',
        }}
      >
        <div style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '0.5px solid #ececf0',
        }}>
          <Text style={{
            fontSize: collapsed ? 13 : 16,
            fontWeight: 700,
            color: '#1d1d1f',
            letterSpacing: '-0.01em',
          }}>
            {collapsed ? '考试' : '考试系统'}
          </Text>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          style={{ background: 'transparent', border: 'none', marginTop: 8 }}
          onClick={({ key }) => navigate(key)}
        />

        <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, padding: '0 12px' }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              width: '100%', padding: '7px 10px', borderRadius: 10,
              border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, color: '#aeaeb2',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              transition: springTransition,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; e.currentTarget.style.color = '#86868b'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#aeaeb2'; }}
          >
            <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>
            {!collapsed && '收起'}
          </button>
        </div>
      </Sider>

      <Layout style={{
        marginLeft: collapsed ? 64 : 220,
        height: '100vh',
        transition: 'margin-left 0.22s cubic-bezier(0.25,0.1,0.25,1)',
        background: '#f2f2f7',
      }}>
        <Header style={{
          position: 'sticky',
          top: 0, zIndex: 99, height: 48,
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'saturate(180%) blur(24px)',
          WebkitBackdropFilter: 'saturate(180%) blur(24px)',
          borderBottom: '0.5px solid #e5e5ea',
          padding: '0 20px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <Text style={{ fontSize: 15, fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.01em' }}>
            学生端
          </Text>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip title="通知" placement="bottom">
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: springTransition, color: '#86868b',
              }}>
                <NotificationCenter />
              </div>
            </Tooltip>

            <span style={{ width: 0.5, height: 20, background: '#e5e5ea', margin: '0 4px', display: 'inline-block' }} />

            <Dropdown menu={userMenu} placement="bottomRight">
              <div style={{
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                gap: 8, padding: '6px 10px', borderRadius: 10, transition: springTransition,
              }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <Avatar size={28} icon={<UserOutlined />}
                  style={{ background: 'linear-gradient(135deg, #5e5ce6, #007aff)' }} />
                <Text style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>
                  {user?.realName || user?.username}
                </Text>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content style={{
          margin: 24,
          overflow: 'auto',
          background: '#ffffff',
          borderRadius: 14,
          border: '0.5px solid #ececf0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          padding: 28,
          minHeight: 400,
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
