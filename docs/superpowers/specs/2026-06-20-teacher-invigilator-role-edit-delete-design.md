# 老师/监考员角色开放编辑删除设计文档

## 背景

当前角色权限管理中，所有 `roleType === 'preset'` 的预设角色都被禁止编辑和删除。业务上希望把“老师（TEACHER）”和“监考员（INVIGILATOR）”两个预设角色开放给管理员进行编辑和删除，但“学校管理员（ADMIN）”仍保持受保护状态。

## 设计

### 1. 判定规则

一个角色是否可编辑/删除，由以下规则共同决定：

- 可编辑：角色的 `roleCode` 不是 `ADMIN`
- 可删除：角色的 `roleCode` 不是 `ADMIN`，并且该角色下没有关联用户

即：
- `ADMIN`：不可编辑、不可删除
- `TEACHER`、`INVIGILATOR`：可编辑、可删除（无用户时）
- 自定义角色：可编辑、可删除（无用户时，与现有逻辑一致）

### 2. 前端改动

文件：[packages/client/src/pages/admin/RoleManagement.tsx](file:///data/wps_dbsheet_examination_system/packages/client/src/pages/admin/RoleManagement.tsx)

- 操作列不再只判断 `roleType === 'custom'`，改为判断 `roleCode !== 'ADMIN'`。
- 删除按钮的禁用/提示逻辑保持与自定义角色一致（已有用户时弹出提示）。

### 3. 后端改动

文件：[packages/server/src/routes/roles.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/routes/roles.ts)

- `PUT /api/roles/:id`：不再统一拒绝 `roleType === 'preset'`，仅拒绝 `roleCode === 'ADMIN'`。
- `DELETE /api/roles/:id`：不再统一拒绝 `roleType === 'preset'`，仅拒绝 `roleCode === 'ADMIN'`；其余角色仍需满足 `users.count === 0` 才能删除。

### 4. 数据安全

- 删除前必须查询该角色下的用户数量，大于 0 时返回 400。
- 编辑时允许修改角色名称、备注、状态、权限集合。
- `roleCode` 和 `roleType` 仍不可变更。

### 5. 验收标准

- [ ] 角色列表中“老师”和“监考员”显示“编辑”和“删除”按钮。
- [ ] 编辑“老师”/“监考员”能正常保存。
- [ ] “学校管理员”不显示编辑、删除按钮。
- [ ] “老师”/“监考员”下无用户时可删除；有用户时删除失败并提示。
- [ ] 自定义角色行为保持不变。
