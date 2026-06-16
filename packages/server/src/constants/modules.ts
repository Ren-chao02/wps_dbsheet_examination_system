/**
 * 系统模块定义 — 用于角色权限管理
 */
export const SYSTEM_MODULES = [
  { code: 'QUESTION_BANK', name: '题库管理', description: '题目的创建、编辑、删除、分类管理' },
  { code: 'EXAM_MANAGEMENT', name: '考试管理', description: '考试的创建、编辑、发布、归档' },
  { code: 'STUDENT_MANAGEMENT', name: '学生管理', description: '学生信息、院系架构、邀请审批' },
  { code: 'INVIGILATION', name: '监考管理', description: '考试实时监控、会话管理' },
  { code: 'GRADE_MANAGEMENT', name: '成绩管理', description: '评分、统计、成绩导出' },
  { code: 'SYSTEM_MANAGEMENT', name: '系统管理', description: '角色权限、账户管理、系统配置' },
  { code: 'IMPORT_EXPORT', name: '导入导出', description: '批量导入导出任务管理' },
] as const;

export type ModuleCode = (typeof SYSTEM_MODULES)[number]['code'];

/** 预设角色定义 */
export const PRESET_ROLES = [
  {
    roleCode: 'ADMIN',
    roleName: '学校管理员',
    description: '拥有所有模块的操作权限',
    permissions: SYSTEM_MODULES.map((m) => m.code),
  },
  {
    roleCode: 'TEACHER',
    roleName: '老师',
    description: '拥有除"角色权限管理"、"后台用户账号"模块以外的所有操作权限',
    permissions: SYSTEM_MODULES.filter((m) => m.code !== 'SYSTEM_MANAGEMENT').map((m) => m.code),
  },
  {
    roleCode: 'INVIGILATOR',
    roleName: '监考员',
    description: '仅拥有"监考管理"模块下的操作权限',
    permissions: ['INVIGILATION'],
  },
] as const;
