import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { scopeCtxOf, studentWhere, assertStudentAccess, denyAccess } from '../services/data-scope';
import { findIdentifierConflict, identifierConflictMessage } from '../services/user-identifiers';

export const userRouter = Router();
userRouter.use(authenticate);
userRouter.use(authorize('admin', 'teacher'));

const createUserSchema = z
  .object({
    username: z.string().min(2).max(64).optional(),
    employeeId: z.string().min(1).max(64).optional(),
    studentId: z.string().min(1).max(64).optional(),
    password: z.string().min(6),
    realName: z.string().optional(),
    email: z.string().email().optional(),
    role: z.enum(['admin', 'teacher', 'student']),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'teacher') {
      if (!value.employeeId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['employeeId'], message: '教师账号必须填写工号' });
      } else if (value.username && value.username !== value.employeeId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['username'], message: '教师登录名由工号决定' });
      }
    } else if (value.role === 'student') {
      if (!value.studentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['studentId'], message: '学生账号必须填写学号' });
      } else if (value.username && value.username !== value.studentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['username'], message: '学生登录名由学号决定' });
      }
    } else {
      if (!value.username) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['username'], message: '管理员系统账号必须填写登录名' });
      }
      if (value.employeeId || value.studentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['username'], message: '管理员系统账号不使用学号/工号' });
      }
    }
  });

const updateUserSchema = z.object({
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  avatarUrl: z.string().optional(),
});

// GET /api/users
userRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', search, role } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const scope = scopeCtxOf(req);
    // 数据范围（P1）：student/无 role → 走学生范围（教师=任教班级）；
    // role=teacher 保持轻量列表（监考人选择、题库筛选需要）；admin 不受限；
    // 其余 role（如 ?role=admin）一律 fail-closed —— 设计 §3.1：用户列表对教师不可见
    const scopeCondition = !scope.isAdmin && (!role || role === 'student')
      ? await studentWhere(scope)
      : role === 'teacher' && !scope.isAdmin
        ? { role: 'teacher' }
        : scope.isAdmin
          ? {}
          : { id: { in: [] } };
    const conditions: any[] = [scopeCondition];
    if (search) {
      conditions.push({
        OR: [
          { username: { contains: String(search), mode: 'insensitive' } },
          { realName: { contains: String(search), mode: 'insensitive' } },
          { email: { contains: String(search), mode: 'insensitive' } },
        ],
      });
    }
    if (role) conditions.push({ role: String(role) });
    const where: any = { AND: conditions };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        // 脱敏：教师侧只能拿到轻量列表（用于学生/教师下拉选择），
        // 不返回 email/avatarUrl 等敏感字段 —— 历史上任意教师可列出全系统用户（含管理员邮箱）。
        // studentId 保留：考务向导选择学生时用于展示学号（见 ExamWizard Transfer）。
        // admin 保留完整字段（用户管理页需要邮箱等信息）。
        select: req.user!.role === 'teacher'
          ? { id: true, username: true, realName: true, studentId: true }
          : {
              id: true,
              username: true,
              realName: true,
              role: true,
              email: true,
              avatarUrl: true,
              studentId: true,
              employeeId: true,
              accountStatus: true,
              wpsUserId: true,
              wpsBoundAt: true,
              failedLoginAttempts: true,
              lockedUntil: true,
              lastLoginAt: true,
              createdAt: true,
            },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: users, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/users/teachers - 获取教师列表（轻量，用于下拉筛选）
userRouter.get('/teachers', async (_req: Request, res: Response) => {
  try {
    const teachers = await prisma.user.findMany({
      where: { role: 'teacher' },
      select: { id: true, realName: true },
      orderBy: { realName: 'asc' },
    });
    res.json(teachers);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/users/:id
userRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    // 数据范围（P1）：教师只能看自己任教班级的学生详情；管理员不限
    if (req.user!.role === 'teacher') {
      const access = await assertStudentAccess(scopeCtxOf(req), req.params.id);
      if (access !== 'ok') return denyAccess(res, access, '该学生不在你任教的班级内');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        email: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    res.json(user);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/users
userRouter.post('/', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = createUserSchema.parse(req.body);
    const loginName =
      data.role === 'teacher'
        ? data.employeeId!
        : data.role === 'student'
          ? data.studentId!
          : data.username!;

    const conflict = await findIdentifierConflict(loginName);
    if (conflict) {
      return res.status(409).json({ message: identifierConflictMessage(conflict) });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: loginName,
        passwordHash,
        realName: data.realName,
        email: data.email,
        role: data.role,
        employeeId: data.role === 'teacher' ? data.employeeId! : null,
        studentId: data.role === 'student' ? data.studentId! : null,
      },
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
      employeeId: user.employeeId,
      studentId: user.studentId,
      realName: user.realName,
      role: user.role,
      email: user.email,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/users/:id
userRouter.put('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const data = updateUserSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(data.realName !== undefined && { realName: data.realName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.avatarUrl !== undefined && { avatarUrl: data.avatarUrl }),
      },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        email: true,
        avatarUrl: true,
        updatedAt: true,
      },
    });

    res.json(user);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * DELETE /api/users/:id/wps-binding —— 管理员解绑 WPS 账号
 * 学生/教师换绑 WPS 账号时由管理员操作；解绑后下次 SSO 会走首次绑定流程。
 */
userRouter.delete('/:id/wps-binding', authorize('admin'), async (req: Request, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { wpsUserId: null, wpsBoundAt: null },
      select: { id: true },
    });
    res.json({ message: 'WPS 绑定已解除' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * DELETE /api/users/:id/login-lock —— 管理员手动解除登录锁定
 * 考试前学生被误锁时可立即放行，不必等 15 分钟。
 */
userRouter.delete('/:id/login-lock', authorize('admin'), async (req: Request, res: Response) => {
  try {
    await prisma.user.update({
      where: { id: req.params.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
      select: { id: true },
    });
    res.json({ message: '登录锁定已解除' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/users/:id
userRouter.delete('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
