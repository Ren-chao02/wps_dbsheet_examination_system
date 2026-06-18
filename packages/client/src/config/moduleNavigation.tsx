/**
 * ✅ 模块化导航配置系统
 *
 * 设计理念：
 * - 顶部导航：一级大模块（业务域）
 * - 左侧侧边栏：二级子功能（动态加载）
 * - 支持权限控制、图标、路径映射
 */

import {
  // 基础图标
  DashboardOutlined,
  QuestionCircleOutlined,
  BookOutlined,
  FileTextOutlined,
  AppstoreOutlined,
  HomeOutlined,
  EyeOutlined,
  WarningOutlined,
  SettingOutlined,

  // 监考管理相关图标
  CalendarOutlined,        // 考务安排
  MonitorOutlined,         // 实时监控
  TeamOutlined,            // 监考老师

  // 查询统计相关图标
  BarChartOutlined,        // 统计分析
  LineChartOutlined,       // 趋势报表
  FileSearchOutlined,      // 日志查询

  // 学生管理相关图标
  UserOutlined,
  BankOutlined,
  LinkOutlined,
  AuditOutlined,
  CloudUploadOutlined,

  // 系统管理
  SafetyCertificateOutlined,
} from '@ant-design/icons';

// ✅ 子功能项接口定义
export interface SubMenuItem {
  key: string;           // 路由路径 (如 '/teacher/batches')
  label: string;         // 显示名称
  icon: React.ReactNode; // 图标
  permission?: string;   // 所需权限 (可选，用于细粒度控制)
  badge?: number | 'dot' | string; // 徽标数字、红点或文字标记 (可选)
  hidden?: boolean;      // 是否隐藏 (可选)
  description?: string;  // 功能描述 (用于Tooltip)
}

// ✅ 一级大模块接口定义
export interface TopModuleItem {
  key: string;                    // 模块标识符
  label: string;                  // 模块名称
  icon: React.ReactNode;          // 图标
  permission?: string;            // 访问权限
  subItems: SubMenuItem[];        // 二级子功能列表
  defaultSubKey?: string;         // 默认选中的子功能
  description?: string;           // 模块描述 (用于Tooltip)
}

// ✅ 模块化导航配置表
export const MODULE_NAVIGATION_CONFIG: TopModuleItem[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 📊 模块1: 工作台 (Dashboard)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'dashboard',
    label: '工作台',
    icon: <DashboardOutlined />,
    subItems: [
      {
        key: '/teacher/dashboard',
        label: '概览总览',
        icon: <DashboardOutlined />,
      },
    ],
    defaultSubKey: '/teacher/dashboard',
    description: '系统概览与快捷入口',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 📚 模块2: 题库与试卷 (Question & Paper)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'content',
    label: '题库与试卷',
    icon: <BookOutlined />,
    permission: 'QUESTION_BANK', // 需要题库权限
    subItems: [
      {
        key: '/teacher/questions',
        label: '题库管理',
        icon: <QuestionCircleOutlined />,
        permission: 'QUESTION_BANK',
      },
      {
        key: '/teacher/papers',
        label: '试卷库',
        icon: <BookOutlined />,
        permission: 'EXAM_MANAGEMENT',
      },
    ],
    defaultSubKey: '/teacher/questions',
    description: '题目管理与试卷组织',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔔 模块3: 监考管理 (Invigilation Management) ★核心★
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'invigilation',
    label: '监考管理',
    icon: <MonitorOutlined />,
    permission: 'EXAM_MANAGEMENT', // 需要考试管理权限
    subItems: [
      // ── 子模块A: 考务安排 ──
      {
        key: '/teacher/batches',
        label: '批次管理',
        icon: <AppstoreOutlined />,
        permission: 'EXAM_MANAGEMENT',
        description: '统一考试参数、批次状态管理',
      },
      {
        key: '/teacher/exams',
        label: '考试管理',
        icon: <FileTextOutlined />,
        permission: 'EXAM_MANAGEMENT',
        description: '考试CRUD + 向导式创建',
        badge: 'wizard', // 标记有向导功能
      },
      {
        key: '/teacher/sessions',
        label: '场次配置',
        icon: <CalendarOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现独立场次页面
        description: '多场次时间安排与冲突检测',
      },

      // ── 子模块B: 监考明细 ──
      {
        key: '/teacher/rooms',
        label: '考场管理',
        icon: <HomeOutlined />,
        permission: 'EXAM_MANAGEMENT',
        description: '考场资源分配与学生座位管理',
      },
      {
        key: '/teacher/monitoring',
        label: '实时监控中心',
        icon: <EyeOutlined />,
        permission: 'EXAM_MANAGEMENT',
        description: '考场维度实时监控 + 异常预警',
        badge: 'enhanced', // 标记为增强版
      },
      {
        key: '/teacher/invigilators',
        label: '监考老师分配',
        icon: <TeamOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现独立监考分配页面
        description: '监考人员排班与职责分配',
      },

      // ── 子模块C: 预警提醒 ──
      {
        key: '/teacher/alerts',
        label: '异常预警',
        icon: <WarningOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现独立预警列表页
        description: '切屏异常、离线预警汇总',
      },
      {
        key: '/teacher/alert-settings',
        label: '预警规则配置',
        icon: <SettingOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现独立设置页面
        description: '自定义预警阈值与通知策略',
      },
    ],
    defaultSubKey: '/teacher/batches', // 默认显示批次管理
    description: '考务安排 · 监考明细 · 预警提醒',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 📈 模块4: 查询统计 (Query & Statistics) ★核心★
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'statistics',
    label: '查询统计',
    icon: <BarChartOutlined />,
    permission: 'EXAM_MANAGEMENT', // 需要考试管理权限
    subItems: [
      // ── 子模块A: 考情综合报表 ──
      {
        key: '/teacher/statistics',
        label: '成绩统计分析',
        icon: <BarChartOutlined />,
        permission: 'EXAM_MANAGEMENT',
        description: '成绩分布、通过率、排名等综合报表',
      },
      {
        key: '/teacher/reports',
        label: '考情趋势报告',
        icon: <LineChartOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现趋势分析
        description: '历史考试成绩变化趋势可视化',
      },
      {
        key: '/teacher/export-center',
        label: '数据导出中心',
        icon: <FileTextOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现统一导出中心
        description: 'Excel/PDF/CSV批量导出工具',
      },

      // ── 子模块B: 日志管理 ──
      {
        key: '/teacher/student-logs',
        label: '考生端日志',
        icon: <FileSearchOutlined />,
        permission: 'EXAM_MANAGEMENT',
        hidden: true, // TODO: Phase 3实现日志查看
        description: '学生操作日志、切屏记录、答题轨迹',
      },
      {
        key: '/teacher/system-logs',
        label: '系统操作日志',
        icon: <FileSearchOutlined />,
        permission: 'SYSTEM_ADMIN',
        hidden: true, // TODO: Phase 3实现审计日志
        description: '管理员操作记录与变更追踪',
      },
    ],
    defaultSubKey: '/teacher/statistics',
    description: '考情报表 · 数据分析 · 日志追踪',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 👥 模块5: 学生管理 (Student Management)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'students',
    label: '学生管理',
    icon: <TeamOutlined />,
    subItems: [
      {
        key: '/teacher/departments',
        label: '院系架构',
        icon: <BankOutlined />,
        permission: 'STUDENT_MANAGEMENT',
      },
      {
        key: '/teacher/students',
        label: '学生列表',
        icon: <UserOutlined />,
        permission: 'STUDENT_MANAGEMENT',
      },
      {
        key: '/teacher/invitations',
        label: '邀请管理',
        icon: <LinkOutlined />,
        permission: 'STUDENT_MANAGEMENT',
      },
      {
        key: '/teacher/applications',
        label: '审批队列',
        icon: <AuditOutlined />,
        permission: 'STUDENT_MANAGEMENT',
      },
      {
        key: '/teacher/import-tasks',
        label: '导入导出任务',
        icon: <CloudUploadOutlined />,
        permission: 'IMPORT_EXPORT',
      },
    ],
    defaultSubKey: '/teacher/departments',
    description: '学生信息维护与批量管理',
  },
];

// ✅ 工具函数：根据当前路径查找所属的一级模块
export function findModuleByPath(pathname: string): TopModuleItem | undefined {
  return MODULE_NAVIGATION_CONFIG.find(module =>
    module.subItems.some(item => pathname.startsWith(item.key))
  );
}

// ✅ 工具函数：根据当前路径查找对应的子菜单项
export function findSubMenuItem(pathname: string): SubMenuItem | undefined {
  for (const module of MODULE_NAVIGATION_CONFIG) {
    const found = module.subItems.find(item => item.key === pathname);
    if (found) return found;
  }
  return undefined;
}

// ✅ 工具函数：过滤用户有权限访问的模块
export function filterAccessibleModules(
  hasPermission: (perm: string) => boolean
): TopModuleItem[] {
  return MODULE_NAVIGATION_CONFIG.filter(module => {
    // 如果模块没有权限要求，直接返回true
    if (!module.permission) return true;

    // 检查是否有权限访问该模块（只要有任一子项可访问即可）
    const hasAccessibleSubItem = module.subItems.some(subItem => {
      if (subItem.hidden) return false; // 隐藏的子项不计入
      if (!subItem.permission) return true; // 无权限要求的子项
      return hasPermission(subItem.permission);
    });

    return hasAccessibleSubItem && hasPermission(module.permission);
  }).map(module => ({
    ...module,
    // 过滤掉隐藏和无权限的子项
    subItems: module.subItems.filter(subItem => {
      if (subItem.hidden) return false;
      if (!subItem.permission) return true;
      return hasPermission(subItem.permission);
    }),
  }));
}
