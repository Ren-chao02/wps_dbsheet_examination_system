# 老师/监考员角色开放编辑删除实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“老师（TEACHER）”和“监考员（INVIGILATOR）”两个预设角色支持编辑和删除，同时保持“学校管理员（ADMIN）”受保护。

**Architecture:** 通过硬编码 `roleCode !== 'ADMIN'` 的判定规则，同时修改前端操作列展示逻辑和后端 `PUT/DELETE /api/roles/:id` 的权限校验。

**Tech Stack:** React 18, Ant Design 5, TypeScript, Express, Prisma, Zod.

---

## 文件结构

```
packages/client/src/pages/admin/RoleManagement.tsx  # 前端操作列按钮展示
packages/server/src/routes/roles.ts                 # 后端编辑/删除校验
```

---

## Task 1: 前端操作列对 TEACHER/INVIGILATOR 显示编辑删除

**Files:**
- Modify: `packages/client/src/pages/admin/RoleManagement.tsx:145-163`

- [ ] **Step 1: 定位当前操作列渲染逻辑**

当前代码（约 145-163 行）：
```typescript
{
  title: '操作', key: 'actions', width: 160,
  render: (_: any, r: SystemRole) => (
    <Space>
      <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(r)}>详情</Button>
      {r.roleType === 'custom' && (
        <>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm
            title="确定删除该角色？"
            description="删除后不可恢复"
            onConfirm={() => handleDelete(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </>
      )}
    </Space>
  ),
},
```

- [ ] **Step 2: 修改判定条件**

把 `r.roleType === 'custom'` 改为 `r.roleCode !== 'ADMIN'`：

```typescript
{
  title: '操作', key: 'actions', width: 160,
  render: (_: any, r: SystemRole) => (
    <Space>
      <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(r)}>详情</Button>
      {r.roleCode !== 'ADMIN' && (
        <>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <Popconfirm
            title="确定删除该角色？"
            description="删除后不可恢复"
            onConfirm={() => handleDelete(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </>
      )}
    </Space>
  ),
},
```

- [ ] **Step 3: 运行客户端类型检查**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit`
Expected: 无新增错误。

---

## Task 2: 后端允许编辑 TEACHER/INVIGILATOR

**Files:**
- Modify: `packages/server/src/routes/roles.ts:190-200`

- [ ] **Step 1: 定位编辑校验逻辑**

当前 `PUT /api/roles/:id` 中：
```typescript
if (role.roleType === 'preset') {
  return res.status(403).json({ message: '预设角色不可修改' });
}
```

- [ ] **Step 2: 改为仅保护 ADMIN**

```typescript
if (role.roleCode === 'ADMIN') {
  return res.status(403).json({ message: '学校管理员角色不可修改' });
}
```

- [ ] **Step 3: 运行服务端测试**

Run: `cd /data/wps_dbsheet_examination_system/packages/server && npm test`
Expected: 全部通过。

---

## Task 3: 后端允许删除 TEACHER/INVIGILATOR（无用户时）

**Files:**
- Modify: `packages/server/src/routes/roles.ts:240-260`

- [ ] **Step 1: 定位删除校验逻辑**

当前 `DELETE /api/roles/:id` 中：
```typescript
if (role.roleType === 'preset') {
  return res.status(403).json({ message: '预设角色不可删除' });
}
if (role._count.users > 0) {
  return res.status(400).json({ message: `该角色下还有 ${role._count.users} 个用户，无法删除` });
}
```

- [ ] **Step 2: 改为仅保护 ADMIN，其余角色按用户数量判断**

```typescript
if (role.roleCode === 'ADMIN') {
  return res.status(403).json({ message: '学校管理员角色不可删除' });
}
if (role._count.users > 0) {
  return res.status(400).json({ message: `该角色下还有 ${role._count.users} 个用户，无法删除` });
}
```

- [ ] **Step 3: 运行服务端测试**

Run: `cd /data/wps_dbsheet_examination_system/packages/server && npm test`
Expected: 全部通过。

---

## Task 4: 端到端验证

- [ ] **Step 1: 启动开发服务器**

Run:
```bash
cd /data/wps_dbsheet_examination_system
npm run dev
```

- [ ] **Step 2: 手动验证**

1. 管理员登录，进入「系统管理 → 角色权限管理」。
2. 确认「学校管理员」行没有编辑/删除按钮。
3. 确认「老师」和「监考员」行有编辑和删除按钮。
4. 点击「老师」的编辑，修改角色名称或权限，保存成功。
5. 给某个账户分配「监考员」角色后，尝试删除「监考员」，应提示“该角色下还有 1 个用户，无法删除”。
6. 移除该账户的「监考员」角色后，再次删除，应成功。

- [ ] **Step 3: 运行客户端生产构建**

Run: `cd /data/wps_dbsheet_examination_system/packages/client && npm run build`
Expected: 构建成功。

---

## Self-Review

### Spec Coverage

- 老师/监考员显示编辑删除按钮：Task 1
- 学校管理员仍受保护：Task 1/2/3 中的 `roleCode !== 'ADMIN'` 逻辑
- 有用户时禁止删除：Task 3 保留 `role._count.users > 0` 判断
- 编辑保存正常：Task 2 放行 TEACHER/INVIGILATOR

### Placeholder Scan

- 无 TBD/TODO/implementation later。
- 所有代码块包含完整代码。

### Type Consistency

- 使用 `roleCode` 而非 `roleType` 做判定，与后端 schema 一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-teacher-invigilator-role-edit-delete.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
