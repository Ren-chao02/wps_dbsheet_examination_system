import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const userRouter = Router();
userRouter.use(authenticate);
userRouter.use(authorize('admin', 'teacher'));

const createUserSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'teacher', 'student']),
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

    const where: any = {};
    if (search) {
      where.OR = [
        { username: { contains: String(search), mode: 'insensitive' } },
        { realName: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    if (role) {
      where.role = String(role);
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          realName: true,
          role: true,
          email: true,
          avatarUrl: true,
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

    const existing = await prisma.user.findUnique({ where: { username: data.username } });
    if (existing) {
      return res.status(409).json({ message: '用户名已存在' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        realName: data.realName,
        email: data.email,
        role: data.role,
      },
    });

    res.status(201).json({
      id: user.id,
      username: user.username,
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
