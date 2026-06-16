import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const departmentRouter = Router();

// 所有路由都需要认证
departmentRouter.use(authenticate);

// ============ Zod Schemas ============

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const updateDepartmentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createMajorSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  description: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const updateMajorSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const createClassRoomSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  academicYear: z.string().min(4),
  gradeLevel: z.number().int().min(1).max(8).default(1),
});

const updateClassRoomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  academicYear: z.string().min(4).optional(),
  gradeLevel: z.number().int().min(1).max(8).optional(),
});

// ============ 院系 CRUD ============

// GET / — 获取院系列表（含专业和班级树形结构）
departmentRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        majors: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            classRooms: {
              orderBy: { createdAt: 'asc' },
              include: {
                _count: { select: { students: true } },
              },
            },
          },
        },
        _count: { select: { users: true } },
      },
    });

    res.json({ data: departments });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST / — 创建院系（admin only）
departmentRouter.post('/', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = createDepartmentSchema.parse(req.body);

    const existing = await prisma.department.findFirst({
      where: { OR: [{ name: data.name }, { code: data.code }] },
    });
    if (existing) {
      return res.status(409).json({ message: '院系名称或编码已存在' });
    }

    const department = await prisma.department.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    res.status(201).json(department);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /:id — 更新院系（admin only）
departmentRouter.put('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = updateDepartmentSchema.parse(req.body);

    // 检查唯一性冲突
    if (data.name || data.code) {
      const existing = await prisma.department.findFirst({
        where: {
          id: { not: req.params.id },
          OR: [
            ...(data.name ? [{ name: data.name }] : []),
            ...(data.code ? [{ code: data.code }] : []),
          ],
        },
      });
      if (existing) {
        return res.status(409).json({ message: '院系名称或编码已存在' });
      }
    }

    const department = await prisma.department.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.code !== undefined && { code: data.code }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });

    res.json(department);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '院系不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /:id — 删除院系（admin only，级联删除检查）
departmentRouter.delete('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { force } = req.query;
    const departmentId = req.params.id;

    // 检查院系是否存在
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        _count: { select: { users: true, majors: true } },
      },
    });

    if (!department) {
      return res.status(404).json({ message: '院系不存在' });
    }

    // 检查是否有用户关联到此院系
    const userCount = department._count.users;
    if (userCount > 0 && force !== 'true') {
      return res.status(409).json({
        message: `该院系下有 ${userCount} 名关联用户，无法删除。如需级联删除，请传递 force=true 参数`,
      });
    }

    // 检查专业下是否有学生（通过班级关联）
    const studentsInMajors = await prisma.user.count({
      where: {
        majorId: { in: (await prisma.major.findMany({ where: { departmentId }, select: { id: true } })).map(m => m.id) },
        role: 'student',
      },
    });

    const studentsInClassRooms = await prisma.user.count({
      where: {
        classRoomId: {
          in: (await prisma.classRoom.findMany({ where: { departmentId }, select: { id: true } })).map(c => c.id),
        },
        role: 'student',
      },
    });

    const totalStudents = Math.max(studentsInMajors, studentsInClassRooms);
    if (totalStudents > 0 && force !== 'true') {
      return res.status(409).json({
        message: `该院系关联数据中有 ${totalStudents} 名学生，无法删除。如需级联删除，请传递 force=true 参数`,
      });
    }

    // force=true: 先清除关联用户的院系/专业/班级引用
    if (force === 'true') {
      await prisma.$transaction(async (tx) => {
        const majorIds = (await tx.major.findMany({ where: { departmentId }, select: { id: true } })).map(m => m.id);
        const classRoomIds = (await tx.classRoom.findMany({ where: { departmentId }, select: { id: true } })).map(c => c.id);

        // 清除用户关联
        await tx.user.updateMany({
          where: { classRoomId: { in: classRoomIds } },
          data: { classRoomId: null },
        });
        await tx.user.updateMany({
          where: { majorId: { in: majorIds } },
          data: { majorId: null },
        });
        await tx.user.updateMany({
          where: { departmentId },
          data: { departmentId: null },
        });

        // 删除院系（Prisma schema 中 Major → Department 和 ClassRoom → Major 设置了 onDelete: Cascade，
        // 所以删除 Department 会级联删除 Major，删除 Major 会级联删除 ClassRoom）
        await tx.department.delete({ where: { id: departmentId } });
      });
    } else {
      await prisma.department.delete({ where: { id: departmentId } });
    }

    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '院系不存在' });
    }
    // 处理外键约束错误
    if (err.code === 'P2003' || err.code === 'P2014') {
      return res.status(409).json({ message: '该院系下存在关联数据，无法删除' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============ 专业 CRUD ============

// POST /:departmentId/majors — 创建专业（admin only）
departmentRouter.post('/:departmentId/majors', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = createMajorSchema.parse(req.body);
    const { departmentId } = req.params;

    // 检查院系是否存在
    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) {
      return res.status(404).json({ message: '院系不存在' });
    }

    // 检查同一院系下 code 是否重复
    const existing = await prisma.major.findFirst({
      where: { departmentId, code: data.code },
    });
    if (existing) {
      return res.status(409).json({ message: '该院系下专业编码已存在' });
    }

    const major = await prisma.major.create({
      data: {
        name: data.name,
        code: data.code,
        departmentId,
        description: data.description,
        sortOrder: data.sortOrder ?? 0,
      },
    });

    res.status(201).json(major);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /majors/:id — 更新专业（admin only）
departmentRouter.put('/majors/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = updateMajorSchema.parse(req.body);
    const majorId = req.params.id;

    // 检查唯一性冲突（同一院系下 code 不能重复）
    if (data.code) {
      const current = await prisma.major.findUnique({ where: { id: majorId } });
      if (!current) {
        return res.status(404).json({ message: '专业不存在' });
      }
      const existing = await prisma.major.findFirst({
        where: {
          id: { not: majorId },
          departmentId: current.departmentId,
          code: data.code,
        },
      });
      if (existing) {
        return res.status(409).json({ message: '该院系下专业编码已存在' });
      }
    }

    const major = await prisma.major.update({
      where: { id: majorId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.code !== undefined && { code: data.code }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });

    res.json(major);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '专业不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /majors/:id — 删除专业（admin only）
departmentRouter.delete('/majors/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { force } = req.query;
    const majorId = req.params.id;

    const major = await prisma.major.findUnique({
      where: { id: majorId },
      include: {
        _count: { select: { users: true, classRooms: true } },
      },
    });

    if (!major) {
      return res.status(404).json({ message: '专业不存在' });
    }

    // 检查是否有用户关联到此专业
    const userCount = major._count.users;
    if (userCount > 0 && force !== 'true') {
      return res.status(409).json({
        message: `该专业下有 ${userCount} 名关联用户，无法删除。如需级联删除，请传递 force=true 参数`,
      });
    }

    // 检查班级下是否有学生
    const studentsInClassRooms = await prisma.user.count({
      where: {
        classRoomId: {
          in: (await prisma.classRoom.findMany({ where: { majorId }, select: { id: true } })).map(c => c.id),
        },
        role: 'student',
      },
    });

    if (studentsInClassRooms > 0 && force !== 'true') {
      return res.status(409).json({
        message: `该专业班级中有 ${studentsInClassRooms} 名学生，无法删除。如需级联删除，请传递 force=true 参数`,
      });
    }

    if (force === 'true') {
      await prisma.$transaction(async (tx) => {
        const classRoomIds = (await tx.classRoom.findMany({ where: { majorId }, select: { id: true } })).map(c => c.id);

        // 清除用户关联
        await tx.user.updateMany({
          where: { classRoomId: { in: classRoomIds } },
          data: { classRoomId: null },
        });
        await tx.user.updateMany({
          where: { majorId },
          data: { majorId: null },
        });

        // 删除专业（ClassRoom → Major 设置了 onDelete: Cascade）
        await tx.major.delete({ where: { id: majorId } });
      });
    } else {
      await prisma.major.delete({ where: { id: majorId } });
    }

    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '专业不存在' });
    }
    if (err.code === 'P2003' || err.code === 'P2014') {
      return res.status(409).json({ message: '该专业下存在关联数据，无法删除' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============ 班级 CRUD ============

// POST /majors/:majorId/classrooms — 创建班级（admin/teacher）
departmentRouter.post('/majors/:majorId/classrooms', authorize('admin', 'teacher'), async (req: Request, res: Response) => {
  try {
    const data = createClassRoomSchema.parse(req.body);
    const { majorId } = req.params;

    // 检查专业是否存在
    const major = await prisma.major.findUnique({
      where: { id: majorId },
      include: { department: true },
    });
    if (!major) {
      return res.status(404).json({ message: '专业不存在' });
    }

    // 检查班级编码唯一性
    const existing = await prisma.classRoom.findUnique({ where: { code: data.code } });
    if (existing) {
      return res.status(409).json({ message: '班级编码已存在' });
    }

    const classRoom = await prisma.classRoom.create({
      data: {
        name: data.name,
        code: data.code,
        academicYear: data.academicYear,
        gradeLevel: data.gradeLevel,
        departmentId: major.departmentId,
        majorId,
      },
    });

    res.status(201).json(classRoom);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /classrooms/:id — 更新班级（admin/teacher）
departmentRouter.put('/classrooms/:id', authorize('admin', 'teacher'), async (req: Request, res: Response) => {
  try {
    const data = updateClassRoomSchema.parse(req.body);
    const classRoomId = req.params.id;

    // 检查编码唯一性
    if (data.code) {
      const existing = await prisma.classRoom.findFirst({
        where: { id: { not: classRoomId }, code: data.code },
      });
      if (existing) {
        return res.status(409).json({ message: '班级编码已存在' });
      }
    }

    const classRoom = await prisma.classRoom.update({
      where: { id: classRoomId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.code !== undefined && { code: data.code }),
        ...(data.academicYear !== undefined && { academicYear: data.academicYear }),
        ...(data.gradeLevel !== undefined && { gradeLevel: data.gradeLevel }),
      },
    });

    res.json(classRoom);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '班级不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /classrooms/:id — 删除班级（admin only）
departmentRouter.delete('/classrooms/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { force } = req.query;
    const classRoomId = req.params.id;

    const classRoom = await prisma.classRoom.findUnique({
      where: { id: classRoomId },
      include: {
        _count: { select: { students: true } },
      },
    });

    if (!classRoom) {
      return res.status(404).json({ message: '班级不存在' });
    }

    // 检查是否有学生关联
    const studentCount = classRoom._count.students;
    if (studentCount > 0 && force !== 'true') {
      return res.status(409).json({
        message: `该班级下有 ${studentCount} 名学生，无法删除。如需级联删除，请传递 force=true 参数`,
      });
    }

    if (force === 'true') {
      await prisma.$transaction(async (tx) => {
        // 清除学生关联
        await tx.user.updateMany({
          where: { classRoomId },
          data: { classRoomId: null },
        });
        await tx.classRoom.delete({ where: { id: classRoomId } });
      });
    } else {
      await prisma.classRoom.delete({ where: { id: classRoomId } });
    }

    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '班级不存在' });
    }
    if (err.code === 'P2003' || err.code === 'P2014') {
      return res.status(409).json({ message: '该班级下存在关联数据，无法删除' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /classrooms/:id/students — 获取班级学生列表（admin/teacher）
departmentRouter.get('/classrooms/:id/students', authorize('admin', 'teacher'), async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20' } = req.query;
    const classRoomId = req.params.id;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 检查班级是否存在
    const classRoom = await prisma.classRoom.findUnique({ where: { id: classRoomId } });
    if (!classRoom) {
      return res.status(404).json({ message: '班级不存在' });
    }

    const where = { classRoomId, role: 'student' as const };

    const [students, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          username: true,
          realName: true,
          studentId: true,
          gender: true,
          phoneNumber: true,
          email: true,
          accountStatus: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: students, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
