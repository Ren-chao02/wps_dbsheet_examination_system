import { useState, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Avatar, Dropdown } from 'antd';
import {
  DashboardOutlined,
  QuestionCircleOutlined,
  FileTextOutlined,
  LogoutOutlined,
  UserOutlined,
  TeamOutlined,
  BankOutlined,
  LinkOutlined,
  AuditOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/auth';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export function TeacherLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, hasPermission } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // 学生管理子菜单动态生成
  const studentSubItems: any[] = [];
  if (hasPermission('STUDENT_MANAGEMENT')) {
    studentSubItems.push(
      { key: '/teacher/departments', icon: <BankOutlined />, label: '院系架构' },
      { key: '/teacher/students', icon: <UserOutlined />, label: '学生列表' },
      { key: '/teacher/invitations', icon: <LinkOutlined />, label: '邀请管理' },
      { key: '/teacher/applications', icon: <AuditOutlined />, label: '审批队列' },
    );
  }
  if (hasPermission('IMPORT_EXPORT')) {
    studentSubItems.push(
      { key: '/teacher/import-tasks', icon: <CloudUploadOutlined />, label: '导入导出任务' },
    );
  }

  const menuItems = useMemo(() => {
    const items: any[] = [
      { key: '/teacher/dashboard', icon: <DashboardOutlined />, label: '工作台' },
    ];

    if (hasPermission('QUESTION_BANK')) {
      items.push({ key: '/teacher/questions', icon: <QuestionCircleOutlined />, label: '题库管理' });
    }

    if (hasPermission('EXAM_MANAGEMENT')) {
      items.push({ key: '/teacher/exams', icon: <FileTextOutlined />, label: '考试管理' });
    }

    if (studentSubItems.length > 0) {
      items.push({
        key: 'student-management',
        icon: <TeamOutlined />,
        label: '学生管理',
        children: studentSubItems,
      });
    }

    return items;
  }, [hasPermission]);

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
          selectedKeys={[location.pathname]}
          defaultOpenKeys={location.pathname.startsWith('/teacher/departments') || location.pathname.startsWith('/teacher/students') || location.pathname.startsWith('/teacher/invitations') || location.pathname.startsWith('/teacher/applications') || location.pathname.startsWith('/teacher/import-tasks') ? ['student-management'] : undefined}
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
