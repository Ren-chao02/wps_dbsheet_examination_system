# 系统管理模块整合与功能优化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整合角色权限管理、账户管理、导入导出任务为"系统管理"大模块，优化账户字段（移除WPSID、添加性别/备注、简化状态），添加缓存管理子模块。

**Architecture:** 采用现有的 Express + Prisma + React(Antd) 技术栈，后端通过逐文件修改路由和Schema完成，前端通过组件修改和布局调整完成分组。

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), React, Ant Design, Zustand

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/server/prisma/schema.prisma` | Gender枚举加UNSET、AccountStatus改为ENABLED/DISABLED、User去wpsId加remark |
| 修改 | `packages/server/src/routes/roles.ts` | 角色列表返回updatedBy创建者信息 |
| 修改 | `packages/server/src/routes/accounts.ts` | 移除wpsId、添加gender/remark、状态ENABLED/DISABLED、disable/enable端点 |
| 修改 | `packages/server/src/routes/import-tasks.ts` | 无wpsId相关逻辑（import-tasks不处理wpsId） |
| 新建 | `packages/server/src/routes/cache.ts` | 缓存查看/清理/刷新API |
| 修改 | `packages/server/src/app.ts` | 注册cache路由 |
| 修改 | `packages/server/prisma/seed.ts` | 更新admin种子数据 |
| 修改 | `packages/client/src/types/index.ts` | Account接口更新、CacheInfo类型新增 |
| 修改 | `packages/client/src/components/layout/AdminLayout.tsx` | 系统管理SubMenu分组 |
| 修改 | `packages/client/src/pages/admin/RoleManagement.tsx` | 添加更新人列 |
| 修改 | `packages/client/src/pages/admin/AccountManagement.tsx` | 重构：去WPSID、加性别/备注、启用/禁用按钮 |
| 修改 | `packages/client/src/pages/admin/AccountImport.tsx` | 模板描述更新 |
| 新建 | `packages/client/src/pages/admin/CacheManagement.tsx` | 缓存管理页面 |
| 修改 | `packages/client/src/App.tsx` | 添加缓存管理路由 |

---

### Task 1: 数据库 Schema 变更

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: 修改 Gender 枚举添加 UNSET 值**

将 Gender 枚举从:
```prisma
enum Gender {
  MALE
  FEMALE
}
```
改为:
```prisma
enum Gender {
  MALE
  FEMALE
  UNSET
}
```

- [ ] **Step 2: 修改 AccountStatus 枚举为 ENABLED/DISABLED**

将:
```prisma
enum AccountStatus {
  ACTIVE
  INACTIVE
  PENDING_APPROVAL
}
```
改为:
```prisma
enum AccountStatus {
  ENABLED
  DISABLED
}
```

- [ ] **Step 3: 从 User 模型中移除 wpsId 字段，添加 remark 字段**

删除行：
```prisma
  wpsId        String?       @map("wps_id") @db.VarChar(128)
```

在 `accountStatus` 行之后添加：
```prisma
  remark       String?       @db.VarChar(512)
```

- [ ] **Step 4: 运行数据库迁移**

```bash
cd packages/server && npx prisma migrate dev --name adjust_account_fields
```
Expected: 迁移成功，无错误。

- [ ] **Step 5: 提交**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations/
git commit -m "feat: remove wpsId, add remark to User; simplify AccountStatus to ENABLED/DISABLED; add UNSET to Gender"
```

---

### Task 2: 角色管理API — 添加更新人信息

**Files:**
- Modify: `packages/server/src/routes/roles.ts`

当前 roles 列表查询没有 include `updatedByUser` 关系，需要关联查询更新人的真实姓名。

- [ ] **Step 1: 修改 GET /api/roles 查询，include updatedBy 用户信息**

修改 `roles.ts` 中 `GET /` 的 `prisma.systemRole.findMany` 调用，在 `include` 中添加 updatedBy 关联：

将:
```typescript
include: {
  permissions: { select: { moduleCode: true } },
  _count: { select: { users: true } },
},
```
改为:
```typescript
include: {
  permissions: { select: { moduleCode: true } },
  _count: { select: { users: true } },
  updatedByUser: { select: { realName: true, username: true } },
},
```

- [ ] **Step 2: 修改返回数据映射，添加 updatedBy**

将 data 映射中:
```typescript
data: roles.map((r) => ({
  id: r.id,
  roleCode: r.roleCode,
  ...
  updatedAt: r.updatedAt,
})),
```
添加一行:
```typescript
  updatedBy: r.updatedByUser?.realName || r.updatedByUser?.username || null,
```

- [ ] **Step 3: 同样修改 GET /api/roles/:id**

在详情接口的 `include` 中也添加 `updatedByUser`，返回数据中添加 `updatedBy` 字段。

- [ ] **Step 4: 更新种子数据的 admin 账户 updatedBy 字段**

在 seed.ts 中创建预设角色时添加 `updatedBy` 为 admin 用户ID。但 seed.ts 需要先创建 admin 用户才能引用。当前 seed 先创建 role 再创建 user，所以 updatedBy 保持 null 即可。这一步无需操作（预设角色由系统创建）。

- [ ] **Step 5: 提交**

```bash
git add packages/server/src/routes/roles.ts
git commit -m "feat: add updatedBy (creator name) to role list/detail API responses"
```

---

### Task 3: 账户管理API重构

**Files:**
- Modify: `packages/server/src/routes/accounts.ts`

大量修改：移除 wpsId、添加 gender/remark、状态改为 ENABLED/DISABLED、添加 enable/disable 端点。

- [ ] **Step 1: 修改 GET /api/accounts 列表查询**

移除 wpsId 搜索条件，添加 status 映射 ENABLED/DISABLED：

在搜索条件中，删除 `wpsId` 相关的 OR 条件行:
```typescript
{ wpsId: { contains: String(search), mode: 'insensitive' } },
```

修改 status 筛选逻辑，将 `accountStatus` where 条件保持不变（Prisma会自动匹配新枚举值）。

修改 select 字段，移除 wpsId，添加 gender、remark：
```typescript
select: {
  id: true,
  username: true,
  realName: true,
  role: true,
  email: true,
  gender: true,
  remark: true,
  employeeId: true,
  accountStatus: true,
  systemRoleId: true,
  systemRole: {
    select: { roleCode: true, roleName: true },
  },
  lastLoginAt: true,
  createdAt: true,
},
```

- [ ] **Step 2: 修改 POST /api/accounts createAccountSchema**

将:
```typescript
const createAccountSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'teacher']).default('teacher'),
  wpsId: z.string().max(128).optional(),
  systemRoleId: z.string().uuid().optional().nullable(),
});
```
改为:
```typescript
const createAccountSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'teacher']).default('teacher'),
  gender: z.enum(['MALE', 'FEMALE', 'UNSET']).optional(),
  remark: z.string().max(512).optional(),
  systemRoleId: z.string().uuid().optional().nullable(),
});
```

- [ ] **Step 3: 修改 POST 中 user.create data**

将:
```typescript
data: {
  username: data.username,
  passwordHash,
  realName: data.realName,
  email: data.email,
  role: data.role,
  wpsId: data.wpsId || null,
  systemRoleId: data.systemRoleId || null,
},
```
改为:
```typescript
data: {
  username: data.username,
  passwordHash,
  realName: data.realName,
  email: data.email,
  role: data.role,
  gender: data.gender || null,
  remark: data.remark || null,
  systemRoleId: data.systemRoleId || null,
},
```

- [ ] **Step 4: 修改 POST 中 user.create select**

将 select 中的 `wpsId: true` 改为 `gender: true, remark: true`。

- [ ] **Step 5: 修改 PUT /api/accounts/:id updateAccountSchema**

将:
```typescript
const updateAccountSchema = z.object({
  realName: z.string().optional(),
  email: z.string().email().optional().nullable(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  wpsId: z.string().max(128).optional().nullable(),
  systemRoleId: z.string().uuid().optional().nullable(),
  accountStatus: z.enum(['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL']).optional(),
});
```
改为:
```typescript
const updateAccountSchema = z.object({
  realName: z.string().optional(),
  email: z.string().email().optional().nullable(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'UNSET']).optional().nullable(),
  remark: z.string().max(512).optional().nullable(),
  systemRoleId: z.string().uuid().optional().nullable(),
  accountStatus: z.enum(['ENABLED', 'DISABLED']).optional(),
});
```

- [ ] **Step 6: 修改 PUT 中 user.update data**

将 data 构建从引用 `data.wpsId` 改为引用 `data.gender` 和 `data.remark`:
```typescript
data: {
  ...(data.realName !== undefined && { realName: data.realName }),
  ...(data.email !== undefined && { email: data.email }),
  ...(data.role !== undefined && { role: data.role }),
  ...(data.gender !== undefined && { gender: data.gender }),
  ...(data.remark !== undefined && { remark: data.remark }),
  ...(data.systemRoleId !== undefined && { systemRoleId: data.systemRoleId }),
  ...(data.accountStatus !== undefined && { accountStatus: data.accountStatus }),
},
```

修改 select 返回字段移除 wpsId，添加 gender、remark。

- [ ] **Step 7: 添加 PUT /api/accounts/:id/disable 端点**

在 DELETE 路由之前插入:
```typescript
// PUT /api/accounts/:id/disable — 禁用账户
accountRouter.put('/:id/disable', async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.user!.userId) {
      return res.status(400).json({ message: '不能禁用自己的账户' });
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { accountStatus: 'DISABLED' },
    });
    res.json({ message: '账户已禁用', id: user.id });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 8: 添加 PUT /api/accounts/:id/enable 端点**

```typescript
// PUT /api/accounts/:id/enable — 启用账户
accountRouter.put('/:id/enable', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { accountStatus: 'ENABLED' },
    });
    res.json({ message: '账户已启用', id: user.id });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
```

注意：disable/enable 路由必须放在 `PUT /:id` 之前，否则 `disable`/`enable` 会被 `:id` 匹配为参数。

- [ ] **Step 9: 修改批量导入逻辑移除 wpsId**

在 `POST /import` 中修改 Excel 列读取和 create data:

将列定义从:
```typescript
worksheet.columns = [
  { header: '用户名(必填)', key: 'username', width: 18 },
  { header: '密码(必填)', key: 'password', width: 14 },
  { header: '姓名', key: 'realName', width: 12 },
  { header: 'WPSID(企业账号ID)', key: 'wpsId', width: 20 },
  { header: '邮箱', key: 'email', width: 24 },
  { header: '角色编码(如TEACHER)', key: 'roleCode', width: 20 },
];
```
改为:
```typescript
worksheet.columns = [
  { header: '用户名(必填)', key: 'username', width: 18 },
  { header: '密码(必填)', key: 'password', width: 14 },
  { header: '姓名', key: 'realName', width: 12 },
  { header: '邮箱', key: 'email', width: 24 },
  { header: '角色编码(如TEACHER)', key: 'roleCode', width: 20 },
];
```

在导入循环中，移除 wpsId 的读取（第4列）并重新映射列索引：
```typescript
const username = String(row.getCell(1).value || '').trim();
const password = String(row.getCell(2).value || '').trim();
const realName = String(row.getCell(3).value || '').trim();
const email = String(row.getCell(4).value || '').trim();
const roleCode = String(row.getCell(5).value || '').trim() || 'TEACHER';
```

修改失败行检查条件（移除 wpsId 引用）：
```typescript
if (!username || !password) {
  if (username || password || realName || email) {
```

修改 user.create data 移除 `wpsId`:
```typescript
data: {
  username,
  passwordHash,
  realName: realName || null,
  email: email || null,
  role: userRole,
  systemRoleId,
},
```

- [ ] **Step 10: 修改导出模板和导出数据移除 wpsId**

在 `GET /export` 中：
- 移除 select 和 worksheet columns 中的 `wpsId`
- 移除 addRow 中的 wpsId 引用

- [ ] **Step 11: 提交**

```bash
git add packages/server/src/routes/accounts.ts
git commit -m "feat: remove wpsId, add gender/remark, simplify status to ENABLED/DISABLED, add disable/enable endpoints"
```

---

### Task 4: 缓存管理API（新建）

**Files:**
- Create: `packages/server/src/routes/cache.ts`
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: 创建 cache.ts 路由文件**

```typescript
/**
 * 缓存管理路由 — 提供系统缓存查看/清理/刷新功能
 */
import { Router, Request, Response } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';

export const cacheRouter = Router();

cacheRouter.use(authenticate);
cacheRouter.use(authorizePermission('SYSTEM_MANAGEMENT'));

// 内存缓存存储（示例：存储统计数据和配置）
const memoryCache: Map<string, { value: any; createdAt: number }> = new Map();

// GET /api/cache — 查看缓存状态
cacheRouter.get('/', (_req: Request, res: Response) => {
  const entries = Array.from(memoryCache.entries()).map(([key, item]) => ({
    key,
    createdAt: new Date(item.createdAt).toISOString(),
    age: Math.round((Date.now() - item.createdAt) / 1000),
    size: JSON.stringify(item.value).length,
  }));

  res.json({
    data: {
      totalEntries: entries.length,
      entries,
      message: '缓存状态查询成功',
    },
  });
});

// POST /api/cache/clear — 清理缓存
cacheRouter.post('/clear', (_req: Request, res: Response) => {
  memoryCache.clear();
  res.json({ message: '缓存已清理', totalEntries: 0 });
});

// POST /api/cache/refresh — 刷新缓存（重建缓存数据）
cacheRouter.post('/refresh', async (_req: Request, res: Response) => {
  // 清旧缓存
  memoryCache.clear();

  // 重建缓存 — 例如预加载系统统计
  memoryCache.set('system_stats', {
    value: { refreshedAt: new Date().toISOString() },
    createdAt: Date.now(),
  });

  res.json({
    message: '缓存已刷新',
    totalEntries: memoryCache.size,
  });
});

// 导出缓存实例供其他模块使用
export { memoryCache };
```

- [ ] **Step 2: 注册 cache 路由到 app.ts**

在 `packages/server/src/app.ts` 中：
- 添加 import: `import { cacheRouter } from './routes/cache';`
- 添加路由注册: `app.use('/api/cache', cacheRouter);`

- [ ] **Step 3: 提交**

```bash
git add packages/server/src/routes/cache.ts packages/server/src/app.ts
git commit -m "feat: add cache management API (view/clear/refresh)"
```

---

### Task 5: 前端类型定义 + AdminLayout分组

**Files:**
- Modify: `packages/client/src/types/index.ts`
- Modify: `packages/client/src/components/layout/AdminLayout.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: 更新 Account 接口**

在 `packages/client/src/types/index.ts` 中找到 Account 接口，修改为:
```typescript
export interface Account {
  id: string;
  username: string;
  realName?: string;
  email?: string;
  role: 'admin' | 'teacher' | 'student';
  gender?: 'MALE' | 'FEMALE' | 'UNSET';
  remark?: string;
  employeeId?: string;
  systemRoleId?: string;
  systemRole?: { roleCode: string; roleName: string };
  accountStatus: 'ENABLED' | 'DISABLED';
  lastLoginAt?: string;
  createdAt: string;
}
```

- [ ] **Step 2: 更新 SystemRole 接口添加 updatedBy**

```typescript
export interface SystemRole {
  id: string;
  roleCode: string;
  roleName: string;
  roleType: 'preset' | 'custom';
  description?: string;
  status: 'ACTIVE' | 'DISABLED';
  permissions: string[];
  userCount?: number;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: 添加 CacheInfo 接口**

在文件末尾添加:
```typescript
export interface CacheEntry {
  key: string;
  createdAt: string;
  age: number;
  size: number;
}

export interface CacheInfo {
  totalEntries: number;
  entries: CacheEntry[];
}
```

- [ ] **Step 4: 修改 AdminLayout 为系统管理分组**

将 `packages/client/src/components/layout/AdminLayout.tsx` 中的 menuItems 从平级改为 SubMenu 结构:

```typescript
import {
  LogoutOutlined,
  UserOutlined,
  SafetyCertificateOutlined,
  UserSwitchOutlined,
  CloudUploadOutlined,
  DatabaseOutlined,
  SettingOutlined,
} from '@ant-design/icons';

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
```

同时需要修改 selectedKeys 逻辑，因为现在有子菜单，需要使用 `defaultOpenKeys` 或 `openKeys` 保持系统管理展开:

在组件中添加:
```typescript
const selectedKey = location.pathname.startsWith('/admin/') ? location.pathname : '/admin/accounts';
```

修改 Menu 组件的 `selectedKeys`:
```typescript
<Menu
  theme="dark"
  mode="inline"
  selectedKeys={[selectedKey]}
  defaultOpenKeys={['system-mgmt']}
  items={menuItems}
  onClick={({ key }) => { if (!key.startsWith('system-')) navigate(key); }}
/>
```

- [ ] **Step 5: 在 App.tsx 添加缓存管理路由**

在 `Admin` Route 内添加:
```typescript
<Route path="cache" element={<CacheManagement />} />
```

添加 import:
```typescript
import CacheManagement from './pages/admin/CacheManagement';
```

- [ ] **Step 6: 提交**

```bash
git add packages/client/src/types/index.ts packages/client/src/components/layout/AdminLayout.tsx packages/client/src/App.tsx
git commit -m "feat: add System Management submenu grouping, update Account/SystemRole types, add cache route"
```

---

### Task 6: 角色管理页面 — 添加更新人列

**Files:**
- Modify: `packages/client/src/pages/admin/RoleManagement.tsx`

- [ ] **Step 1: 在表格中添加"更新人"列**

在 columns 数组的"更新时间"列之后添加:
```typescript
{
  title: '更新人', dataIndex: 'updatedBy', key: 'updatedBy', width: 100,
  render: (v: string | null) => v || '—',
},
```

- [ ] **Step 2: 在 View Drawer 中添加更新人信息**

如果 `viewingRole` 的详情展示中有需要，可添加更新人字段。当前 Drawer 内容在 RoleManagement.tsx 下半部分。检查是否有 Descriptions 组件展示详情，若有则添加更新人项。

- [ ] **Step 3: 提交**

```bash
git add packages/client/src/pages/admin/RoleManagement.tsx
git commit -m "feat: add updatedBy column to role management table"
```

---

### Task 7: 账户管理页面重构

**Files:**
- Modify: `packages/client/src/pages/admin/AccountManagement.tsx`

- [ ] **Step 1: 更新状态映射**

将:
```typescript
const statusMap: Record<string, { color: string; text: string }> = {
  ACTIVE: { color: 'green', text: '正常' },
  INACTIVE: { color: 'red', text: '禁用' },
  PENDING_APPROVAL: { color: 'orange', text: '待审批' },
};
```
改为:
```typescript
const statusMap: Record<string, { color: string; text: string }> = {
  ENABLED: { color: 'green', text: '启用' },
  DISABLED: { color: 'red', text: '禁用' },
};
```

- [ ] **Step 2: 移除 WPSID 列，添加性别和备注列**

删除表格中的 WPSID 列，添加性别列和备注列:

```typescript
{
  title: '性别', dataIndex: 'gender', key: 'gender', width: 80,
  render: (v: string | null) => {
    if (v === 'MALE') return '男';
    if (v === 'FEMALE') return '女';
    return '—';
  },
},
{
  title: '备注', dataIndex: 'remark', key: 'remark', width: 120, ellipsis: true,
  render: (v: string | null) => v || '—',
},
```

- [ ] **Step 3: 更新编辑表单字段**

在 `handleEdit` 中:
```typescript
const handleEdit = (account: Account) => {
  setEditingAccount(account);
  form.setFieldsValue({
    realName: account.realName,
    email: account.email,
    gender: account.gender,
    remark: account.remark,
    role: account.role,
    systemRoleId: account.systemRoleId,
    accountStatus: account.accountStatus,
  });
  setModalOpen(true);
};
```

- [ ] **Step 4: 更新表单提交逻辑**

在 `handleSubmit` 中移除 `wpsId`，添加 `gender` 和 `remark`:
```typescript
const handleSubmit = async () => {
  try {
    const values = await form.validateFields();
    if (editingAccount) {
      await api.put(`/accounts/${editingAccount.id}`, {
        realName: values.realName,
        email: values.email || null,
        gender: values.gender || null,
        remark: values.remark || null,
        role: values.role,
        systemRoleId: values.systemRoleId || null,
        accountStatus: values.accountStatus,
      });
      message.success('更新成功');
    } else {
      await api.post('/accounts', {
        username: values.username,
        password: values.password,
        realName: values.realName,
        gender: values.gender || null,
        remark: values.remark || null,
        email: values.email || null,
        role: values.role,
        systemRoleId: values.systemRoleId || null,
      });
      message.success('创建成功');
    }
    setModalOpen(false);
    fetchAccounts(data.page);
  } catch (err: any) {
    const msg = err.response?.data?.message || '操作失败';
    message.error(msg);
  }
};
```

- [ ] **Step 5: 添加禁用/启用操作按钮**

在操作列的 render 中添加禁用/启用按钮:
```typescript
{
  title: '操作', key: 'actions', width: 280,
  render: (_: any, r: Account) => (
    <Space>
      <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
      <Popconfirm
        title={`确定重置 ${r.username} 的密码？`}
        onConfirm={() => handleResetPassword(r.id, r.username)}
      >
        <Button size="small" icon={<KeyOutlined />}>重置密码</Button>
      </Popconfirm>
      {r.accountStatus === 'ENABLED' ? (
        <Popconfirm
          title={`确定禁用账户 ${r.username}？`}
          onConfirm={() => handleToggleStatus(r)}
        >
          <Button size="small" danger>禁用</Button>
        </Popconfirm>
      ) : (
        <Popconfirm
          title={`确定启用账户 ${r.username}？`}
          onConfirm={() => handleToggleStatus(r)}
        >
          <Button size="small" style={{ color: '#52c41a', borderColor: '#52c41a' }}>启用</Button>
        </Popconfirm>
      )}
      <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
        <Button size="small" danger icon={<DeleteOutlined />} />
      </Popconfirm>
    </Space>
  ),
},
```

添加 `handleToggleStatus` 函数:
```typescript
const handleToggleStatus = async (account: Account) => {
  try {
    if (account.accountStatus === 'ENABLED') {
      await api.put(`/accounts/${account.id}/disable`);
      message.success('账户已禁用');
    } else {
      await api.put(`/accounts/${account.id}/enable`);
      message.success('账户已启用');
    }
    fetchAccounts(data.page);
  } catch (err: any) {
    message.error(err.response?.data?.message || '操作失败');
  }
};
```

- [ ] **Step 6: 更新 Modal 表单添加性别和备注字段**

在创建/编辑 Modal 的 Form 中添加性别和备注:
```jsx
<Form.Item name="gender" label="性别">
  <Select allowClear placeholder="请选择性别">
    <Select.Option value="MALE">男</Select.Option>
    <Select.Option value="FEMALE">女</Select.Option>
    <Select.Option value="UNSET">未设置</Select.Option>
  </Select>
</Form.Item>
<Form.Item name="remark" label="备注">
  <Input.TextArea rows={2} placeholder="备注信息" maxLength={512} />
</Form.Item>
```

- [ ] **Step 7: 提交**

```bash
git add packages/client/src/pages/admin/AccountManagement.tsx
git commit -m "feat: refactor account management (remove WPSID, add gender/remark, ENABLED/DISABLED toggle)"
```

---

### Task 8: 缓存管理页面 + 导入模板描述更新

**Files:**
- Create: `packages/client/src/pages/admin/CacheManagement.tsx`
- Modify: `packages/client/src/pages/admin/AccountImport.tsx`

- [ ] **Step 1: 创建 CacheManagement.tsx**

```typescript
import { useEffect, useState } from 'react';
import { Card, Button, Table, Tag, Space, message, Popconfirm, Typography } from 'antd';
import { ClearOutlined, ReloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import api from '../../services/api';
import type { CacheInfo, CacheEntry } from '../../types';

const { Text, Paragraph } = Typography;

export default function CacheManagement() {
  const [cacheInfo, setCacheInfo] = useState<CacheInfo>({ totalEntries: 0, entries: [] });
  const [loading, setLoading] = useState(true);

  const fetchCache = async () => {
    setLoading(true);
    try {
      const res = await api.get('/cache');
      setCacheInfo(res.data.data);
    } catch {
      message.error('加载缓存信息失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCache(); }, []);

  const handleClear = async () => {
    try {
      await api.post('/cache/clear');
      message.success('缓存已清理');
      fetchCache();
    } catch {
      message.error('清理缓存失败');
    }
  };

  const handleRefresh = async () => {
    try {
      await api.post('/cache/refresh');
      message.success('缓存已刷新');
      fetchCache();
    } catch {
      message.error('刷新缓存失败');
    }
  };

  const columns = [
    { title: '缓存键', dataIndex: 'key', key: 'key', width: 200 },
    {
      title: '大小', dataIndex: 'size', key: 'size', width: 100,
      render: (v: number) => `${v} B`,
    },
    {
      title: '存活时间', dataIndex: 'age', key: 'age', width: 120,
      render: (v: number) => {
        if (v < 60) return `${v}秒`;
        if (v < 3600) return `${Math.floor(v / 60)}分钟`;
        return `${Math.floor(v / 3600)}小时`;
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>缓存管理</h2>
        <Space>
          <Popconfirm title="确定清理所有缓存？" onConfirm={handleClear}>
            <Button icon={<ClearOutlined />} danger>清理缓存</Button>
          </Popconfirm>
          <Popconfirm title="确定刷新缓存？" onConfirm={handleRefresh}>
            <Button type="primary" icon={<ReloadOutlined />}>刷新缓存</Button>
          </Popconfirm>
        </Space>
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        管理系统缓存数据，包括查看缓存状态、清理过期缓存、刷新缓存数据等操作。
      </Text>

      <Card
        title={<Space><DatabaseOutlined />缓存状态</Space>}
        extra={<Text>共 {cacheInfo.totalEntries} 条缓存</Text>}
        style={{ marginBottom: 24 }}
      >
        <Table
          dataSource={cacheInfo.entries}
          columns={columns}
          rowKey="key"
          loading={loading}
          pagination={false}
          locale={{ emptyText: '当前没有缓存数据' }}
        />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: 更新 AccountImport 模板描述**

在 `AccountImport.tsx` 中，将步骤0的描述从:
```typescript
<Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto 24px' }}>
  请先下载标准导入模板，按照模板格式填写账户信息后上传。
  模板包含字段：用户名(必填)、密码(必填)、姓名、WPSID、邮箱、角色编码。
</Paragraph>
```
改为:
```typescript
<Paragraph type="secondary" style={{ maxWidth: 480, margin: '0 auto 24px' }}>
  请先下载标准导入模板，按照模板格式填写账户信息后上传。
  模板包含字段：用户名(必填)、密码(必填)、姓名、邮箱、角色编码。
</Paragraph>
```

- [ ] **Step 3: 提交**

```bash
git add packages/client/src/pages/admin/CacheManagement.tsx packages/client/src/pages/admin/AccountImport.tsx
git commit -m "feat: add cache management page; update import template description"
```

---

### Task 9: 种子数据更新 & 数据库迁移验证

**Files:**
- Modify: `packages/server/prisma/seed.ts`

- [ ] **Step 1: 更新 seed 中 admin 账户数据**

在 seed.ts 中，将 admin user 的 create data 调整为适配新 schema:
```typescript
const admin = await prisma.user.create({
  data: {
    username: 'admin',
    passwordHash,
    realName: '系统管理员',
    role: 'admin',
    email: 'admin@example.com',
    gender: 'UNSET',
    remark: '系统预置管理员账户',
    systemRoleId: systemRoleAdmin.id,
  },
});
```

更新 teacher 添加 remark:
```typescript
const teacher = await prisma.user.create({
  data: {
    username: 'teacher1',
    passwordHash,
    realName: '王老师',
    role: 'teacher',
    email: 'teacher@example.com',
    gender: 'MALE',
    remark: '预置教师账户',
    systemRoleId: systemRoleTeacher.id,
  },
});
```

- [ ] **Step 2: 运行数据库迁移（如果还未执行）**

```bash
cd packages/server && npx prisma migrate dev --name adjust_account_fields
```
Expected: 成功执行迁移。

- [ ] **Step 3: 运行种子数据重置**

```bash
cd packages/server && npx prisma db seed
```
Expected: 种子数据填充成功。

- [ ] **Step 4: 检查生成的 Prisma Client 类型**

```bash
cd packages/server && npx prisma generate
```
Expected: 无类型错误。

- [ ] **Step 5: 启动后端验证**

```bash
cd packages/server && npm run dev
```
Expected: 服务启动无错误。

- [ ] **Step 6: 启动前端验证**

```bash
cd packages/client && npm run dev
```
Expected: 前端编译无错误，TypeScript 类型检查通过。

- [ ] **Step 7: 提交**

```bash
git add packages/server/prisma/seed.ts
git commit -m "feat: update seed data for new account fields (gender/remark/ENABLED)"
```
