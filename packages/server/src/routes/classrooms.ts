/**
 * 班级管理 — 班级成为主实体
 *
 * 权限：
 * - 读取：teacher 只看自己任教的班级；admin 全量；
 * - 写：admin（建班/编辑/删除/批量分配教师）。
 *
 * 院系/专业保留为可选元数据：班级可以不挂院系/专业；删除院系时班级保留（SET NULL）。
 */
import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { scopeCtxOf } from '../services/data-scope';
import { logger } from '../utils/logger';

export const classroomRouter = Router();

classroomRouter.use(authenticate);
classroomRouter.use(authorize('teacher', 'admin'));

const createClassroomSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).optional(),
  academicYear: z.string().min(4).max(20),
  gradeLevel: z.coerce.number().int().min(1).max(8).default(1),
  departmentId: z.string().uuid().nullable().optional(),
  majorId: z.string().uuid().nullable().optional(),
  teacherIds: z.array(z.string().uuid()).optional(),
});

const updateClassroomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  code: z.string().min(1).max(50).optional(),
  academicYear: z.string().min(4).max(20).optional(),
  gradeLevel: z.coerce.number().int().min(1).max(8).optional(),
  departmentId: z.string().uuid().nullable().optional(),
  majorId: z.string().uuid().nullable().optional(),
});

const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

const batchTeachersSchema = z.object({
  classIds: z.array(z.string().uuid()).min(1).max(100),
  teacherIds: z.array(z.string().uuid()).min(1).max(100),
  mode: z.enum(['add', 'replace']).default('add'),
});

const classSelect = {
  id: true,
  name: true,
  code: true,
  academicYear: true,
  gradeLevel: true,
  departmentId: true,
  majorId: true,
  source: true,
  createdAt: true,
  department: { select: { id: true, name: true } },
  major: { select: { id: true, name: true } },
  creator: { select: { id: true, username: true, realName: true } },
  teacherClasses: {
    select: {
      teacher: { select: { id: true, username: true, realName: true } },
    },
  },
  _count: { select: { students: true, invitations: true } },
} as const;

type ClassRow = {
  id: string;
  name: string;
  code: string;
  academicYear: string;
  gradeLevel: number;
  departmentId: string | null;
  majorId: string | null;
  source: string;
  createdAt: Date;
  department: { id: string; name: string } | null;
  major: { id: string; name: string } | null;
  creator: { id: string; username: string; realName: string | null } | null;
  teacherClasses: Array<{
    teacher: { id: string; username: string; realName: string | null };
  }>;
  _count: { students: number; invitations: number };
};

function toClassDto(row: ClassRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    academicYear: row.academicYear,
    gradeLevel: row.gradeLevel,
    departmentId: row.departmentId,
    departmentName: row.department?.name ?? null,
    majorId: row.majorId,
    majorName: row.major?.name ?? null,
    studentCount: row._count.students,
    invitationCount: row._count.invitations,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
    creator: row.creator,
    teachers: row.teacherClasses.map((item) => item.teacher),
  };
}

function scopeWhere(req: Request) {
  const ctx = scopeCtxOf(req);
  return ctx.isAdmin ? {} : { teacherClasses: { some: { teacherId: ctx.userId } } };
}

function parsePaging(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

function orderBy(sort: string) {
  if (sort === 'createdAt_asc') return { createdAt: 'asc' as const };
  if (sort === 'name_asc') return { name: 'asc' as const };
  return { createdAt: 'desc' as const };
}

async function generateUniqueClassCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const code = `C${date}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const exists = await prisma.classRoom.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error('班级编码生成失败，请手动填写');
}

/**
 * 校验院系/专业，并在只传 majorId 时自动带出 departmentId。
 * 返回 null 表示校验失败，已经写过响应。
 */
async function resolveDepartmentMajor(
  res: Response,
  departmentId?: string | null,
  majorId?: string | null,
): Promise<{ departmentId: string | null; majorId: string | null } | null> {
  let nextDepartmentId = departmentId ?? null;
  const nextMajorId = majorId ?? null;

  if (nextMajorId) {
    const major = await prisma.major.findUnique({
      where: { id: nextMajorId },
      select: { id: true, departmentId: true },
    });
    if (!major) {
      res.status(400).json({ message: '专业不存在' });
      return null;
    }
    if (nextDepartmentId && nextDepartmentId !== major.departmentId) {
      res.status(400).json({ message: '专业不属于所选院系' });
      return null;
    }
    nextDepartmentId = major.departmentId;
  }

  if (nextDepartmentId) {
    const department = await prisma.department.findUnique({
      where: { id: nextDepartmentId },
      select: { id: true },
    });
    if (!department) {
      res.status(400).json({ message: '院系不存在' });
      return null;
    }
  }

  return { departmentId: nextDepartmentId, majorId: nextMajorId };
}

async function validateTeacherIds(res: Response, teacherIds: string[]): Promise<boolean> {
  const unique = [...new Set(teacherIds)];
  if (unique.length === 0) return true;

  const count = await prisma.user.count({
    where: { id: { in: unique }, role: 'teacher' },
  });
  if (count !== unique.length) {
    res.status(400).json({ message: '管理教师包含不存在或非教师角色的账号' });
    return false;
  }
  return true;
}

async function findClassDto(id: string) {
  const row = await prisma.classRoom.findUnique({
    where: { id },
    select: classSelect,
  });
  return row ? toClassDto(row) : null;
}

// ============================================================
// 读取
// ============================================================

classroomRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = parsePaging(req);
    const search = String(req.query.search || '').trim();
    const sort = String(req.query.sort || 'createdAt_desc');

    const where: any = {
      AND: [scopeWhere(req)],
    };

    if (search) {
      where.AND.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          {
            teacherClasses: {
              some: {
                teacher: {
                  OR: [
                    { realName: { contains: search, mode: 'insensitive' } },
                    { username: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    const [rows, total] = await Promise.all([
      prisma.classRoom.findMany({
        where,
        select: classSelect,
        orderBy: orderBy(sort),
        skip,
        take: pageSize,
      }),
      prisma.classRoom.count({ where }),
    ]);

    res.json({
      data: rows.map(toClassDto),
      total,
      page,
      pageSize,
    });
  } catch (err) {
    logger.error({ err }, '[classrooms] 列表查询失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

classroomRouter.get('/options', async (req: Request, res: Response) => {
  try {
    const rows = await prisma.classRoom.findMany({
      where: scopeWhere(req),
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    res.json({ data: rows });
  } catch (err) {
    logger.error({ err }, '[classrooms] 班级选项查询失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

classroomRouter.get('/teacher-options', authorize('admin'), async (_req: Request, res: Response) => {
  try {
    const rows = await prisma.user.findMany({
      where: { role: 'teacher', accountStatus: 'ENABLED' },
      select: { id: true, username: true, realName: true },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
    res.json({ data: rows });
  } catch (err) {
    logger.error({ err }, '[classrooms] 教师选项查询失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// 写入
// ============================================================

classroomRouter.post('/', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = createClassroomSchema.parse(req.body);

    const resolved = await resolveDepartmentMajor(res, data.departmentId, data.majorId);
    if (!resolved) return;

    const teacherIds = [...new Set(data.teacherIds || [])];
    if (!(await validateTeacherIds(res, teacherIds))) return;

    let code = data.code?.trim();
    if (code) {
      const exists = await prisma.classRoom.findUnique({ where: { code }, select: { id: true } });
      if (exists) {
        return res.status(409).json({ message: '班级编码已存在' });
      }
    } else {
      code = await generateUniqueClassCode();
    }

    const created = await prisma.$transaction(async (tx) => {
      const cls = await tx.classRoom.create({
        data: {
          name: data.name.trim(),
          code,
          academicYear: data.academicYear.trim(),
          gradeLevel: data.gradeLevel,
          departmentId: resolved.departmentId,
          majorId: resolved.majorId,
          createdBy: req.user!.userId,
          source: 'MANUAL',
        },
        select: { id: true },
      });

      if (teacherIds.length > 0) {
        await tx.teacherClass.createMany({
          data: teacherIds.map((teacherId) => ({ teacherId, classId: cls.id })),
          skipDuplicates: true,
        });
      }
      return cls;
    });

    const dto = await findClassDto(created.id);
    res.status(201).json(dto);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: '班级编码已存在' });
    }
    logger.error({ err }, '[classrooms] 建班失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

classroomRouter.put('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = updateClassroomSchema.parse(req.body);
    const existing = await prisma.classRoom.findUnique({
      where: { id: req.params.id },
      select: { id: true, code: true, departmentId: true, majorId: true },
    });
    if (!existing) {
      return res.status(404).json({ message: '班级不存在' });
    }

    if (data.code !== undefined && data.code !== existing.code) {
      const conflict = await prisma.classRoom.findUnique({
        where: { code: data.code },
        select: { id: true },
      });
      if (conflict) {
        return res.status(409).json({ message: '班级编码已存在' });
      }
    }

    // 清空院系时一并清空专业，避免留下「专业属于已清空院系」的不一致
    const departmentInput =
      data.departmentId !== undefined ? data.departmentId : existing.departmentId;
    const majorInput =
      data.majorId !== undefined
        ? data.majorId
        : data.departmentId === null
          ? null
          : existing.majorId;

    const resolved = await resolveDepartmentMajor(res, departmentInput, majorInput);
    if (!resolved) return;

    await prisma.classRoom.update({
      where: { id: req.params.id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.code !== undefined && { code: data.code.trim() }),
        ...(data.academicYear !== undefined && { academicYear: data.academicYear.trim() }),
        ...(data.gradeLevel !== undefined && { gradeLevel: data.gradeLevel }),
        departmentId: resolved.departmentId,
        majorId: resolved.majorId,
      },
    });

    const dto = await findClassDto(req.params.id);
    res.json(dto);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err?.code === 'P2025') {
      return res.status(404).json({ message: '班级不存在' });
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: '班级编码已存在' });
    }
    logger.error({ err }, '[classrooms] 更新班级失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

classroomRouter.delete('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const cls = await prisma.classRoom.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        _count: { select: { students: true, invitations: true } },
      },
    });
    if (!cls) {
      return res.status(404).json({ message: '班级不存在' });
    }
    if (cls._count.students > 0 || cls._count.invitations > 0) {
      return res.status(409).json({
        message: '班级下仍有学生或邀请，不能删除',
        studentCount: cls._count.students,
        invitationCount: cls._count.invitations,
      });
    }

    await prisma.classRoom.delete({ where: { id: cls.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return res.status(404).json({ message: '班级不存在' });
    }
    logger.error({ err }, '[classrooms] 删除班级失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

classroomRouter.post('/batch-delete', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { ids } = batchDeleteSchema.parse(req.body);
    const deleted: string[] = [];
    const skipped: Array<{
      id: string;
      name?: string;
      reason: string;
      studentCount?: number;
      invitationCount?: number;
    }> = [];

    for (const id of [...new Set(ids)]) {
      const cls = await prisma.classRoom.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          _count: { select: { students: true, invitations: true } },
        },
      });
      if (!cls) {
        skipped.push({ id, reason: '班级不存在' });
        continue;
      }
      if (cls._count.students > 0 || cls._count.invitations > 0) {
        skipped.push({
          id,
          name: cls.name,
          reason: '班级下仍有学生或邀请',
          studentCount: cls._count.students,
          invitationCount: cls._count.invitations,
        });
        continue;
      }
      await prisma.classRoom.delete({ where: { id } });
      deleted.push(id);
    }

    res.json({ deleted, skipped });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    logger.error({ err }, '[classrooms] 批量删除失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

classroomRouter.post('/batch-teachers', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const { classIds, teacherIds, mode } = batchTeachersSchema.parse(req.body);
    const uniqueClassIds = [...new Set(classIds)];
    const uniqueTeacherIds = [...new Set(teacherIds)];

    const classCount = await prisma.classRoom.count({
      where: { id: { in: uniqueClassIds } },
    });
    if (classCount !== uniqueClassIds.length) {
      return res.status(400).json({ message: '部分班级不存在' });
    }

    const teacherCount = await prisma.user.count({
      where: { id: { in: uniqueTeacherIds }, role: 'teacher' },
    });
    if (teacherCount !== uniqueTeacherIds.length) {
      return res.status(400).json({ message: '部分教师不存在或不是教师角色' });
    }

    await prisma.$transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.teacherClass.deleteMany({
          where: { classId: { in: uniqueClassIds } },
        });
      }
      await tx.teacherClass.createMany({
        data: uniqueClassIds.flatMap((classId) =>
          uniqueTeacherIds.map((teacherId) => ({ classId, teacherId })),
        ),
        skipDuplicates: true,
      });
    });

    res.json({
      classCount: uniqueClassIds.length,
      teacherCount: uniqueTeacherIds.length,
      mode,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    logger.error({ err }, '[classrooms] 批量分配教师失败');
    res.status(500).json({ message: '服务器错误' });
  }
});
