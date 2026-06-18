/**
 * ✅ 模块化教师端布局 (Module-based Teacher Layout)
 *
 * 架构设计:
 * ┌──────────────────────────────────────────────────────┐
 * │  Header (顶栏) - 一级大模块Tab导航                     │
 * │  [工作台] [题库与试卷] [监考管理★] [查询统计★] [...]    │
 * ├────────┬─────────────────────────────────────────────┤
 * │        │  Content (内容区)                            │
 * │ Sider  │                                             │
 * │ (侧边) │  <Outlet />                                 │
 * │ - 二级 │                                             │
 * │  菜单  │                                             │
 * │ - 动态 │                                             │
 * │  加载  │                                             │
 * └────────┴─────────────────────────────────────────────┘
 */

import { useState, useMemo, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown, Tabs, Tooltip, Badge } from 'antd';
import {
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';
import {
  MODULE_NAVIGATION_CONFIG,
  filterAccessibleModules,
  findModuleByPath,
  TopModuleItem,
} from '../../config/moduleNavigation'; // ✅ 自动解析为.tsx

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export function TeacherLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();

  // ✅ 状态：当前选中的一级模块
  const [activeTopModuleKey, setActiveTopModuleKey] = useState<string>('dashboard');

  // ✅ 过滤用户有权限访问的模块
  const accessibleModules = useMemo(() => {
    return filterAccessibleModules(hasPermission);
  }, [hasPermission]);

  // ✅ 获取当前选中模块的子菜单项
  const currentModuleSubItems = useMemo((): TopModuleItem['subItems'] => {
    const module = accessibleModules.find(m => m.key === activeTopModuleKey);
    return module?.subItems || [];
  }, [accessibleModules, activeTopModuleKey]);

  // ✅ 根据当前URL自动定位到对应的一级模块
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

  // ✅ 处理一级模块切换
  const handleTopModuleChange = (moduleKey: string) => {
    setActiveTopModuleKey(moduleKey);

    // 自动导航到该模块的默认子页面
    const targetModule = accessibleModules.find(m => m.key === moduleKey);
    if (targetModule?.defaultSubKey) {
      navigate(targetModule.defaultSubKey);
    }
  };

  // ✅ 渲染顶部Tab导航栏
  const renderTopNavigation = () => (
    <Tabs
      activeKey={activeTopModuleKey}
      onChange={handleTopModuleChange}
      type="card"
      size="middle"
      style={{
        marginBottom: 0,
        background: '#fff',
        padding: '0 16px',
      }}
      items={accessibleModules.map(module => ({
        key: module.key,
        label: (
          <Tooltip title={module.description} placement="bottom">
            <span>
              {module.icon} {module.label}
            </span>
          </Tooltip>
        ),
      }))}
    />
  );

  // ✅ 渲染左侧二级菜单
  const renderSideMenu = () => (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[location.pathname]}
      items={currentModuleSubItems.map(item => ({
        key: item.key,
        icon: item.icon,
        label: (
          <span>
            {item.label}
            {item.badge && (
              <Badge
                count={
                  typeof item.badge === 'number' ? item.badge :
                  item.badge === 'dot' ? 'dot' :
                  <Text style={{ fontSize: 10, color: '#1890ff', marginLeft: 4 }}>
                    {item.badge}
                  </Text>
                }
                size="small"
                style={{ marginLeft: 8 }}
              />
            )}
          </span>
        ),
      }))}
      onClick={({ key }) => navigate(key)}
    />
  );

  const userMenu = {
    items: [
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
    ],
  };

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* ✅ 左侧固定侧边栏 */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        width={220}
        collapsedWidth={80}
        style={{ height: '100vh', position: 'fixed', left: 0, top: 0, zIndex: 100 }}
      >
        {/* Logo区域 */}
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <Text style={{ color: '#fff', fontSize: collapsed ? 14 : 18, fontWeight: 'bold' }}>
            {collapsed ? '考试' : '考试系统'}
          </Text>
        </div>

        {/* ✅ 动态加载的二级菜单 */}
        {renderSideMenu()}
      </Sider>

      {/* ✅ 右侧主内容区 */}
      <Layout style={{ marginLeft: collapsed ? 80 : 220, height: '100vh', transition: 'margin-left 0.2s' }}>
        {/* 顶部Header：用户信息 + 一级模块Tab */}
        <Header style={{
          position: 'sticky',
          top: 0,
          zIndex: 99,
          background: '#f0f2f5',
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          {/* 第一行：用户信息栏 */}
          <div style={{
            height: 48,
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e8e8e8',
          }}>
            <Text strong style={{ fontSize: 15, color: '#333' }}>教师工作台</Text>

            <Dropdown menu={userMenu} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size="small" icon={<UserOutlined />} />
                <Text style={{ fontSize: 13 }}>{user?.realName || user?.username}</Text>
              </div>
            </Dropdown>
          </div>

          {/* 第二行：一级模块Tab导航 */}
          {renderTopNavigation()}
        </Header>

        {/* 内容区 */}
        <Content style={{
          margin: 24,
          overflow: 'auto',
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          minHeight: 400,
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
