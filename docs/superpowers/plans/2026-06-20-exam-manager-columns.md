# 考试管理列表列扩展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将教师端“考试管理”列表从 8 列扩展为 14 列，并补齐后端数据支持。

**Architecture:** 扩展 `GET /api/exams` 接口返回批次和考场信息，前端 `ExamManager` 按新列顺序渲染，考生数量由前端对考场学生计数求和。

**Tech Stack:** React + TypeScript + Ant Design，Prisma + Express。

---

## 文件变更清单

- **Modify** `packages/server/src/routes/exams.ts` — 扩展 `GET /api/exams` 的 `include`，加入 `batch` 与 `rooms`。
- **Modify** `packages/client/src/types/index.ts` — 为 `Exam` 接口增加 `batch` 和 `rooms` 字段。
- **Modify** `packages/client/src/pages/teacher/ExamManager.tsx` — 重新定义 14 列，补回删除按钮，新增时间场次、考场设置等渲染逻辑。

---

### Task 1: 扩展后端列表接口

**Files:**
- Modify: `packages/server/src/routes/exams.ts:37-55`

- [ ] **Step 1: 修改 `GET /api/exams` 的 `include` 子句**

将现有 `include`：

```ts
include: {
  creator: { select: { id: true, realName: true } },
  paper: { select: { id: true, name: true, totalScore: true, passScore: true } },
  _count: { select: { examQuestions: true, submissions: true } },
},
```

替换为：

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
},
```

- [ ] **Step 2: 验证语法**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server && npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/exams.ts
git commit -m "feat(api): include batch and rooms in exam list response"
```

---

### Task 2: 更新前端类型定义

**Files:**
- Modify: `packages/client/src/types/index.ts:126-150`

- [ ] **Step 1: 在 `Exam` 接口中增加 `batch` 和 `rooms` 字段**

在现有 `Exam` 接口的 `paper` 字段之后、`_count` 字段之前插入：

```ts
  batchId?: string | null;
  batch?: { id: string; name: string } | null;
  rooms?: { id: string; code: string; name: string; _count?: { students: number } }[];
```

确保 `Exam` 接口最终形如：

```ts
export interface Exam {
  id: string;
  title: string;
  description: string | null;
  mode: ExamMode;
  durationMinutes: number | null;
  startTime: string | null;
  endTime: string | null;
  totalScore: number;
  passScore: number | null;
  status: ExamStatus;
  settings: Record<string, any>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; realName: string } | null;
  paperId?: string | null;
  paper?: { id: string; name: string; totalScore: number; passScore: number | null } | null;
  batchId?: string | null;
  batch?: { id: string; name: string } | null;
  rooms?: { id: string; code: string; name: string; _count?: { students: number } }[];
  examQuestions?: ExamQuestion[];
  _count?: { examQuestions: number; submissions: number };
}
```

- [ ] **Step 2: 验证类型**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit
```

Expected: 无新增类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/types/index.ts
git commit -m "feat(types): add batch and rooms fields to Exam interface"
```

---

### Task 3: 重构考试管理列表列定义

**Files:**
- Modify: `packages/client/src/pages/teacher/ExamManager.tsx`

- [ ] **Step 1: 引入 `DeleteOutlined` 图标（已引入，无需修改）**

确认文件顶部已有：

```ts
import { PlusOutlined, EyeOutlined, EditOutlined, DeleteOutlined, BarChartOutlined } from '@ant-design/icons';
```

- [ ] **Step 2: 新增辅助格式化函数**

在 `statusLabels` 常量定义之后、`export function ExamManager()` 之前，插入：

```ts
function formatTimeSlot(exam: Exam): string {
  if (!exam.startTime) return '未设置';
  const start = dayjs(exam.startTime);
  const end = exam.endTime ? dayjs(exam.endTime) : null;
  const date = start.format('YYYY-MM-DD');
  const startTime = start.format('HH:mm');
  const endTime = end ? end.format('HH:mm') : '';
  if (end && !start.isSame(end, 'day')) {
    return `${start.format('YYYY-MM-DD HH:mm')} ~ ${end.format('YYYY-MM-DD HH:mm')}`;
  }
  return `${date} ${startTime}${endTime ? ` ~ ${endTime}` : ''}`;
}

function formatRoomSettings(rooms?: Exam['rooms']): string {
  if (!rooms || rooms.length === 0) return '未设置';
  return rooms.map(r => r.code).join(', ');
}

function countAssignedStudents(rooms?: Exam['rooms']): number {
  return rooms?.reduce((sum, r) => sum + (r._count?.students ?? 0), 0) ?? 0;
}
```

- [ ] **Step 3: 引入 `dayjs`**

在文件顶部添加：

```ts
import dayjs from 'dayjs';
```

- [ ] **Step 4: 替换 `columns` 定义**

将现有 `columns` 数组完整替换为：

```ts
  const columns = [
    { title: '名称', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '所属批次',
      key: 'batch',
      render: (_: any, r: Exam) => r.batch?.name ?? '未归属',
    },
    { title: '模式', dataIndex: 'mode', key: 'mode', render: (v: string) => modeLabels[v] },
    {
      title: '绑定试卷',
      key: 'paper',
      render: (_: any, r: Exam) => (
        r.paper ? <Tag color="blue">{r.paper.name}</Tag> : <Tag color="default">未绑定</Tag>
      ),
    },
    { title: '题目数', key: 'questions', render: (_: any, r: Exam) => r._count?.examQuestions ?? 0 },
    { title: '提交数', key: 'submissions', render: (_: any, r: Exam) => r._count?.submissions ?? 0 },
    { title: '总分', dataIndex: 'totalScore', key: 'totalScore' },
    {
      title: '时间场次',
      key: 'timeSlot',
      width: 180,
      render: (_: any, r: Exam) => formatTimeSlot(r),
    },
    {
      title: '考场设置',
      key: 'rooms',
      ellipsis: true,
      render: (_: any, r: Exam) => formatRoomSettings(r.rooms),
    },
    {
      title: '考生数量',
      key: 'studentCount',
      render: (_: any, r: Exam) => countAssignedStudents(r.rooms),
    },
    {
      title: '创建人',
      key: 'creator',
      render: (_: any, r: Exam) => r.creator?.realName ?? '-',
    },
    {
      title: '创建时间',
      key: 'createdAt',
      width: 140,
      render: (_: any, r: Exam) => r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => {
        const s = statusLabels[v] || { color: 'default', text: v };
        return <Tag color={s.color}>{s.text}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      fixed: 'right',
      render: (_: any, r: Exam) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/edit`)} disabled={r.status === 'in_progress'}>编辑</Button>
          <Button size="small" icon={<BarChartOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/statistics`)}>统计</Button>
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/teacher/exams/${r.id}/grading`)}>阅卷</Button>
          <Button size="small" icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} disabled={r.status === 'in_progress'}>删除</Button>
        </Space>
      ),
    },
  ];
```

- [ ] **Step 5: 调整表格宽度与滚动**

在 `<Table>` 上增加 `scroll` 属性，避免列过多撑破页面：

```tsx
<Table
  dataSource={data.data}
  columns={columns}
  rowKey="id"
  loading={loading}
  scroll={{ x: 1500 }}
  pagination={{ current: data.page, total: data.total, pageSize: data.pageSize, onChange: fetchExams }}
/>
```

- [ ] **Step 6: 验证构建**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/client && npx tsc --noEmit
```

Expected: 无新增类型错误。

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/pages/teacher/ExamManager.tsx
git commit -m "feat(ui): extend exam manager list to 14 columns with batch, rooms and delete action"
```

---

### Task 4: 联调验证

**Files:**
- 无需修改文件

- [ ] **Step 1: 启动后端服务**

Run:
```bash
cd /data/wps_dbsheet_examination_system/packages/server && npm run dev
```

- [ ] **Step 2: 启动前端服务**

在新终端运行：
```bash
cd /data/wps_dbsheet_examination_system/packages/client && npm run dev
```

- [ ] **Step 3: 功能验证 checklist**

1. 打开教师端“考试管理”页面，确认表格显示 14 列。
2. 检查“所属批次”列：已绑定批次显示名称，未绑定显示“未归属”。
3. 检查“时间场次”列：有起止时间时显示 `YYYY-MM-DD HH:mm ~ HH:mm`，跨天时显示完整起止日期。
4. 检查“考场设置”列：显示考场编码，多个用逗号分隔；无考场显示“未设置”。
5. 检查“考生数量”列：数值等于各考场 `_count.students` 之和。
6. 检查“创建人”和“创建时间”列：正确显示。
7. 检查操作列：包含编辑、统计、阅卷、删除按钮。
8. 对“进行中”的考试：编辑和删除按钮禁用。
9. 点击删除：考试被移除，列表刷新。

- [ ] **Step 4: Commit（如需要修复）**

```bash
git add .
git commit -m "fix(exam-manager): address integration issues"
```

---

## 自我审查

- **Spec coverage:**
  - 14 列完整覆盖 — Task 3
  - 后端扩展 — Task 1
  - 类型更新 — Task 2
  - 时间场次格式 — Task 3 Step 4
  - 考场编码摘要 — Task 3 Step 4
  - 考生数量统计 — Task 3 Step 4
  - 删除按钮 — Task 3 Step 4
  - 状态保持标签 — Task 3 Step 4
- **Placeholder scan:** 无 TBD/TODO/“实现 later” 等占位符。
- **Type consistency:** `batch`、`rooms` 字段在 Task 2 中定义，Task 3 中直接使用；`dayjs` 函数命名统一。
