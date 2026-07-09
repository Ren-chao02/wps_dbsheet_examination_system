/**
 * ✅ 管理员端布局 — Apple HIG Design + 模块化权限
 */

import { useState, useMemo, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown, Tooltip } from 'antd';
import {
  LogoutOutlined,
  UserOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';
import { NotificationCenter } from '../NotificationCenter';
import { NotificationManagerModal } from '../NotificationManagerModal';
import {
  filterAccessibleModules,
  findModuleByPath,
  TopModuleItem,
} from '../../config/moduleNavigation';

const { Sider, Content } = Layout;
const { Text } = Typography;

const springTransition = 'all 0.2s cubic-bezier(0,0,0.2,1)';

export function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [activeTopModuleKey, setActiveTopModuleKey] = useState<string>('system');
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();

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

  const handleLogout = () => { logout(); navigate('/login'); };
  const handleTopModuleChange = (moduleKey: string) => {
    setActiveTopModuleKey(moduleKey);
    const targetModule = accessibleModules.find(m => m.key === moduleKey);
    if (targetModule?.defaultSubKey) navigate(targetModule.defaultSubKey);
  };

  const userMenu = {
    items: [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout }],
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden', background: '#f2f2f7' }}>
      {/* === 毛玻璃顶栏 === */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 48,
        background: 'rgba(255,255,255,0.82)', backdropFilter: 'saturate(180%) blur(24px)',
        WebkitBackdropFilter: 'saturate(180%) blur(24px)', borderBottom: '0.5px solid #e5e5ea',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', zIndex: 200,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, fontSize: 15, color: '#1d1d1f' }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #007aff, #5ac8fa)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13 }}>W</div>
          <span>WPS 多维表格考试系统</span>
        </div>

        {/* 胶囊 Tab 导航 */}
        <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.04)', borderRadius: 32, padding: 3 }}>
          {accessibleModules.map(module => (
            <button key={module.key}
              style={{
                padding: '5px 16px', borderRadius: 32, fontSize: 12.5, fontWeight: 500,
                color: activeTopModuleKey === module.key ? '#1d1d1f' : '#86868b', cursor: 'pointer',
                transition: springTransition, border: 'none', background: activeTopModuleKey === module.key ? '#fff' : 'none',
                boxShadow: activeTopModuleKey === module.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', whiteSpace: 'nowrap',
              }}
              onClick={() => handleTopModuleChange(module.key)}>{module.label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title="通知"><NotificationCenter /></Tooltip>
          <Tooltip title="通知管理">
            <SettingOutlined style={{ fontSize: 18, cursor: 'pointer', color: '#86868b', width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: springTransition }}
              onClick={() => setNotificationOpen(true)} />
          </Tooltip>
          <span style={{ width: 0.5, height: 20, background: '#e5e5ea', margin: '0 4px', display: 'inline-block' }} />
          <Dropdown menu={userMenu} placement="bottomRight">
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, transition: springTransition }}>
              <Avatar size={28} icon={<UserOutlined />} style={{ background: 'linear-gradient(135deg, #5e5ce6, #007aff)' }} />
              <Text style={{ fontSize: 13, fontWeight: 500, color: '#1d1d1f' }}>{user?.realName || user?.username}</Text>
            </div>
          </Dropdown>
        </div>
      </div>

      {/* === 侧栏 === */}
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} width={220} collapsedWidth={64} trigger={null}
        style={{ position: 'fixed', left: 0, top: 48, bottom: 0, background: '#f9f9fb', borderRight: '0.5px solid #ececf0', zIndex: 100, transition: 'width 0.22s cubic-bezier(0.25,0.1,0.25,1)', overflow: 'hidden' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '0.5px solid #ececf0' }}>
          <Text style={{ fontSize: collapsed ? 13 : 14, fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.01em' }}>
            {collapsed ? '管理' : '导航菜单'}
          </Text>
        </div>
        <Menu mode="inline" selectedKeys={[location.pathname]} items={currentModuleSubItems.map(item => ({ key: item.key, icon: item.icon, label: <span>{item.label}</span> }))}
          onClick={({ key }) => navigate(key)} style={{ background: 'transparent', border: 'none', marginTop: 8 }} />
        <div style={{ position: 'absolute', bottom: 20, left: 0, right: 0, padding: '0 12px' }}>
          <button onClick={() => setCollapsed(!collapsed)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: collapsed ? 'center' : 'flex-start', width: '100%', padding: '7px 10px', borderRadius: 10, border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#aeaeb2', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', transition: springTransition }}>
            <span style={{ fontSize: 16 }}>{collapsed ? '→' : '←'}</span>{!collapsed && '收起'}</button>
        </div>
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 64 : 220, marginTop: 48, height: 'calc(100vh - 48px)', transition: 'margin-left 0.22s cubic-bezier(0.25,0.1,0.25,1)', background: '#f2f2f7' }}>
        <Content style={{ margin: 24, overflow: 'auto', background: '#fff', borderRadius: 14, border: '0.5px solid #ececf0', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', padding: 28, minHeight: 400 }}>
          <Outlet />
        </Content>
      </Layout>

      <NotificationManagerModal open={notificationOpen} onClose={() => setNotificationOpen(false)} role="admin" />
    </Layout>
  );
}
