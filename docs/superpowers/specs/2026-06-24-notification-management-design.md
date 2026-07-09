# 通知管理模块设计

- **日期**: 2026-06-24
- **状态**: 已确认

---

## 1. 概述

在现有通知推送基础设施上，新增一个通知管理界面（Modal），提供通知发送、发送历史查看、模板管理功能。

- **管理员**：完整权限（全系统用户、全类型通知、模板 CRUD）
- **教师**：受限权限（仅考试相关通知、仅自己的学生、仅查看自己发送的历史）

## 2. 入口位置

在教师端（TeacherLayout）和管理员端（AdminLayout）的 Header 右侧，现有铃铛图标旁新增齿轮图标 `SettingOutlined`，点击打开通知管理 Modal。

```
Header 右侧：
  [🔔 铃铛]  [⚙️ 通知管理]  [👤 用户]
```

- 学生端不显示该入口
- 铃铛图标保持现有功能不变（个人通知下拉）

## 3. Modal 结构

- 标题：`通知管理`
- 宽度：`720px`
- 内容：三个 Ant Design `Tabs`

### 3.1 Tab 1：发送通知

| 字段 | 组件 | 说明 |
|------|------|------|
| 通知类型 | `Select` | SYSTEM / EXAM / GRADE / ALERT / AUDIT；教师端限制为 EXAM |
| 优先级 | `Select` | LOW / MEDIUM / HIGH / URGENT，默认 MEDIUM |
| 模板 | `Select` | 可选，选择后自动填充标题和内容 |
| 接收用户 | `Select mode="multiple"` | 支持搜索；教师端限定为 `role=student` + 该教师关联的学生 |
| 标题 | `Input` | 必填，最大 256 字 |
| 内容 | `Input.TextArea` | 可选，最大 2000 字 |
| 跳转链接 | `Input` | 可选 URL |
| 关联实体 | `Input` | 可选，如 examId |

底部按钮：`[发送通知]` `[取消]`

### 3.2 Tab 2：发送历史

| 列 | 说明 |
|---|------|
| 通知类型 | 带颜色标签 |
| 标题 | - |
| 接收者 | 用户名 |
| 发送时间 | `createdAt` |
| 状态 | 已读 / 未读 |
| 操作 | 查看详情（可选） |

- 表格带分页
- 顶部筛选：类型、时间范围
- 管理员看全系统通知，教师看自己发送的（通过 senderId 过滤）

### 3.3 Tab 3：模板管理（仅管理员可见）

| 列 | 说明 |
|---|------|
| 模板名称 | - |
| 类型 | - |
| 标题 | - |
| 创建时间 | - |
| 操作 | 编辑 / 删除 |

- 新建模板按钮 → 弹出表单（名称、类型、标题、内容）

## 4. 后端新增接口

### 4.1 通知模板 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/notifications/templates` | 获取模板列表 |
| POST | `/api/notifications/templates` | 创建模板 |
| PUT | `/api/notifications/templates/:id` | 更新模板 |
| DELETE | `/api/notifications/templates/:id` | 删除模板 |

### 4.2 发送历史增强

现有 `GET /api/notifications` 增加 `senderId` 和 `createdAt` 范围筛选参数。

### 4.3 数据库新增

新增 `NotificationTemplate` 表：

```prisma
model NotificationTemplate {
  id        String           @id @default(uuid()) @db.Uuid
  name      String           @db.VarChar(128)
  type      NotificationType
  title     String           @db.VarChar(256)
  content   String?          @db.Text
  createdBy String           @map("created_by") @db.Uuid
  createdAt DateTime         @default(now()) @map("created_at")
  updatedAt DateTime         @updatedAt @map("updated_at")

  creator   User             @relation(fields: [createdBy], references: [id])

  @@map("notification_templates")
}
```

同时 `Notification` 表新增字段：
```prisma
senderId   String?  @map("sender_id") @db.Uuid  // 发送者ID
```

## 5. 权限控制

| 操作 | 管理员 | 教师 |
|------|--------|------|
| 发送通知 | 全类型 + 全用户 | 仅 EXAM + 自己的学生 |
| 查看历史 | 全部 | 仅自己发送的 |
| 模板管理 | CRUD | 不可见 |
| 使用模板 | 所有模板 | 所有模板 |

## 6. 前端组件

- 新增 `NotificationManagerModal.tsx`：包含三个 Tab 的主 Modal 组件
- 修改 `AdminLayout.tsx`：添加齿轮图标入口
- 修改 `TeacherLayout.tsx`：添加齿轮图标入口

## 7. 不涉及

- 不修改现有 `NotificationCenter.tsx` 铃铛组件
- 不修改 Socket.IO 推送逻辑
- 不修改学生端布局
- 邮件功能保持 TODO 状态
