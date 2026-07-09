# 考场管理「资源+预约」模式改造设计文档

> 日期: 2026-06-21
> 状态: 待审批
> 影响范围: Schema / 后端路由 / 前端页面

---

## 1. 背景与问题

### 1.1 当前设计

当前 `ExamRoom` 模型通过 `examId` 字段与考试 **1:1 绑定**：

```prisma
model ExamRoom {
  id       String          @id @default(uuid())
  code     String          @unique     // A101
  name     String                      // 第一机房
  capacity Int                         // 50
  status   ExamRoomStatus  @default(available)
  examId   String                      // ⚠️ 直接绑定一场考试
  exam     Exam            @relation(...)
}
```

### 1.2 存在的问题

| # | 问题 | 影响 |
|---|------|------|
| 1 | **1:1 绑定**：一个考场记录只能服务一场考试 | 考试A结束后考场M无法被考试B复用 |
| 2 | **无时间维度**：没有 startTime/endTime | 无法判断时间段是否冲突 |
| 3 | **无冲突检测**：分配时未检查是否已被占用 | 可能出现同一考场同时被两场考试使用 |
| 4 | **状态不流转**：考试结束后 occupied 不会自动变回 available | 需要手动管理，容易遗漏 |
| 5 | **冗余字段**：status 的 occupied 与 examId !== null 表达相同语义 | 数据不一致风险 |

### 1.3 改造目标

将考场管理从「每场考试创建独立考场」改为**「资源池 + 时段预约」」模式：
- 考场是物理资源，独立于考试存在
- 考试对考场的占用是「预约时段」
- 自动检测时间冲突，防止重复分配
- 考试结束后自动释放资源

---

## 2. 数据库 Schema 设计

### 2.1 ExamRoom（纯物理资源池）

```prisma
model ExamRoom {
  id        String          @id @default(uuid()) @db.Uuid
  code      String          @unique @db.VarChar(64)    // 考场编码（唯一）
  name      String          @db.VarChar(128)           // 考场名称
  capacity  Int                                      // 容纳人数上限
  location  String?         @db.VarChar(256)          // 物理位置描述
  equipment Json            @default("[]")             // 设备列表
  status    ExamRoomStatus  @default(available)        // available | maintenance
  // ❌ 删除: examId String — 不再直接绑定考试
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")

  // Relations
  assignments  ExamRoomAssignment[]     @relation("ExamRoomAssignments")  // 预约记录
  invigilators User[]                   @relation("RoomInvigilators")       // 全局监考池(保留)

  @@index([status])
  @@map("exam_rooms")
}

enum ExamRoomStatus {
  available   // 可用
  maintenance // 维护中（管理员手动切换）
  // ❌ 删除: occupied — 使用中状态由 Assignment.status 表达
}
```

**变化说明：**
- 删除 `examId` 字段 → 考场变为纯物理资源
- 删除 `occupied` 状态值 → 「使用中」由 Assignment 表表达
- 保留 `invigilators` 关系 → 可预置默认监考老师池

### 2.2 ExamRoomAssignment（新增：预约关联表）

```prisma
model ExamRoomAssignment {
  id        String            @id @default(uuid()) @db.Uuid
  examId    String            @map("exam_id") @db.Uuid
  roomId    String            @map("room_id") @db.Uuid
  status    AssignmentStatus  @default(scheduled)
  createdAt DateTime          @default(now())
  createdAt DateTime          @map("created_at")
  updatedAt DateTime          @updatedAt @map("updated_at")

  // Relations
  exam        Exam                @relation("ExamRoomAssignments", fields: [examId], references: [id], onDelete: Cascade)
  room        ExamRoom            @relation("ExamRoomAssignments", fields: [roomId], references: [id], onDelete: Cascade)
  students    ExamRoomStudent[]                           // 座位分配
  invigilators User[]              @relation("AssignmentInvigilators")  // 该场次监考

  @@unique([examId, roomId])         // 同一考试不能重复预约同一考场
  @@index([roomId, status])          // 按考场查占用情况（冲突检测用）
  @@index([examId, status])          // 按考试查分配情况
  @@map("exam_room_assignments")
}

enum AssignmentStatus {
  scheduled     // 已预约（考试未开始）
  in_progress   // 进行中（考试进行中）
  completed     // 已完成（考试结束，自动释放）
  cancelled     // 已取消（手动取消或删除考试时级联）
}
```

**核心设计决策：**
- 时间信息从 `Exam.startTime/endTime` 获取，不在 Assignment 中重复存储
- `@@unique([examId, roomId])` 保证数据一致性
- 级联删除：考试删除 → Assignment 删除 → 学生座位自动清理

### 2.3 ExamRoomStudent（改挂 Assignment）

```prisma
model ExamRoomStudent {
  id            String @id @default(uuid()) @db.Uuid
  assignmentId  String @map("assignment_id") @db.Uuid   // ← 原 roomId
  studentId     String @map("student_id") @db.Uuid
  seatNumber    Int    @map("seat_number")
  assignedAt    DateTime @default(now()) @map("assigned_at")

  // Relations
  assignment    ExamRoomAssignment @relation(fields: [assignmentId], references: [id])
  student       User                @relation(fields: [studentId], references: [id])

  @@unique([assignmentId, studentId])   // ← 原 [roomId, studentId]
  @@unique([assignmentId, seatNumber])  // ← 原 [roomId, seatNumber]
  @@map("exam_room_students")
}
```

**变化说明：**
- `roomId` → `assignmentId`：学生属于某次预约而非某个物理考场
- 唯一约束跟随变化

### 2.4 ER 关系图

```
Exam (考试)
  │
  ├── 1:N ──→ ExamRoomAssignment (预约记录)
  │              │
  │              ├── N:1 ──→ ExamRoom (物理考场/资源池)
  │              │
  │              ├── 1:N ──→ ExamRoomStudent (座位分配)
  │              │
  │              └── 1:N ──→ User (监考老师)
  │
  └── ... 其他现有关系不变
```

---

## 3. 后端 API 设计

### 3.1 `/api/rooms` — 考场资源池 CRUD

| 方法 | 路径 | 功能 | 变化 |
|------|------|------|------|
| GET | `/rooms` | 获取考场列表 | 去掉 `examId` 筛选；新增 `availableForExam` 参数 |
| GET | `/rooms/:id` | 获取考场详情 | 返回该考场的所有预约历史 |
| POST | `/rooms` | 创建考场 | **不再需要 examId** |
| PUT | `/rooms/:id` | 更新考场 | 只允许编辑物理属性 |
| DELETE | `/rooms/:id` | 删除考场 | 检查是否有 active Assignment |
| GET | `/rooms/export-template` | 导出模板 | 去掉 examId 相关说明 |

#### GET /rooms 新增参数

```
?status=available                    // 按物理状态筛选
&availableForExam={examId}          // 查询对指定考试可用的考场（排除时间冲突的）
```

`availableForExam` 实现逻辑：
1. 获取目标考试的 startTime、endTime
2. 查询每个考场的 active 预约（status ∈ scheduled, in_progress）
3. 过滤出无时间重叠的考场
4. 返回可用考场列表 + 每个考场的「被谁占用」提示

#### 冲突检测 SQL

```sql
-- 检查 roomId 在 [examStart, examEnd] 是否有重叠预约
SELECT COUNT(*) FROM exam_room_assignments
WHERE room_id = $roomId
  AND id != $excludeAssignmentId     -- 排除自身（编辑场景）
  AND status IN ('scheduled', 'in_progress')
  AND exam_id IN (
    SELECT id FROM exams
    WHERE (
      (start_time < $examEnd AND end_time > $examStart)
    )
  );
```

### 3.2 `/api/exam-room-assignments` — 预约管理（新接口）

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/exams/:examId/rooms` | 为考试分配考场（含冲突检测） |
| GET | `/exams/:examId/rooms` | 查询某考试已分配的考场 |
| PUT | `/exams/:examId/rooms/:roomId` | 更新预约备注等 |
| DELETE | `/exams/:examId/rooms/:roomId` | 取消考场分配 |

#### POST /exams/:examId/rooms 核心逻辑

```typescript
async function assignRoomToExam(examId: string, roomId: string) {
  // 1. 验证考试和考场存在
  const [exam, room] = await Promise.all([
    prisma.exam.findUnique({ where: { id: examId } }),
    prisma.examRoom.findUnique({ where: { id: roomId } }),
  ]);

  // 2. 检查考场物理状态
  if (room.status === 'maintenance') {
    throw new Error('该考场正在维护中');
  }

  // 3. 时间冲突检测
  const conflicts = await prisma.examRoomAssignment.findMany({
    where: {
      roomId,
      status: { in: ['scheduled', 'in_progress'] },
      exam: {  // 通过关联查询检查时间重叠
        startTime: { lt: exam.endTime },
        endTime:   { gt: exam.startTime },
      },
    },
  });

  if (conflicts.length > 0) {
    const conflictExamIds = conflicts.map(c => c.examId);
    const conflictExams = await prisma.exam.findMany({
      where: { id: { in: conflictExamIds } },
      select: { id: true, title: true, startTime: true, endTime: true },
    });
    throw new Error(
      `时间冲突！该考场已被以下考试占用:\n` +
      conflictExams.map(e => `- ${e.title} (${e.startTime} ~ ${e.endTime})`).join('\n')
    );
  }

  // 4. 创建预约记录
  return prisma.examRoomAssignment.create({
    data: { examId, roomId, status: 'scheduled' },
  });
}
```

### 3.3 学生分配接口迁移

原接口 → 新接口映射：

| 原接口 | 新接口 | 说明 |
|--------|--------|------|
| `POST /rooms/:roomId/students/batch-assign` | `POST /exams/:examId/rooms/:roomId/students/batch-assign` | 增加 examId 维度 |
| `DELETE /rooms/:roomId/students/:studentId` | `DELETE /exams/:examId/rooms/:roomId/students/:studentId` | 同上 |

容量检查基于 Assignment 关联的 Room.capacity。

### 3.4 监考老师接口迁移

| 原接口 | 新接口 | 说明 |
|--------|--------|------|
| `POST /rooms/:roomId/invigilators/:userId` | `POST /exams/:examId/rooms/:roomId/invigilators/:userId` | 监考挂到 Assignment 下 |
| `DELETE /rooms/:roomId/invigilators/:userId` | `DELETE /exams/:examId/rooms/:roomId/invigilators/:userId` | 同上 |

---

## 4. 前端页面设计

### 4.1 考场管理页 (`RoomManager.tsx`) → 资源池视图

**去掉的内容：**
- 「所属考试」列（表格第3列）
- `examIdFilter` 筛选下拉框
- 创建/编辑弹窗中的「所属考试」选择器
- 批量导入中的「必须先选择所属考试」说明

**新增/修改的内容：**

| 区域 | 变化 |
|------|------|
| 统计卡片 | 总数 / 可用 / 维护中 / **已预约数**（显示当前有 active assignment 的考场数） |
| 表格列 | 「所属考试」→ **「当前预约」**：显示该考场当前被哪些考试占用及时间段 |
| 新增弹窗 | 只需填：编码、名称、容量、位置（不再需要选考试） |
| 详情弹窗 | 增加「预约历史」Tab：展示该考场的所有预约记录（考试名 + 时间段 + 状态） |

**「当前预约」列渲染示例：**
```
无预约                              → Tag "空闲" (green)
WPS实操测试 (09:00-11:00)          → Tag "已预约" (blue)
WPS实操测试 (09:00-11:00) 进行中    → Tag "使用中" (orange)
多场预约                             → 展开显示多行
```

### 4.2 考试配置向导 — 步骤变化

#### RoomInvigilationStep（考场安排步骤）

**之前：** 在此步骤内创建考场（传 examId）

**之后：**
1. 左侧：**可用考场列表**（调用 `GET /rooms?availableForExam=examId`）
2. 右侧：**已选考场**（调用 `POST /exams/:examId/rooms` 添加）
3. 每个已选考场下：分配监考老师（调用 Assignment 级联接口）
4. 冲突提示：如果某考场已被占用，列表中显示灰色 + 提示占用者

#### StudentAssignStep（学生分配步骤）

**变化：**
- 考场选择范围：从 `GET /rooms?examId=xxx` → `GET /exams/:examId/rooms`
- 分配学生接口：从 `/rooms/:roomId/students/batch-assign` → `/exams/:examId/rooms/:roomId/students/batch-assign`
- 其余交互逻辑基本不变

---

## 5. 数据迁移方案

### 5.1 迁移脚本逻辑

```sql
-- Step 1: 提取物理考场信息（去重按 code）
INSERT INTO exam_rooms_new (id, code, name, capacity, location, equipment, status, created_at, updated_at)
SELECT DISTINCT ON (code)
  gen_random_uuid(),
  code,
  name,
  capacity,
  location,
  equipment,
  'available',
  created_at,
  updated_at
FROM exam_rooms;

-- Step 2: 为每条旧的 examRoom 记录创建 Assignment
INSERT INTO exam_room_assignments (id, exam_id, room_id, status, created_at, updated_at)
SELECT
  gen_random_uuid(),
  old.exam_id,
  new.id,          -- 映射到新的 room_id
  'scheduled',
  old.created_at,
  old.updated_at
FROM exam_rooms old
JOIN exam_rooms_new new ON new.code = old.code;

-- Step 3: 更新 ExamRoomStudent 的 roomId → assignmentId
UPDATE exam_room_students ers
SET assignment_id = era.id
FROM exam_room_assignments era
JOIN exam_rooms old ON old.id = ers.room_id
WHERE era.exam_id = old.exam_id;
```

### 5.2 回滚策略

保留旧表 7 天后删除。如需回滚：
1. 从旧表恢复 `examRooms` 的 `examId` 字段
2. 删除新增的 `exam_room_assignments` 和更新后的 `exam_room_students`

---

## 6. 实施计划概要

### Phase 1: Schema + Migration
- [ ] 修改 schema.prisma（新增模型、修改现有模型）
- [ ] 运行 `npx prisma migrate dev`
- [ ] 编写并执行数据迁移脚本
- [ ] 验证数据完整性

### Phase 2: 后端 API
- [ ] 重构 `routes/rooms.ts`（去掉 examId 依赖）
- [ ] 新建 `routes/exam-room-assignments.ts`
- [ ] 实现冲突检测逻辑
- [ ] 迁移学生分配和监考接口
- [ ] 更新路由注册

### Phase 3: 前端页面
- [ ] 重构 `RoomManager.tsx`（资源池视图）
- [ ] 更新 `RoomInvigilationStep.tsx`（选择可用考场）
- [ ] 更新 `StudentAssignStep.tsx`（新接口对接）
- [ ] 更新类型定义

### Phase 4: 测试验证
- [ ] 创建物理考场池（不绑定考试）
- [ ] 为考试A分配考场M → 成功
- [ ] 尝试为考试B（同时间段）分配考场M → 应拒绝并提示冲突
- [ ] 为考试C（不同时间段）分配考场M → 应成功
- [ ] 结束考试A → 考场M自动释放
- [ ] 分配学生到考试A的考场M → 正常工作
- [ ] 删除考试 → 级联清理 Assignment + Student

---

## 7. 参考来源

- [铜陵学院考试抽签管理系统 - CSDN](https://blog.csdn.net/2301_81142448/article/details/152000406)
- [校无忧教室预约系统 - CSDN](https://blog.csdn.net/weixin_42584507/article/details/153882122)
- [考场管理和座位安排业务场景详解 - CSDN](https://blog.csdn.net/m0_62910542/article/details/150293981)
- [Digital Examination Seating Allocation System - SSC Journal](https://gr-journals.com/ssc/pdf/SSC_25206.pdf)
