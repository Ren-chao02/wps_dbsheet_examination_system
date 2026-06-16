# 系统管理模块开发方案

## Context

参考金山文档中 WPS实训室·教师端的"一、系统管理"功能（角色权限管理 + 账户管理 + 导入导出任务），当前项目存在以下差距：

| 功能 | 参考系统 | 当前项目 |
|------|----------|----------|
| 角色体系 | 3个预设角色 + 自定义角色 + 模块级权限 | `UserRole` 枚举硬编码 admin/teacher/student |
| 账户管理 | 支持 WPSID、动态角色分配、批量导入 | 基础 CRUD，硬编码3个角色选项 |
| 导入导出任务 | 集中管理所有任务，含下载任务文件/失败数据 | 仅教师端查看自己创建的任务 |

**核心设计决策**：采用"并行双轨制"——保留 `UserRole` 枚举不变（向后兼容），新增 `SystemRole` 表实现灵活权限管理。`admin` 角色始终作为超级管理员兜底放行。

## 权限模块定义（7个模块）

| 编码 | 名称 | 对应路由 |
|------|------|----------|
| `QUESTION_BANK` | 题库管理 | `/teacher/questions` |
| `EXAM_MANAGEMENT` | 考试管理 | `/teacher/exams` |
| `STUDENT_MANAGEMENT` | 学生管理 | `/teacher/students` 等 |
| `INVIGILATION` | 监考管理 | `/teacher/exams/:id/monitor` |
| `GRADE_MANAGEMENT` | 成绩管理 | `/teacher/exams/:id/grading` |
| `SYSTEM_MANAGEMENT` | 系统管理 | `/admin/*` |
| `IMPORT_EXPORT` | 导入导出 | `/teacher/import-tasks` |

## 预设角色

| 编码 | 名称 | 类型 | 权限 |
|------|------|------|------|
| `ADMIN` | 学校管理员 | preset | 全部7个模块 |
| `TEACHER` | 老师 | preset | 除 SYSTEM_MANAGEMENT 外的6个模块 |
| `INVIGILATOR` | 监考员 | preset | 仅 INVIGILATION |

---

## Task 1: 数据库 Schema 变更

**文件**: `packages/server/prisma/schema.prisma`

新增模型：
- `SystemRole` — id, roleCode(unique), roleName, roleType(preset/custom), description, status, createdBy, updatedBy, timestamps
- `SystemRolePermission` — id, roleId, moduleCode, unique(roleId+moduleCode)

修改 User 模型：
- 新增 `systemRoleId String? @db.Uuid`（可选外键关联 SystemRole）
- 新增 `wpsId String? @db.VarChar(128)`（WPS 企业账号ID）

修改 ImportTask 模型：
- 新增 `taskName String? @db.VarChar(256)`
- 新增 `downloadUrl String? @db.VarChar(512)`

运行 `npx prisma migrate dev --name add_system_roles`

---

## Task 2: 后端 — 模块常量 + 权限中间件

**新建**: `packages/server/src/constants/modules.ts` — SYSTEM_MODULES 常量数组

**修改**: `packages/server/src/middleware/auth.ts`
- 新增 `authorizePermission(...modules: string[])` 函数
- 逻辑：admin 角色直接放行 → 否则查 SystemRole.permissions 判断

---

## Task 3: 后端 — 角色 API

**新建**: `packages/server/src/routes/roles.ts`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/roles` | 角色列表（含权限） |
| GET | `/api/roles/:id` | 角色详情 |
| POST | `/api/roles` | 创建自定义角色 |
| PUT | `/api/roles/:id` | 编辑（preset 不可改） |
| DELETE | `/api/roles/:id` | 删除（preset 不可删） |
| GET | `/api/modules` | 获取模块列表 |

**修改**: `packages/server/src/app.ts` — 注册 `/api/roles`

---

## Task 4: 后端 — 账户管理 API

**新建**: `packages/server/src/routes/accounts.ts`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 账户列表（动态角色下拉） |
| POST | `/api/accounts` | 新增账户（含 wpsId, systemRoleId） |
| PUT | `/api/accounts/:id` | 编辑账户 |
| DELETE | `/api/accounts/:id` | 删除账户 |
| POST | `/api/accounts/import` | 批量导入（Excel） |
| GET | `/api/accounts/import-template` | 下载导入模板 |

**修改**: `packages/server/src/routes/auth.ts` — 登录响应新增 `permissions` 字段

**修改**: `packages/server/src/app.ts` — 注册 `/api/accounts`

---

## Task 5: 后端 — 导入导出任务增强

**修改**: `packages/server/src/routes/import-tasks.ts`
- GET 列表新增 `scope=all` 参数（管理员查看全部）
- 新增 GET `/api/import-tasks/:id/download` — 下载已完成任务文件

---

## Task 6: 前端 — 类型定义 + Auth Store

**修改**: `packages/client/src/types/index.ts`
- 新增 `SystemRole`, `SystemRolePermission`, `SystemModule` 接口
- 扩展 `User` 接口：`systemRoleId?`, `systemRole?`, `permissions?`, `wpsId?`

**修改**: `packages/client/src/stores/auth.ts`
- 新增 `permissions: string[]`
- 新增 `hasPermission(module: string): boolean`

---

## Task 7: 前端 — 角色权限管理页面

**新建**: `packages/client/src/pages/admin/RoleManagement.tsx`
- Table 列：角色编码、角色属性(Tag)、角色名称、状态、备注、更新时间、操作
- 预设角色只显示"详情"，自定义角色显示"编辑"+"删除"
- Drawer/Modal 创建编辑角色：名称 + 权限 Checkbox.Group（按模块分组）

---

## Task 8: 前端 — 增强版账户管理页面

**新建**: `packages/client/src/pages/admin/AccountManagement.tsx`
- Table 列：姓名、WPSID、角色(Tag)、状态、创建时间、操作
- Modal 新增/编辑：姓名、WPSID、用户名、角色 Select（从 /api/roles 加载）
- 批量导入入口按钮

**新建**: `packages/client/src/pages/admin/AccountImport.tsx`
- Steps 流程：下载模板 → 上传文件 → 确认 → 结果

---

## Task 9: 前端 — 导入导出任务 + 布局更新

**新建**: `packages/client/src/pages/admin/SystemImportTaskList.tsx`
- 管理员视角的任务列表（scope=all）
- 操作列：下载任务文件 / 下载失败数据

**修改**: `packages/client/src/components/layout/AdminLayout.tsx`
- 菜单扩展为：角色权限管理、账户管理、导入导出任务

**新建**: `packages/client/src/pages/public/ForbiddenPage.tsx` — 403 页面

---

## Task 10: 前端 — 路由 + 权限守卫

**修改**: `packages/client/src/App.tsx`
- 新增路由：`/admin/roles`, `/admin/accounts`, `/admin/import-tasks`
- PrivateRoute 支持 `permissions` 参数
- `/admin/users` 重定向到 `/admin/accounts`

**修改**: `packages/client/src/components/layout/TeacherLayout.tsx`
- 根据 `permissions` 数组动态生成菜单项

---

## Task 11: 种子数据 + 数据迁移

**修改**: `packages/server/prisma/seed.ts`
- 创建 3 个预设 SystemRole + 权限分配
- 现有用户关联对应 SystemRole

---

## 新增文件清单

| 文件 | Phase |
|------|-------|
| `server/src/constants/modules.ts` | Task 2 |
| `server/src/routes/roles.ts` | Task 3 |
| `server/src/routes/accounts.ts` | Task 4 |
| `client/src/pages/admin/RoleManagement.tsx` | Task 7 |
| `client/src/pages/admin/AccountManagement.tsx` | Task 8 |
| `client/src/pages/admin/AccountImport.tsx` | Task 8 |
| `client/src/pages/admin/SystemImportTaskList.tsx` | Task 9 |
| `client/src/pages/public/ForbiddenPage.tsx` | Task 9 |

## 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `server/prisma/schema.prisma` | 新增 SystemRole/Permission 模型，User/ImportTask 新增字段 |
| `server/src/middleware/auth.ts` | 新增 authorizePermission() |
| `server/src/app.ts` | 注册 roles/accounts 路由 |
| `server/src/routes/auth.ts` | 登录响应添加 permissions |
| `server/src/routes/import-tasks.ts` | scope 参数 + 下载端点 |
| `server/prisma/seed.ts` | 预设角色种子数据 |
| `client/src/types/index.ts` | SystemRole/SystemModule 类型 |
| `client/src/stores/auth.ts` | permissions + hasPermission |
| `client/src/components/layout/AdminLayout.tsx` | 菜单扩展 |
| `client/src/components/layout/TeacherLayout.tsx` | 动态菜单 |
| `client/src/App.tsx` | 新路由 + PrivateRoute 增强 |

## Verification

1. **数据库**: `npx prisma migrate dev` 成功，`npx prisma studio` 验证 SystemRole 表数据
2. **角色 API**: `curl /api/roles` 返回 3 个预设角色 + 权限列表
3. **权限中间件**: teacher 用户访问 `/api/roles` 返回 403，admin 用户正常
4. **前端角色管理**: admin 登录后 `/admin/roles` 页面可见角色列表，可创建自定义角色
5. **前端账户管理**: 新增账户时角色下拉显示自定义角色
6. **TeacherLayout**: teacher 用户看不到"系统管理"菜单，admin 可以看到全部菜单
7. **浏览器测试**: chrome-devtools MCP 逐页验证
