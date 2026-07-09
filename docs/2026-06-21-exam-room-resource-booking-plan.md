# 考场管理「资源+预约」模式改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将考场从「1:1 绑定考试」改为「资源池 + 时段预约」模式，支持冲突检测和时间复用

**Architecture:** 新增 `ExamRoomAssignment` 预约关联表，`ExamRoom` 去掉 `examId` 变为纯资源池，`ExamRoomStudent.roomId` 改为 `assignmentId`。后端新增预约管理路由，前端考场管理页改为资源池视图，考试向导中改为选择可用考场。

**Tech Stack:** Prisma ORM / Express / React + Ant Design

---

## 文件映射

### 新增文件
| 文件 | 职责 |
|------|------|
| `server/src/routes/exam-room-assignments.ts` | 预约管理路由（分配/取消/查询/冲突检测） |

### 修改文件
| 文件 | 职责 |
|------|------|
| `server/prisma/schema.prisma` | 修改 ExamRoom、ExamRoomStudent、ExamRoomStatus；新增 ExamRoomAssignment、AssignmentStatus |
| `server/src/routes/rooms.ts` | 去掉 examId 依赖，简化 CRUD，新增 availableForExam 查询参数 |
| `server/src/app.ts` | 注册新路由 exam-room-assignments |
| `client/src/pages/teacher/RoomManager.tsx` | 去掉「所属考试」列和筛选，改为资源池视图 |
| `client/src/pages/teacher/ExamConfigWizard/RoomInvigilationStep.tsx` | 从「创建考场」改为「选择可用考场」 |
| `client/src/pages/teacher/ExamConfigWizard/StudentAssignStep.tsx` | 接口迁移到 `/exams/:examId/rooms/:roomId/...` |

### 删除文件
无

---

### Task 1: 数据库 Schema 改造

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 修改 ExamRoomStatus 枚举和 ExamRoom 模型**

```
# 删掉 occupied，保留 available / maintenance
enum ExamRoomStatus {
  available   
  maintenance 
}

model ExamRoom {
  id        String          @id @default(uuid()) @db.Uuid
  code      String          @unique @db.VarChar(64)
  name      String          @db.VarChar(128)
  capacity  Int
  location  String?         @db.VarChar(256)
  equipment Json            @default("[]")
  status    ExamRoomStatus  @default(available)
  // ❌ 删除: examId String @map("exam_id") @db.Uuid
  // ❌ 删除: exam Exam @relation("ExamRooms", fields: [examId], references: [id], onDelete: Cascade)
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")

  // Relations
  assignments  ExamRoomAssignment[]    @relation("ExamRoomAssignments")
  invigilators User[]                  @relation("RoomInvigilators")

  @@index([status])
  @@map("exam_rooms")
}
```

- [ ] **Step 2: 新增 AssignmentStatus 枚举和 ExamRoomAssignment 模型**

在 `schema.prisma` 的枚举区域添加：
```prisma
enum AssignmentStatus {
  scheduled     
  in_progress   
  completed     
  cancelled     
}
```

在 `ExamRoom` 模型之后添加新模型：
```prisma
model ExamRoomAssignment {
  id        String            @id @default(uuid()) @db.Uuid
  examId    String            @map("exam_id") @db.Uuid
  roomId    String            @map("room_id") @db.Uuid
  status    AssignmentStatus  @default(scheduled)
  createdAt DateTime          @default(now()) @map("created_at")
  updatedAt DateTime          @updatedAt @map("updated_at")

  // Relations
  exam        Exam                @relation("ExamRoomAssignments", fields: [examId], references: [id], onDelete: Cascade)
  room        ExamRoom            @relation("ExamRoomAssignments", fields: [roomId], references: [id])
  students    ExamRoomStudent[]
  invigilators User[]              @relation("AssignmentInvigilators")

  @@unique([examId, roomId])
  @@index([roomId, status])
  @@index([examId, status])
  @@map("exam_room_assignments")
}
```

- [ ] **Step 3: 修改 ExamRoomStudent 模型（roomId → assignmentId）**

```prisma
model ExamRoomStudent {
  id            String @id @default(uuid()) @db.Uuid
  assignmentId  String @map("assignment_id") @db.Uuid   // ← roomId 改为 assignmentId
  studentId     String @map("student_id") @db.Uuid
  seatNumber    Int    @map("seat_number")
  assignedAt    DateTime @default(now()) @map("assigned_at")

  // Relations
  assignment    ExamRoomAssignment @relation(fields: [assignmentId], references: [id])
  student       User                @relation(fields: [studentId], references: [id])

  @@unique([assignmentId, studentId])
  @@unique([assignmentId, seatNumber])
  @@map("exam_room_students")
}
```

- [ ] **Step 4: 删除 Exam 对 ExamRoom 的旧关联引用**

找到 `Exam` 模型中的 `rooms` 关联，将其删除或注释掉：
```prisma
// ❌ 删除: rooms ExamRoom[] @relation("ExamRooms")
// ✅ 新增: 通过 ExamRoomAssignment 间接关联
assignments ExamRoomAssignment[] @relation("ExamRoomAssignments")
```

- [ ] **Step 5: 生成 Prisma 迁移**

Run:
```bash
cd packages/server
npx prisma migrate dev --name exam-room-resource-booking
```

Run:
```bash
npx prisma generate
```

Expected: 迁移成功无报错。

---

### Task 2: 数据迁移脚本

**Files:**
- Create: `server/prisma/scripts/migrate-rooms.ts`
- Modify: 无

- [ ] **Step 1: 创建数据迁移脚本**

```typescript
// packages/server/prisma/scripts/migrate-rooms.ts
// 将现有 examRooms（带 examId）迁移为新结构：物理考场去重 + 创建 Assignment
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== 考场数据迁移开始 ===');

  // 1. 获取所有旧考场
  const oldRooms = await prisma.$queryRawUnsafe<Array<{
    id: string; code: string; name: string; capacity: number;
    location: string | null; equipment: any; status: string;
    exam_id: string; created_at: Date; updated_at: Date;
  }>>('SELECT * FROM exam_rooms');

  console.log(`找到 ${oldRooms.length} 条旧考场记录`);

  // 2. 按 code 去重创建新考场
  const seenCodes = new Set<string>();
  let createdCount = 0;

  for (const old of oldRooms) {
    if (seenCodes.has(old.code)) continue;
    seenCodes.add(old.code);

    await prisma.$executeRawUnsafe(
      `INSERT INTO exam_rooms (id, code, name, capacity, location, equipment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'available', $7, $8)`,
      old.id, old.code, old.name, old.capacity,
      old.location, JSON.stringify(old.equipment || []),
      old.created_at, old.updated_at
    );
    createdCount++;
  }
  console.log(`创建了 ${createdCount} 个物理考场（去重后）`);

  // 3. 为每条旧记录创建 Assignment（跳过 exam_id 为 null 的）
  let assignCount = 0;
  for (const old of oldRooms) {
    if (!old.exam_id) continue;

    // 检查是否已存在该考试的该考场分配
    const exist = await prisma.$queryRawUnsafe<Array<{id: string}>>(
      `SELECT id FROM exam_room_assignments WHERE exam_id = $1 AND room_id = $2`,
      old.exam_id, old.id
    );
    if (exist.length > 0) continue;

    await prisma.$executeRawUnsafe(
      `INSERT INTO exam_room_assignments (id, exam_id, room_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'scheduled', $4, $5)`,
      old.id + '-a', old.exam_id, old.id, old.created_at, old.updated_at
    );
    assignCount++;
  }
  console.log(`创建了 ${assignCount} 条预约记录`);

  // 4. 更新 ExamRoomStudent 的 room_id → assignment_id
  const updateResult = await prisma.$executeRawUnsafe(`
    UPDATE exam_room_students ers
    SET assignment_id = era.id
    FROM exam_room_assignments era
    WHERE era.room_id = ers.room_id
      AND ers.assignment_id IS NULL
  `);
  console.log(`更新了 ${updateResult} 条学生分配记录`);

  console.log('=== 考场数据迁移完成 ===');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 先给 exam_room_students 表添加 assignment_id 列（可为空，等迁移后设为 NOT NULL）**

```sql
ALTER TABLE exam_room_students ADD COLUMN IF NOT EXISTS assignment_id uuid;
```

- [ ] **Step 3: 执行迁移脚本**

Run:
```bash
cd packages/server
npx ts-node prisma/scripts/migrate-rooms.ts
```

Expected: 无报错，输出创建了多少考场/预约/更新了多少学生分配。

- [ ] **Step 4: 添加 NOT NULL 约束并删除旧列**

```sql
ALTER TABLE exam_room_students ALTER COLUMN assignment_id SET NOT NULL;
ALTER TABLE exam_rooms DROP COLUMN IF EXISTS exam_id;
ALTER TABLE exam_room_students DROP COLUMN IF EXISTS room_id;
```

- [ ] **Step 5: 验证数据完整性**

Run:
```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function check() {
  const rooms = await p.examRoom.count();
  const assignments = await p.examRoomAssignment.count();
  const students = await p.examRoomStudent.count();
  console.log({ rooms, assignments, students });
  await p.\$disconnect();
}
check();
"
```

Expected: rooms > 0，assignments 和 students 数据合理。

---

### Task 3: 后端重构 — 考场资源池 CRUD (`routes/rooms.ts`)

**Files:**
- Modify: `server/src/routes/rooms.ts`

- [ ] **Step 1: 去掉 Zod Schema 中的 examId 依赖**

```typescript
const roomCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  capacity: z.number().int().positive(),
  location: z.string().max(256).optional(),
  equipment: z.array(z.any()).default([]),
  // ❌ 删除: examId: z.string().uuid(),
});

const roomUpdateSchema = roomCreateSchema.partial();

// ❌ 删除: roomUpdateSchema 中的 omit({ examId: true })
```

- [ ] **Step 2: 重构 POST /rooms（去掉 examId 校验）**

```typescript
roomRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = roomCreateSchema.parse(req.body);
    // ❌ 删除: 验证考试是否存在
    // ❌ 删除: data.examId 相关逻辑
    // ... 保留编码唯一校验和创建逻辑
    const existing = await prisma.examRoom.findUnique({ where: { code: data.code } });
    if (existing) {
      return res.status(400).json({ message: `考场编码 "${data.code}" 已存在` });
    }
    const room = await prisma.examRoom.create({
      data,
      include: { _count: { select: { students: true } } },
    });
    res.status(201).json(room);
  } catch (err: any) { /* 保留错误处理 */ }
});
```

- [ ] **Step 3: 重构 POST /rooms/bulk-import（去掉 examId）**

```typescript
const bulkImportSchema = z.object({
  // ❌ 删除: examId: z.string().uuid(),
  rooms: z.array(z.object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(128),
    capacity: z.number().int().positive(),
    location: z.string().max(256).optional(),
  })).min(1).max(100),
});
```

去掉 `// 验证考试是否存在` 的代码块；创建时去掉 `examId`。

- [ ] **Step 4: 重构 GET /rooms — 新增 availableForExam 查询**

```typescript
roomRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', status, keyword, availableForExam } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    // ❌ 删除: if (examId) where.examId = String(examId);
    if (status) where.status = String(status);
    if (keyword) {
      where.OR = [
        { code: { contains: String(keyword), mode: 'insensitive' } },
        { name: { contains: String(keyword), mode: 'insensitive' } },
        { location: { contains: String(keyword), mode: 'insensitive' } },
      ];
    }

    let rooms = await prisma.examRoom.findMany({
      where,
      skip,
      take,
      orderBy: { code: 'asc' },
      include: {
        invigilators: { select: { id: true, realName: true, username: true } },
      },
    });

    // 如果指定了 availableForExam，过滤出可用考场（含冲突详情）
    if (availableForExam) {
      const exam = await prisma.exam.findUnique({
        where: { id: String(availableForExam) },
        select: { startTime: true, endTime: true },
      });
      if (exam && exam.startTime && exam.endTime) {
        const roomsWithConflicts = await Promise.all(
          rooms.map(async (room) => {
            const conflicts = await prisma.examRoomAssignment.findMany({
              where: {
                roomId: room.id,
                status: { in: ['scheduled', 'in_progress'] },
                exam: {
                  startTime: { lt: exam.endTime! },
                  endTime: { gt: exam.startTime! },
                },
              },
              include: {
                exam: { select: { id: true, title: true, startTime: true, endTime: true } },
              },
            });
            return { ...room, conflicts };
          })
        );
        // 只返回有时间冲突的考场（方便前端展示）或全部（前端根据 conflicts 长度判断）
        rooms = roomsWithConflicts as any;
      }
    }

    const total = await prisma.examRoom.count({ where });

    // ❌ 删除: include 中的 exam 和 _count.students
    res.json({ data: rooms, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error('获取考场列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 5: 重构 GET /rooms/:id — 去掉 exam 关联，改为 assignments 关联**

```typescript
roomRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const room = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: {
        // ❌ 删除: exam: { ... }
        // ✅ 新增: 显示预约历史
        assignments: {
          include: {
            exam: { select: { id: true, title: true, startTime: true, endTime: true } },
            students: {
              include: {
                student: {
                  select: {
                    id: true, username: true, realName: true,
                    studentId: true,
                    classRoom: { select: { name: true, code: true } },
                  },
                },
              },
              orderBy: { seatNumber: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        invigilators: {
          select: { id: true, realName: true, username: true, email: true },
        },
      },
    });

    if (!room) {
      return res.status(404).json({ message: '考场不存在' });
    }

    res.json(room);
  } catch (error) {
    console.error('获取考场详情失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 6: 删除不再使用的接口（批量分配学生、移除学生、分配监考、移除监考）**

删除以下路由处理器（它们已迁移到 exam-room-assignments 路由）：
- `POST /rooms/:id/students/batch-assign`
- `DELETE /rooms/:id/students/:studentId`
- `POST /rooms/:id/invigilators/:userId`
- `DELETE /rooms/:id/invigilators/:userId`

保留 PUT /rooms/:id（只修改物理属性）和 DELETE /rooms/:id（增加 active assignment 检查）。

```typescript
roomRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: {
        // ✅ 新增：检查是否有 active 的预约
        assignments: {
          where: { status: { in: ['scheduled', 'in_progress'] } },
          select: { id: true },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: '考场不存在' });
    }
    if (existing.assignments.length > 0) {
      return res.status(400).json({
        message: '该考场有正在进行的预约，无法删除。请先取消预约后再删除',
      });
    }

    await prisma.examRoom.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) { /* 保留错误处理 */ }
});
```

- [ ] **Step 7: TypeScript 编译验证**

Run:
```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -20
```

Expected: 编译通过。

---

### Task 4: 后端新增 — 预约管理路由 (`exam-room-assignments.ts`)

**Files:**
- Create: `server/src/routes/exam-room-assignments.ts`

- [ ] **Step 1: 创建文件骨架**

```typescript
// packages/server/src/routes/exam-room-assignments.ts
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const examRoomAssignmentRouter = Router();
examRoomAssignmentRouter.use(authenticate);
examRoomAssignmentRouter.use(authorize('teacher', 'admin'));
```

- [ ] **Step 2: 实现 POST /exams/:examId/rooms（分配考场，含冲突检测）**

```typescript
const assignSchema = z.object({
  roomId: z.string().uuid(),
});

// POST /api/exam-room-assignments/exams/:examId/rooms
examRoomAssignmentRouter.post('/exams/:examId/rooms', async (req: Request, res: Response) => {
  try {
    const { roomId } = assignSchema.parse(req.body);
    const examId = req.params.examId;

    // 1. 验证考试和考场存在
    const [exam, room] = await Promise.all([
      prisma.exam.findUnique({ where: { id: examId }, select: { id: true, title: true, startTime: true, endTime: true } }),
      prisma.examRoom.findUnique({ where: { id: roomId } }),
    ]);
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (!room) return res.status(404).json({ message: '考场不存在' });

    // 2. 检查考场物理状态
    if (room.status === 'maintenance') {
      return res.status(400).json({ message: '该考场正在维护中，无法分配' });
    }

    // 3. 检查是否已分配
    const existing = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
    });
    if (existing) {
      return res.status(400).json({ message: '该考场已分配给此考试，请勿重复分配' });
    }

    // 4. 时间冲突检测
    if (exam.startTime && exam.endTime) {
      const conflicts = await prisma.examRoomAssignment.findMany({
        where: {
          roomId,
          status: { in: ['scheduled', 'in_progress'] },
          exam: {
            startTime: { lt: exam.endTime },
            endTime: { gt: exam.startTime },
          },
        },
        include: {
          exam: { select: { id: true, title: true, startTime: true, endTime: true } },
        },
      });

      if (conflicts.length > 0) {
        const details = conflicts.map(c =>
          `${c.exam.title} (${c.exam.startTime?.toISOString()} ~ ${c.exam.endTime?.toISOString()})`
        ).join('\n');
        return res.status(409).json({
          message: `时间冲突！该考场已被以下考试占用:\n${details}`,
          conflicts: conflicts.map(c => ({
            examId: c.examId,
            examTitle: c.exam.title,
            startTime: c.exam.startTime,
            endTime: c.exam.endTime,
          })),
        });
      }
    }

    // 5. 创建预约记录
    const assignment = await prisma.examRoomAssignment.create({
      data: { examId, roomId, status: 'scheduled' },
      include: {
        exam: { select: { id: true, title: true, startTime: true, endTime: true } },
        room: { select: { id: true, code: true, name: true, capacity: true } },
      },
    });

    res.status(201).json(assignment);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('分配考场失败:', err);
    res.status(500).json({ message: '分配失败' });
  }
});
```

- [ ] **Step 3: 实现 GET /exams/:examId/rooms（查询某考试已分配的考场）**

```typescript
examRoomAssignmentRouter.get('/exams/:examId/rooms', async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId;
    const assignments = await prisma.examRoomAssignment.findMany({
      where: { examId },
      include: {
        room: {
          include: {
            _count: { select: { students: true } },
          },
        },
        students: {
          include: {
            student: { select: { id: true, realName: true, studentId: true } },
          },
          orderBy: { seatNumber: 'asc' },
        },
        invigilators: { select: { id: true, realName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ data: assignments });
  } catch (error) {
    console.error('获取考试考场列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 4: 实现 DELETE /exams/:examId/rooms/:roomId（取消分配）**

```typescript
examRoomAssignmentRouter.delete('/exams/:examId/rooms/:roomId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId } = req.params;
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      include: { _count: { select: { students: true } } },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    await prisma.examRoomAssignment.delete({
      where: { examId_roomId: { examId, roomId } },
    });

    res.json({ message: '取消分配成功' });
  } catch (error) {
    console.error('取消分配失败:', error);
    res.status(500).json({ message: '取消分配失败' });
  }
});
```

- [ ] **Step 5: 实现学生分配相关接口**

```typescript
const batchAssignSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1).max(50),
});

// POST /api/exam-room-assignments/exams/:examId/rooms/:roomId/students/batch-assign
examRoomAssignmentRouter.post('/exams/:examId/rooms/:roomId/students/batch-assign', async (req: Request, res: Response) => {
  try {
    const { studentIds } = batchAssignSchema.parse(req.body);
    const { examId, roomId } = req.params;

    // 找到 assignment
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      include: {
        room: { select: { capacity: true } },
        _count: { select: { students: true } },
        students: { select: { studentId: true } },
      },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    // 容量检查
    const currentCount = assignment._count.students;
    const availableCapacity = assignment.room.capacity - currentCount;
    if (studentIds.length > availableCapacity) {
      return res.status(400).json({
        message: `考场容量不足，剩余座位: ${availableCapacity}`,
        available: availableCapacity,
      });
    }

    // 检查是否已在分配中
    const existingIds = assignment.students.map(s => s.studentId);
    const newStudents = studentIds.filter(id => !existingIds.includes(id));
    if (newStudents.length === 0) {
      return res.status(400).json({ message: '所有选中的学生已经在该考场中' });
    }

    // 计算起始座位号
    const startSeatNumber = currentCount + 1;

    await prisma.examRoomStudent.createMany({
      data: newStudents.map((studentId, index) => ({
        assignmentId: assignment.id,
        studentId,
        seatNumber: startSeatNumber + index,
      })),
    });

    res.status(201).json({
      message: `成功分配 ${newStudents.length} 名学生`,
      assignedCount: newStudents.length,
      skippedCount: existingIds.length,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('批量分配学生失败:', err);
    res.status(500).json({ message: '分配失败' });
  }
});

// DELETE /api/exam-room-assignments/exams/:examId/rooms/:roomId/students/:studentId
examRoomAssignmentRouter.delete('/exams/:examId/rooms/:roomId/students/:studentId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId, studentId } = req.params;
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      select: { id: true },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    await prisma.examRoomStudent.delete({
      where: {
        assignmentId_studentId: {
          assignmentId: assignment.id,
          studentId,
        },
      },
    });

    res.json({ message: '移除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '该学生未在此考场中' });
    }
    console.error('移除学生失败:', err);
    res.status(500).json({ message: '移除失败' });
  }
});
```

- [ ] **Step 6: 实现监考老师分配接口**

```typescript
// POST /api/exam-room-assignments/exams/:examId/rooms/:roomId/invigilators/:userId
examRoomAssignmentRouter.post('/exams/:examId/rooms/:roomId/invigilators/:userId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId, userId } = req.params;
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      include: { invigilators: { select: { id: true } } },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, realName: true },
    });
    if (!user || !['teacher', 'admin'].includes(user.role)) {
      return res.status(400).json({ message: '只能分配老师或管理员作为监考' });
    }
    if (assignment.invigilators.some(inv => inv.id === userId)) {
      return res.status(400).json({ message: `${user.realName} 已经是该考场的监考老师` });
    }

    const updated = await prisma.examRoomAssignment.update({
      where: { examId_roomId: { examId, roomId } },
      data: { invigilators: { connect: { id: userId } } },
      include: { invigilators: { select: { id: true, realName: true } } },
    });

    res.json({ message: `成功分配监考老师: ${user.realName}`, data: updated.invigilators });
  } catch (error) {
    console.error('分配监考失败:', error);
    res.status(500).json({ message: '分配失败' });
  }
});

// DELETE /api/exam-room-assignments/exams/:examId/rooms/:roomId/invigilators/:userId
examRoomAssignmentRouter.delete('/exams/:examId/rooms/:roomId/invigilators/:userId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId, userId } = req.params;
    const updated = await prisma.examRoomAssignment.update({
      where: { examId_roomId: { examId, roomId } },
      data: { invigilators: { disconnect: { id: userId } } },
      include: { invigilators: { select: { id: true, realName: true } } },
    });
    res.json({ message: '移除成功', data: updated.invigilators });
  } catch (error) {
    console.error('移除监考失败:', error);
    res.status(500).json({ message: '移除失败' });
  }
});
```

- [ ] **Step 7: 在 app.ts 注册新路由**

在 `app.ts` 中 `import { examRoomAssignmentRouter } from './routes/exam-room-assignments';`，并注册：
```typescript
app.use('/api/exam-room-assignments', examRoomAssignmentRouter);
```

- [ ] **Step 8: TypeScript 编译验证**

Run:
```bash
cd packages/server && npx tsc --noEmit 2>&1 | head -20
```

Expected: 编译通过。

---

### Task 5: 前端 — 考场管理页重构 (`RoomManager.tsx`)

**Files:**
- Modify: `client/src/pages/teacher/RoomManager.tsx`

- [ ] **Step 1: 去掉 ExamRoom 接口中的 exam 字段，改为 assignments 字段**

```typescript
interface ExamRoom {
  id: string;
  code: string;
  name: string;
  capacity: number;
  location?: string;
  equipment: any[];
  status: 'available' | 'maintenance';   // ← 去掉 'occupied'
  // ❌ 删除: examId: string;
  // ❌ 删除: exam: { id: string; title: string };
  conflicts?: Array<{                     // ← 可选，availableForExam 时返回
    examId: string;
    examTitle: string;
    startTime: string;
    endTime: string;
  }>;
  assignments?: Array<{                   // ← 可选，详情时返回
    id: string;
    exam: { id: string; title: string; startTime: string; endTime: string };
    status: string;
    students: Array<{ ... }>;
  }>;
  invigilators: Array<{ ... }>;
}
```

- [ ] **Step 2: 去掉 examIdFilter 和 fetchExams**

删除以下内容：
```typescript
// ❌ 删除:
// const [examIdFilter, setExamIdFilter] = useState<string>();
// const [examOptions, setExamOptions] = useState<...>([]);
// const fetchExams = async () => { ... };
// useEffect(() => { fetchExams(); }, []);
// useEffect(() => { fetchRooms(); }, [examIdFilter]);
```

- [ ] **Step 3: 简化 fetchRooms — 去掉 examId 筛选**

```typescript
const fetchRooms = async (page = 1, pageSize = 20) => {
  setLoading(true);
  try {
    const params: any = { page, pageSize };
    // ❌ 删除: if (examIdFilter) params.examId = examIdFilter;
    const res = await api.get('/rooms', { params });
    setRooms(res.data.data || []);
    setPagination({ current: res.data.page, pageSize: res.data.pageSize, total: res.data.total });
  } catch {
    message.error('加载失败');
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 4: 修改表格列定义 — 「所属考试」→「当前预约情况」**

```typescript
// ❌ 删除:
// {
//   title: '所属考试',
//   key: 'exam',
//   render: (_: any, record: ExamRoom) => <Tag color="blue">{record.exam.title}</Tag>,
// },

// ✅ 新增:
{
  title: '当前预约',
  key: 'currentAssignment',
  render: (_: any, record: ExamRoom) => {
    if (record.conflicts && record.conflicts.length > 0) {
      return (
        <Space direction="vertical" size={2}>
          {record.conflicts.map(c => (
            <Tag key={c.examId} color="orange">
              {c.examTitle}
            </Tag>
          ))}
        </Space>
      );
    }
    return <Tag color="green">空闲</Tag>;
  },
},
```

- [ ] **Step 5: 修改创建弹窗 — 去掉「所属考试」选择**

```typescript
// ❌ 删除:
// {!editingRoom && (
//   <Form.Item name="examId" label="所属考试" ...>
//     <Select>...</Select>
//   </Form.Item>
// )}
```

- [ ] **Step 6: 修改统计卡片**

```typescript
<Col span={6}>
  <Card>
    <Statistic
      title="维护中"
      value={rooms.filter(r => r.status === 'maintenance').length}
      valueStyle={{ color: '#ff4d4f' }}
    />
  </Card>
</Col>
```

- [ ] **Step 7: 修改状态列 — 去掉 occupied**

```typescript
const roomStatusConfig = {
  available: { color: 'success', text: '可用' },
  // ❌ 删除: occupied: { color: 'processing', text: '使用中' },
  maintenance: { color: 'error', text: '维护中' },
};
```

- [ ] **Step 8: TypeScript 编译验证**

Run:
```bash
cd packages/client && npx tsc --noEmit 2>&1 | head -20
```

Expected: 编译通过。

---

### Task 6: 前端 — 考试向导考场安排步骤 (`RoomInvigilationStep.tsx`)

**Files:**
- Modify: `client/src/pages/teacher/ExamConfigWizard/RoomInvigilationStep.tsx`

- [ ] **Step 1: 改为从资源池选择可用考场，而不是新建考场**

```typescript
export function RoomInvigilationStep({ exam, onSaved, onBack }: RoomInvigilationStepProps) {
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [assignedRooms, setAssignedRooms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [teachers, setTeachers] = useState<any[]>([]);

  const fetchAvailableRooms = async () => {
    setLoading(true);
    try {
      // 调用新接口：获取对该考试可用的考场
      const res = await api.get(`/rooms?availableForExam=${exam.id}&pageSize=100`);
      setAvailableRooms(res.data?.data || []);
    } catch {
      message.error('加载可用考场失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignedRooms = async () => {
    try {
      const res = await api.get(`/exam-room-assignments/exams/${exam.id}/rooms`);
      setAssignedRooms(res.data?.data || []);
    } catch {
      message.error('加载已分配考场失败');
    }
  };

  useEffect(() => {
    fetchAvailableRooms();
    fetchAssignedRooms();
    api.get('/users?role=teacher&pageSize=500')
      .then(res => setTeachers(res.data?.data || []))
      .catch(() => message.error('加载教师列表失败'));
  }, [exam.id]);
```

- [ ] **Step 2: 实现分配考场和取消分配**

```typescript
const handleAssignRoom = async (roomId: string) => {
  try {
    await api.post(`/exam-room-assignments/exams/${exam.id}/rooms`, { roomId });
    message.success('考场分配成功');
    fetchAvailableRooms();
    fetchAssignedRooms();
  } catch (err: any) {
    message.error(err.response?.data?.message || '分配失败');
  }
};

const handleRemoveRoom = async (roomId: string) => {
  try {
    await api.delete(`/exam-room-assignments/exams/${exam.id}/rooms/${roomId}`);
    message.success('取消分配成功');
    fetchAvailableRooms();
    fetchAssignedRooms();
  } catch (err: any) {
    message.error(err.response?.data?.message || '取消分配失败');
  }
};
```

- [ ] **Step 3: 修改表格渲染 — 分为可用和已选两列**

```typescript
// 可用考场列表（右侧选择区）
const availableColumns = [
  { title: '编码', dataIndex: 'code', width: 80 },
  { title: '名称', dataIndex: 'name' },
  { title: '容量', dataIndex: 'capacity', width: 60 },
  {
    title: '操作', width: 100,
    render: (_: any, r: Room) => (
      <Button type="primary" size="small" onClick={() => handleAssignRoom(r.id)}
        disabled={r.conflicts && r.conflicts.length > 0}>
        分配
      </Button>
    ),
  },
];

// 已选考场列表（左侧展示区）
const assignedColumns = [
  { title: '编码', dataIndex: ['room', 'code'], width: 80 },
  { title: '名称', dataIndex: ['room', 'name'] },
  { title: '容量', dataIndex: ['room', 'capacity'], width: 60 },
  {
    title: '监考老师',
    render: (_: any, a: any) => (
      <Space wrap>
        {a.invigilators?.map((i: any) => <span key={i.id}>{i.realName}</span>)}
        <Select
          placeholder="分配"
          style={{ width: 120 }}
          value={undefined}
          onChange={(tid) => tid && handleAssignInvigilator(a.room.id, tid)}
          options={teachers.map(t => ({ value: t.id, label: t.realName || t.username }))}
        />
      </Space>
    ),
  },
  {
    title: '操作', width: 80,
    render: (_: any, a: any) => (
      <Button size="small" danger onClick={() => handleRemoveRoom(a.room.id)}>移除</Button>
    ),
  },
];
```

- [ ] **Step 4: 去掉新增考场弹窗和相关代码**

删除以下内容：
```typescript
// ❌ 删除: const [isAddModalOpen, setIsAddModalOpen] = useState(false);
// ❌ 删除: const [addForm] = Form.useForm();
// ❌ 删除: const handleAddRoom = ... ;
// ❌ 删除: 新增考场的 Modal 组件
// ❌ 删除: 搜索输入框旁边的「新增考场」按钮
```

- [ ] **Step 5: TypeScript 编译验证**

Run:
```bash
cd packages/client && npx tsc --noEmit 2>&1 | head -20
```

Expected: 编译通过。

---

### Task 7: 前端 — 学生分配步骤 (`StudentAssignStep.tsx`)

**Files:**
- Modify: `client/src/pages/teacher/ExamConfigWizard/StudentAssignStep.tsx`

- [ ] **Step 1: 改为通过新接口获取考场**

```typescript
// ❌ 之前:
// api.get(`/rooms?examId=${exam.id}&pageSize=100`)

// ✅ 之后:
api.get(`/exam-room-assignments/exams/${exam.id}/rooms?pageSize=100`)
```

注意返回的数据结构变化：之前是 `{ id, code, name, capacity }`，现在是 `{ id, room: { id, code, name, capacity }, students: [...] }`。需要调整 Room 接口和映射。

- [ ] **Step 2: 修改 Room 接口**

```typescript
interface Room {
  id: string;           // assignment id
  room: {               // 物理考场信息
    id: string;
    code: string;
    name: string;
    capacity: number;
  };
  students: Array<{
    studentId: string;
    seatNumber: number;
    student: { id: string; realName: string | null };
  }>;
}
```

- [ ] **Step 3: 修改获取已分配学生逻辑**

```typescript
useEffect(() => {
  if (!selectedRoom) return;
  // 直接从 rooms 数据中提取已分配学生（新接口一次返回完整数据）
  const roomData = rooms.find(r => r.id === selectedRoom);
  if (roomData) {
    setAssignedMap(prev => ({
      ...prev,
      [selectedRoom]: roomData.students.map((s: any) => s.student.id),
    }));
  }
}, [selectedRoom, rooms]);
```

- [ ] **Step 4: 修改分配和移除接口**

```typescript
// 分配
await api.post(`/exam-room-assignments/exams/${exam.id}/rooms/${selectedRoom}/students/batch-assign`, { studentIds: [studentId] });

// 移除
await api.delete(`/exam-room-assignments/exams/${exam.id}/rooms/${selectedRoom}/students/${studentId}`);
```

- [ ] **Step 5: 修改 Select 选项映射**

```typescript
options={rooms.map(r => ({
  value: r.id,
  label: `${r.room.code} - ${r.room.name}`,
}))}
```

- [ ] **Step 6: TypeScript 编译验证**

Run:
```bash
cd packages/client && npx tsc --noEmit 2>&1 | head -20
```

Expected: 编译通过。

---

### Task 8: 考试状态流转 — 自动更新 Assignment 状态

**Files:**
- Modify: 无（控制在业务层面，考虑加入 exam 状态变更时的 hook）

- [ ] **Step 1: 在考试状态变更时级联更新 Assignment 状态**

在 `routes/exams.ts` 的考试状态更新逻辑中添加（或修改 `PUT /exams/:id/status`）：
```typescript
// 当考试状态改为 in_progress 时 → 对应 Assignment 改为 in_progress
// 当考试状态改为 ended 时 → 对应 Assignment 改为 completed
if (status === 'in_progress') {
  await prisma.examRoomAssignment.updateMany({
    where: { examId: req.params.id, status: 'scheduled' },
    data: { status: 'in_progress' },
  });
} else if (status === 'ended') {
  await prisma.examRoomAssignment.updateMany({
    where: { examId: req.params.id, status: 'in_progress' },
    data: { status: 'completed' },
  });
}
```

### Task 9: 端到端测试验证

- [ ] **Step 1: 启动前后端服务**

```bash
cd packages/server && npx ts-node src/index.ts
cd packages/client && npx vite
```

- [ ] **Step 2: 测试场景1 — 创建物理考场**

```
1. 打开考场管理页
2. 点击「新增考场」，填写编码 A101、名称「第一机房」、容量 50
3. 保存 → 列表中出现新考场，状态「可用」
4. 验证：不需要选择「所属考试」
```

- [ ] **Step 3: 测试场景2 — 分配考场给考试A**

```
1. 创建考试A（设定时间 09:00-11:00）
2. 在向导中选择考场A101 → 成功
3. 验证：考场管理页中该考场显示「已预约」
```

- [ ] **Step 4: 测试场景3 — 时间冲突检测**

```
1. 创建考试B（设定时间 10:00-12:00）
2. 尝试分配考场A101
3. 验证：应返回 409 冲突，提示被考试A占用
```

- [ ] **Step 5: 测试场景4 — 不同时段可复用**

```
1. 创建考试C（设定时间 14:00-16:00）
2. 分配考场A101
3. 验证：应成功（无时间重叠）
```

- [ ] **Step 6: 测试场景5 — 考试结束后自动释放**

```
1. 手动将考试A状态改为 ended
2. 验证：Assignment 状态变为 completed
3. 再为考试B分配考场A101 → 应成功
```
