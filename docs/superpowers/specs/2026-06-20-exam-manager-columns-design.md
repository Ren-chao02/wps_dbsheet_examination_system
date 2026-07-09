# 考试管理列表列扩展设计

## 背景
当前教师端的“考试管理”页面只展示了 8 列：名称、模式、绑定试卷、题目数、提交数、总分、状态、操作。产品希望补充为 14 列，以便教师在一页内掌握考试的关键信息。

## 目标
将考试管理列表扩展为以下 14 列，并补齐对应的数据逻辑：

1. 名称
2. 所属批次
3. 模式
4. 绑定试卷
5. 题目数
6. 提交数
7. 总分
8. 时间场次
9. 考场设置
10. 考生数量
11. 创建人
12. 创建时间
13. 状态
14. 操作

## 方案概述
采用“直接扩展列表接口”方案（方案 A）：

- 后端：扩展 `GET /api/exams`，在查询中加入 `batch`、`rooms` 以及每个考场已分配学生的计数。
- 前端：在 `ExamManager.tsx` 中按顺序声明 14 列，新增缺失列的渲染逻辑，并在操作列补回删除按钮。

## 详细设计

### 后端接口变更

文件：`packages/server/src/routes/exams.ts`

在 `GET /api/exams` 的 `prisma.exam.findMany` 中调整 `include`：

```ts
include: {
  creator: { select: { id: true, realName: true } },
  paper: { select: { id: true, name: true, totalScore: true, passScore: true } },
  batch: { select: { id: true, name: true } },
  rooms: {
    select: {
      id: true,
      code: true,
      name: true,
      _count: { select: { students: true } },
    },
  },
  _count: { select: { examQuestions: true, submissions: true } },
}
```

返回结构中的每个考试对象会额外包含：

- `batch`: `{ id, name } | null`
- `rooms`: `{ id, code, name, _count: { students } }[]`

考生数量由前端对 `rooms` 数组中的 `_count.students` 求和得到。

### 前端类型变更

文件：`packages/client/src/types/index.ts`

更新 `Exam` 接口，增加 `batch` 和 `rooms` 字段：

```ts
export interface Exam {
  // ... 现有字段
  batch?: { id: string; name: string } | null;
  rooms?: { id: string; code: string; name: string; _count?: { students: number } }[];
}
```

### 前端页面变更

文件：`packages/client/src/pages/teacher/ExamManager.tsx`

按顺序定义 14 列：

| 列名 | 数据来源 | 渲染说明 |
|------|----------|----------|
| 名称 | `title` | 文本 |
| 所属批次 | `batch.name` | 文本，未绑定显示“未归属” |
| 模式 | `mode` | 使用 `modeLabels` 映射 |
| 绑定试卷 | `paper.name` | Tag，未绑定显示“未绑定” |
| 题目数 | `_count.examQuestions` | 数字 |
| 提交数 | `_count.submissions` | 数字 |
| 总分 | `totalScore` | 数字 |
| 时间场次 | `startTime` / `endTime` | 格式：`YYYY-MM-DD HH:mm ~ HH:mm`，跨天显示完整日期；无时间显示“未设置” |
| 考场设置 | `rooms` | 取所有 `code`，用逗号连接；无考场显示“未设置” |
| 考生数量 | `rooms` | 对所有 `room._count.students` 求和 |
| 创建人 | `creator.realName` | 文本 |
| 创建时间 | `createdAt` | 格式：`YYYY-MM-DD HH:mm` |
| 状态 | `status` | 使用现有 `statusLabels` Tag |
| 操作 | - | 编辑、统计、阅卷、删除 |

操作列：

- 编辑：跳转 `/teacher/exams/:id/edit`，进行中时禁用。
- 统计：跳转 `/teacher/exams/:id/statistics`。
- 阅卷：跳转 `/teacher/exams/:id/grading`。
- 删除：调用 `DELETE /api/exams/:id`，进行中时禁用，成功后刷新列表。

### 异常与边界

- 列表中某场考试没有绑定批次或试卷时，显示占位文案，不报错。
- 考场编码过多时，按列宽自然截断（Ant Design Table 默认行为）。
- 删除失败时沿用现有错误提示：`err.response?.data?.message || '删除失败'`。

## 非目标

- 不新增独立接口，不改动现有创建/编辑考试接口。
- 不将“状态”列改为开关形式。
- 不新增批量操作、筛选或搜索功能。

## 测试要点

1. 列表能正确渲染 14 列，无列错位。
2. 已分配考场的考试，考生数量等于各考场学生数之和。
3. 无批次/无试卷/无考场/无时间场的考试显示对应占位文案。
4. 进行中考试的“编辑”和“删除”按钮被禁用。
5. 删除成功后列表自动刷新。
