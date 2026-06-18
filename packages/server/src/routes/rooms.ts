import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const roomRouter = Router();
roomRouter.use(authenticate);
roomRouter.use(authorize('teacher', 'admin'));

// ✅ Zod验证Schema
const roomCreateSchema = z.object({
  code: z.string().min(1).max(64), // 考场编码（唯一）
  name: z.string().min(1).max(128), // 考场名称
  capacity: z.number().int().positive(), // 容纳人数
  location: z.string().max(256).optional(), // 物理位置
  equipment: z.array(z.any()).default([]), // 设备列表
  examId: z.string().uuid(), // 所属考试ID
});

const roomUpdateSchema = roomCreateSchema.partial().omit({ examId: true }); // 不允许修改所属考试

// 批量导入Schema（支持Excel格式数据）
const bulkImportSchema = z.object({
  examId: z.string().uuid(),
  rooms: z.array(z.object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(128),
    capacity: z.number().int().positive(),
    location: z.string().max(256).optional(),
  })).min(1).max(100), // 单次最多导入100个考场
});

// GET /api/rooms - 获取考场列表（支持按考试筛选）
roomRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', examId, status, keyword } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (examId) where.examId = String(examId);
    if (status) where.status = String(status);
    if (keyword) {
      where.OR = [
        { code: { contains: String(keyword), mode: 'insensitive' } },
        { name: { contains: String(keyword), mode: 'insensitive' } },
        { location: { contains: String(keyword), mode: 'insensitive' } },
      ];
    }

    const [rooms, total] = await Promise.all([
      prisma.examRoom.findMany({
        where,
        skip,
        take,
        orderBy: { code: 'asc' },
        include: {
          exam: { select: { id: true, title: true } },
          invigilators: { select: { id: true, realName: true, username: true } },
          _count: { select: { students: true } }, // 已分配学生数
        },
      }),
      prisma.examRoom.count({ where }),
    ]);

    res.json({
      data: rooms,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    console.error('获取考场列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/rooms/:id - 获取考场详情（含已分配学生列表）
roomRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const room = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: {
        exam: {
          select: {
            id: true,
            title: true,
            mode: true,
            startTime: true,
            endTime: true,
          },
        },
        invigilators: {
          select: { id: true, realName: true, username: true, email: true },
        },
        students: {
          include: {
            student: {
              select: {
                id: true,
                username: true,
                realName: true,
                studentId: true,
                classRoom: { select: { name: true, code: true } },
              },
            },
          },
          orderBy: { seatNumber: 'asc' },
        },
        _count: { select: { students: true } },
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

// POST /api/rooms - 创建单个考场
roomRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = roomCreateSchema.parse(req.body);

    // 验证考试是否存在
    const exam = await prisma.exam.findUnique({ where: { id: data.examId } });
    if (!exam) {
      return res.status(400).json({ message: '指定的考试不存在' });
    }

    // 检查编码是否重复
    const existing = await prisma.examRoom.findUnique({ where: { code: data.code } });
    if (existing) {
      return res.status(400).json({ message: `考场编码 "${data.code}" 已存在` });
    }

    const room = await prisma.examRoom.create({
      data,
      include: {
        exam: { select: { id: true, title: true } },
        _count: { select: { students: true } },
      },
    });

    res.status(201).json(room);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('创建考场失败:', err);
    res.status(500).json({ message: '创建失败' });
  }
});

// POST /api/rooms/bulk-import - 批量导入考场（核心功能✨）
roomRouter.post('/bulk-import', async (req: Request, res: Response) => {
  try {
    const { examId, rooms } = bulkImportSchema.parse(req.body);

    // 验证考试是否存在
    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) {
      return res.status(400).json({ message: '指定的考试不存在' });
    }

    // 检查是否有重复的编码
    const codes = rooms.map(r => r.code);
    const uniqueCodes = new Set(codes);
    if (codes.length !== uniqueCodes.size) {
      return res.status(400).json({ message: '存在重复的考场编码' });
    }

    // 检查数据库中是否已存在这些编码
    const existingRooms = await prisma.examRoom.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });

    if (existingRooms.length > 0) {
      const duplicateCodes = existingRooms.map(r => r.code);
      return res.status(400).json({
        message: `以下考场编码已存在: ${duplicateCodes.join(', ')}`,
        duplicates: duplicateCodes,
      });
    }

    // 批量创建考场
    const createdRooms = await prisma.examRoom.createMany({
      data: rooms.map(room => ({
        ...room,
        examId,
      })),
    });

    // 返回新创建的考场列表
    const newRooms = await prisma.examRoom.findMany({
      where: { code: { in: codes } },
      include: {
        exam: { select: { id: true, title: true } },
      },
      orderBy: { code: 'asc' },
    });

    res.status(201).json({
      message: `成功导入 ${createdRooms.count} 个考场`,
      count: createdRooms.count,
      data: newRooms,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('批量导入考场失败:', err);
    res.status(500).json({ message: '批量导入失败' });
  }
});

// PUT /api/rooms/:id - 更新考场信息
roomRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.examRoom.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ message: '考场不存在' });
    }

    const data = roomUpdateSchema.parse(req.body);

    // 如果修改了编码，检查是否冲突
    if (data.code && data.code !== existing.code) {
      const duplicate = await prisma.examRoom.findUnique({ where: { code: data.code } });
      if (duplicate) {
        return res.status(400).json({ message: `考场编码 "${data.code}" 已被使用` });
      }
    }

    const updated = await prisma.examRoom.update({
      where: { id: req.params.id },
      data,
      include: {
        exam: { select: { id: true, title: true } },
        _count: { select: { students: true } },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('更新考场失败:', err);
    res.status(500).json({ message: '更新失败' });
  }
});

// DELETE /api/rooms/:id - 删除考场
roomRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { students: true } } },
    });

    if (!existing) {
      return res.status(404).json({ message: '考场不存在' });
    }
    if (existing._count.students > 0) {
      return res.status(400).json({
        message: `该考场已分配 ${existing._count.students} 名学生，请先移除学生后再删除`,
      });
    }

    await prisma.examRoom.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '考场不存在' });
    }
    console.error('删除考场失败:', err);
    res.status(500).json({ message: '删除失败' });
  }
});

// POST /api/rooms/:id/invigilators/:userId - 分配监考老师
roomRouter.post('/:id/invigilators/:userId', async (req: Request, res: Response) => {
  try {
    const room = await prisma.examRoom.findUnique({ where: { id: req.params.id } });
    if (!room) {
      return res.status(404).json({ message: '考场不存在' });
    }

    // 验证用户是否存在且是老师或管理员
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, role: true, realName: true },
    });

    if (!user || !['teacher', 'admin'].includes(user.role)) {
      return res.status(400).json({ message: '只能分配老师或管理员作为监考' });
    }

    // 检查是否已经分配过
    if (room.invigilators.some(inv => inv.id === req.params.userId)) {
      return res.status(400).json({ message: `${user.realName} 已经是该考场的监考老师` });
    }

    const updated = await prisma.examRoom.update({
      where: { id: req.params.id },
      data: {
        invigilators: { connect: { id: req.params.userId } },
      },
      include: {
        invigilators: { select: { id: true, realName: true, username: true } },
      },
    });

    res.json({
      message: `成功分配监考老师: ${user.realName}`,
      data: updated.invigilators,
    });
  } catch (error) {
    console.error('分配监考失败:', error);
    res.status(500).json({ message: '分配失败' });
  }
});

// DELETE /api/rooms/:id/invigilators/:userId - 移除监考老师
roomRouter.delete('/:id/invigilators/:userId', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.examRoom.update({
      where: { id: req.params.id },
      data: {
        invigilators: { disconnect: { id: req.params.userId } },
      },
      include: {
        invigilators: { select: { id: true, realName: true, username: true } },
      },
    });

    res.json({ message: '移除成功', data: updated.invigilators });
  } catch (error) {
    console.error('移除监考失败:', error);
    res.status(500).json({ message: '移除失败' });
  }
});

// POST /api/rooms/:id/students/batch-assign - 批量分配学生到考场（核心功能✨）
roomRouter.post('/:id/students/batch-assign', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      studentIds: z.array(z.string().uuid()).min(1).max(50), // 单次最多分配50人
    });

    const { studentIds } = schema.parse(req.body);

    const room = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { students: true } },
        students: { select: { studentId: true } },
      },
    });

    if (!room) {
      return res.status(404).json({ message: '考场不存在' });
    }

    // 检查容量是否足够
    const currentCount = room._count.students;
    const availableCapacity = room.capacity - currentCount;

    if (studentIds.length > availableCapacity) {
      return res.status(400).json({
        message: `考场容量不足，剩余座位: ${availableCapacity}，尝试分配: ${studentIds.length}`,
        available: availableCapacity,
        requested: studentIds.length,
      });
    }

    // 验证所有学生是否存在
    const students = await prisma.user.findMany({
      where: {
        id: { in: studentIds },
        role: 'student',
      },
      select: { id: true, realName: true, studentId: true },
    });

    if (students.length !== studentIds.length) {
      const foundIds = students.map(s => s.id);
      const missingIds = studentIds.filter(id => !foundIds.includes(id));
      return res.status(400).json({
        message: `以下学生ID不存在或不是学生角色: ${missingIds.join(', ')}`,
        missing: missingIds,
      });
    }

    // 检查是否已在其他考场或本考场
    const existingAssignments = await prisma.examRoomStudent.findMany({
      where: {
        roomId: req.params.id,
        studentId: { in: studentIds },
      },
      select: { studentId: true },
    });

    const alreadyAssigned = existingAssignments.map(a => a.studentId);
    const newStudents = studentIds.filter(id => !alreadyAssigned.includes(id));

    if (newStudents.length === 0) {
      return res.status(400).json({
        message: '所有选中的学生已经在该考场中',
        alreadyAssigned,
      });
    }

    // 计算起始座位号
    const startSeatNumber = currentCount + 1;

    // 批量创建座位分配
    const assignments = await prisma.examRoomStudent.createMany({
      data: newStudents.map((studentId, index) => ({
        roomId: req.params.id,
        studentId,
        seatNumber: startSeatNumber + index,
      })),
    });

    // 返回更新后的考场信息
    const updatedRoom = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: {
        students: {
          include: {
            student: {
              select: { id: true, realName: true, studentId: true },
            },
          },
          orderBy: { seatNumber: 'asc' },
        },
        _count: { select: { students: true } },
      },
    });

    res.status(201).json({
      message: `成功分配 ${assignments.count} 名学生到考场`,
      assignedCount: assignments.count,
      skippedCount: alreadyAssigned.length,
      data: updatedRoom?.students,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('批量分配学生失败:', err);
    res.status(500).json({ message: '分配失败' });
  }
});

// DELETE /api/rooms/:id/students/:studentId - 移除单个学生
roomRouter.delete('/:id/students/:studentId', async (req: Request, res: Response) => {
  try {
    await prisma.examRoomStudent.delete({
      where: {
        roomId_studentId: {
          roomId: req.params.id,
          studentId: req.params.studentId,
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

// GET /api/rooms/export-template - 导出考场导入模板（Excel格式说明）
roomRouter.get('/export-template', (_req: Request, res: Response) => {
  res.json({
    template: {
      columns: ['考场编码', '考场名称', '容量', '位置描述'],
      example: [
        ['A101', '第一机房', 50, '教学楼A座1楼'],
        ['A102', '第二机房', 45, '教学楼A座1楼'],
        ['B201', '第三机房', 60, '教学楼B座2楼'],
      ],
      rules: {
        '考场编码': '必填，唯一标识，如 A101、B203',
        '考场名称': '必填，如 第一机房、第二实验室',
        '容量': '必填，正整数，表示最大容纳人数',
        '位置描述': '可选，详细地址说明',
      },
      maxRows: 100,
      format: 'CSV / Excel (.xlsx)',
    },
  });
});
