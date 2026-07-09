/**
 * ✅ 模块化教师端布局 — Apple HIG Design
 *
 * 架构设计:
 * ┌──────────────────────────────────────────────────────┐
 * │  Header (毛玻璃顶栏) — 胶囊Tab导航 + 通知/设置/用户   │ 48px
 * ├────────┬─────────────────────────────────────────────┤
 * │ Sider  │  Content (内容区)                           │
 * │ 浅灰   │  <Outlet />                                 │
 * │ 侧栏   │                                             │
 * │ 动态   │                                             │
 * │ 菜单   │                                             │
 * └────────┴─────────────────────────────────────────────┘
 */

import { useState, useMemo, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown, Tooltip } from 'antd';
import {
  LogoutOutlined,
  UserOutlined,
  DownOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';
import { WpsTokenAutoRefresher } from '../common/WpsTokenAutoRefresher';
import { NotificationCenter } from '../NotificationCenter';
import { NotificationManagerModal } from '../NotificationManagerModal';
import {
  MODULE_NAVIGATION_CONFIG,
  filterAccessibleModules,
  findModuleByPath,
  TopModuleItem,
} from '../../config/moduleNavigation';

const { Sider, Content } = Layout;
const { Text } = Typography;

const APPLE_STYLE = {
  header: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    background: 'rgba(255,255,255,0.82)',
    backdropFilter: 'saturate(180%) blur(24px)',
    WebkitBackdropFilter: 'saturate(180%) blur(24px)',
    borderBottom: '0.5px solid #e5e5ea',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    zIndex: 200,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 600,
    fontSize: 15,
    color: '#1d1d1f',
    letterSpacing: '-0.01em',
  },
  brandBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: 'linear-gradient(135deg, #007aff, #5ac8fa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
  },
  tabsWrap: {
    display: 'flex',
    gap: 2,
    background: 'rgba(0,0,0,0.04)',
    borderRadius: 32,
    padding: 3,
  },
  tab: (active: boolean) => ({
    padding: '5px 16px',
    borderRadius: 32,
    fontSize: 12.5,
    fontWeight: 500 as const,
    color: active ? '#1d1d1f' : '#86868b',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0,0,0.2,1)',
    border: 'none',
    background: active ? '#fff' : 'none',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '-0.01em',
  }),
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: '#86868b',
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s cubic-bezier(0,0,0.2,1)',
    color: '#86868b',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #5e5ce6, #007aff)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    marginLeft: 6,
    transition: 'transform 0.15s cubic-bezier(0,0,0.2,1)',
  },
  divider: {
    width: 0.5,
    height: 20,
    background: '#e5e5ea',
    margin: '0 4px',
    display: 'inline-block' as const,
  },
  sider: (collapsed: boolean) => ({
    position: 'fixed' as const,
    left: 0,
    top: 48,
    bottom: 0,
    width: collapsed ? 64 : 220,
    background: '#f9f9fb',
    borderRight: '0.5px solid #ececf0',
    zIndex: 100,
    transition: 'width 0.22s cubic-bezier(0.25,0.1,0.25,1)',
    overflow: 'hidden',
  }),
  mainLayout: (collapsed: boolean) => ({
    marginLeft: collapsed ? 64 : 220,
    marginTop: 48,
    height: 'calc(100vh - 48px)',
    transition: 'margin-left 0.22s cubic-bezier(0.25,0.1,0.25,1)',
    background: '#f2f2f7',
  }),
  userBtn: {
    cursor: 'pointer',
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
    padding: '6px 10px',
    borderRadius: 10,
    transition: 'all 0.15s cubic-bezier(0,0,0.2,1)',
  },
};

export function TeacherLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();

  const [activeTopModuleKey, setActiveTopModuleKey] = useState<string>('dashboard');

  const accessibleModules = useMemo(() => {
    return filterAccessibleModules(hasPermission);
  }, [hasPermission]);

  const currentModuleSubItems = useMemo((): TopModuleItem['subItems'] => {
    const module = accessibleModules.find(m => m.key === activeTopModuleKey);
    return module?.subItems || [];
  }, [accessibleModules, activeTopModuleKey]);

  useEffect(() => {
    const matchedModule = findModuleByPath(location.pathname);
    if (matchedModule && accessibleModules.some(m => m.key === matchedModule.key)) {
      setActiveTopModuleKey(matchedModule.key);
    }
  }, [location.pathname, accessibleModules]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleTopModuleChange = (moduleKey: string) => {
    setActiveTopModuleKey(moduleKey);
    const targetModule = accessibleModules.find(m => m.key === moduleKey);
    if (targetModule?.defaultSubKey) {
      navigate(targetModule.defaultSubKey);
    }
  };

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
    ],
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', background: '#f2f2f7' }}>
      <WpsTokenAutoRefresher />

      {/* === 毛玻璃顶栏 === */}
      <div style={APPLE_STYLE.header}>
        <div style={APPLE_STYLE.brand}>
          <div style={APPLE_STYLE.brandBox}>W</div>
          <span>WPS 多维表格考试系统</span>
        </div>

        {/* 胶囊 Tab 导航 */}
        <div style={APPLE_STYLE.tabsWrap}>
          {accessibleModules.map(module => (
            <button
              key={module.key}
              style={APPLE_STYLE.tab(activeTopModuleKey === module.key)}
              onClick={() => handleTopModuleChange(module.key)}
              onMouseEnter={e => {
                if (activeTopModuleKey !== module.key) (e.target as HTMLElement).style.color = '#1d1d1f';
              }}
              onMouseLeave={e => {
                if (activeTopModuleKey !== module.key) (e.target as HTMLElement).style.color = '#86868b';
              }}
            >
              {module.label}
            </button>
          ))}
        </div>

        <div style={APPLE_STYLE.actions}>
          <Tooltip title="通知" placement="bottom">
            <div style={APPLE_STYLE.iconBtn}>
              <NotificationCenter />
            </div>
          </Tooltip>

          <Tooltip title="通知管理" placement="bottom">
            <div
              style={APPLE_STYLE.iconBtn}
              onClick={() => setNotificationOpen(true)}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <SettingOutlined style={{ fontSize: 18 }} />
            </div>
          </Tooltip>

          <span style={APPLE_STYLE.divider} />

          <Dropdown menu={userMenu} placement="bottomRight">
            <div
              style={APPLE_STYLE.userBtn}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              <Avatar size={28} icon={<UserOutlined />} style={APPLE_STYLE.avatar} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f', lineHeight: 1.2 }}>
                  {user?.realName || user?.username}
                </Text>
                <Text style={{ fontSize: 11, color: '#aeaeb2', lineHeight: 1.2 }}>教师</Text>
              </div>
              <DownOutlined style={{ fontSize: 12, color: '#aeaeb2' }} />
            </div>
          </Dropdown>
        </div>
      </div>

      {/* === 浅灰侧栏 === */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        collapsedWidth={64}
        trigger={null}
        style={APPLE_STYLE.sider(collapsed)}
      >
        <div style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '0.5px solid #ececf0',
        }}>
          {collapsed ? (
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: 'linear-gradient(135deg, #007aff, #5ac8fa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 13,
            }}>W</div>
          ) : (
            <Text style={{ fontSize: 14, fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.01em' }}>
              导航菜单
            </Text>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          style={{
            background: 'transparent',
            border: 'none',
            marginTop: 8,
          }}
          items={currentModuleSubItems.map(item => ({
            key: item.key,
            icon: item.icon,
            label: <span>{item.label}</span>,
          }))}
          onClick={({ key }) => navigate(key)}
        />

        {/* 收起按钮 */}
        <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, padding: '0 12px' }}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: collapsed ? 'center' : 'flex-start',
              width: '100%',
              padding: '7px 10px',
              borderRadius: 10,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 12,
              color: '#aeaeb2',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
              transition: 'all 0.15s cubic-bezier(0,0,0.2,1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
              e.currentTarget.style.color = '#86868b';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = '#aeaeb2';
            }}
          >
            <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>
            {!collapsed && '收起'}
          </button>
        </div>
      </Sider>

      {/* === 主内容区 === */}
      <Layout style={APPLE_STYLE.mainLayout(collapsed)}>
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

      <NotificationManagerModal
        open={notificationOpen}
        onClose={() => setNotificationOpen(false)}
        role="teacher"
      />
    </Layout>
  );
}
