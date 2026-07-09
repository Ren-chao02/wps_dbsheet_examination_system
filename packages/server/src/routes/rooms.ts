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
});

const roomUpdateSchema = roomCreateSchema.partial();

// 批量导入Schema（支持Excel格式数据）
const bulkImportSchema = z.object({
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
    const { page = '1', pageSize = '20', status, keyword, availableForExam } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
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
          invigilators: { select: { id: true, realName: true, username: true } },
          assignments: {
            select: { _count: { select: { students: true } } },
          },
        },
      }),
      prisma.examRoom.count({ where }),
    ]);

    // 将嵌套的 assignments._count.students 聚合为顶层的 _count.students
    const roomsWithCount = rooms.map((room) => ({
      ...room,
      _count: {
        students: (room as any).assignments.reduce(
          (sum: number, a: any) => sum + a._count.students, 0
        ),
      },
    }));

    // 如果指定了 availableForExam，则检查每个考场在该考试时间段是否有冲突的预约
    let result = roomsWithCount;
    if (availableForExam) {
      const exam = await prisma.exam.findUnique({
        where: { id: String(availableForExam) },
        select: { startTime: true, endTime: true },
      });
      if (exam && exam.startTime && exam.endTime) {
        result = await Promise.all(
          roomsWithCount.map(async (room) => {
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
      }
    }

    res.json({
      data: result,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    console.error('获取考场列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/rooms/:id - 获取考场详情（含关联预约、学生列表）
roomRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const room = await prisma.examRoom.findUnique({
      where: { id: req.params.id },
      include: {
        assignments: {
          include: {
            exam: { select: { id: true, title: true, startTime: true, endTime: true } },
            students: {
              include: {
                student: {
                  select: {
                    id: true,
                    realName: true,
                    username: true,
                    studentId: true,
                    classRoom: { select: { name: true, code: true } },
                  },
                },
              },
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

    // 将嵌套的 assignments[].students 展平到顶层
    const allStudents = room.assignments.flatMap((a: any) =>
      a.students.map((s: any) => ({
        studentId: s.studentId,
        seatNumber: s.seatNumber,
        student: s.student,
      }))
    );

    res.json({
      ...room,
      _count: { students: allStudents.length },
      students: allStudents,
    });
  } catch (error) {
    console.error('获取考场详情失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/rooms - 创建单个考场
roomRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = roomCreateSchema.parse(req.body);

    // 检查编码是否重复
    const existing = await prisma.examRoom.findUnique({ where: { code: data.code } });
    if (existing) {
      return res.status(400).json({ message: `考场编码 "${data.code}" 已存在` });
    }

    const room = await prisma.examRoom.create({ data });

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
    const { rooms } = bulkImportSchema.parse(req.body);

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
      data: rooms,
    });

    // 返回新创建的考场列表
    const newRooms = await prisma.examRoom.findMany({
      where: { code: { in: codes } },
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
      include: {
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
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '考场不存在' });
    }
    console.error('删除考场失败:', err);
    res.status(500).json({ message: '删除失败' });
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
