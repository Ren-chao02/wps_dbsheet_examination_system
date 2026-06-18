import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const batchRouter = Router();
batchRouter.use(authenticate);
batchRouter.use(authorize('teacher', 'admin'));

// ✅ Zod验证Schema
const batchCreateSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().optional(),
  examDuration: z.number().int().positive(), // 统一考试时长（分钟）
  waitingTime: z.number().int().nonnegative().default(10), // 候考时间（分钟）
  lateTolerance: z.number().int().nonnegative().default(15), // 迟到容忍（分钟）
  settings: z.record(z.any()).default({}), // 批次级配置
});

const batchUpdateSchema = batchCreateSchema.partial();

// GET /api/batches - 获取批次列表（分页+筛选）
batchRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', status, keyword } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (status) where.status = String(status);
    if (keyword) {
      where.OR = [
        { name: { contains: String(keyword), mode: 'insensitive' } },
        { description: { contains: String(keyword), mode: 'insensitive' } },
      ];
    }

    const [batches, total] = await Promise.all([
      prisma.examBatch.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          creator: { select: { id: true, realName: true, username: true } },
          _count: { select: { exams: true } }, // 统计该批次下的考试数量
        },
      }),
      prisma.examBatch.count({ where }),
    ]);

    res.json({
      data: batches,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    console.error('获取批次列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/batches/:id - 获取单个批次详情
batchRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const batch = await prisma.examBatch.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, realName: true, username: true } },
        exams: {
          include: {
            _count: { select: { submissions: true, sessions: true } },
            paper: { select: { name: true, totalScore: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { exams: true } },
      },
    });

    if (!batch) {
      return res.status(404).json({ message: '批次不存在' });
    }

    res.json(batch);
  } catch (error) {
    console.error('获取批次详情失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/batches - 创建新批次
batchRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = batchCreateSchema.parse(req.body);

    const batch = await prisma.examBatch.create({
      data: {
        ...data,
        createdBy: req.user!.userId,
      },
      include: {
        creator: { select: { id: true, realName: true } },
      },
    });

    res.status(201).json(batch);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('创建批次失败:', err);
    res.status(500).json({ message: '创建失败' });
  }
});

// PUT /api/batches/:id - 更新批次信息
batchRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.examBatch.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ message: '批次不存在' });
    }
    if (existing.status === 'completed') {
      return res.status(400).json({ message: '已完成的批次无法修改' });
    }

    const data = batchUpdateSchema.parse(req.body);

    const updated = await prisma.examBatch.update({
      where: { id: req.params.id },
      data,
      include: {
        creator: { select: { id: true, realName: true } },
        _count: { select: { exams: true } },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('更新批次失败:', err);
    res.status(500).json({ message: '更新失败' });
  }
});

// DELETE /api/batches/:id - 删除批次（仅草稿状态可删除）
batchRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.examBatch.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { exams: true } } },
    });

    if (!existing) {
      return res.status(404).json({ message: '批次不存在' });
    }
    if (existing.status !== 'draft') {
      return res.status(400).json({ message: `当前状态为${existing.status}，无法删除` });
    }
    if (existing._count.exams > 0) {
      return res.status(400).json({ message: '该批次下已有考试，请先删除关联的考试' });
    }

    await prisma.examBatch.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '批次不存在' });
    }
    console.error('删除批次失败:', err);
    res.status(500).json({ message: '删除失败' });
  }
});

// PUT /api/batches/:id/status - 更新批次状态
batchRouter.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['draft', 'active', 'completed', 'archived']),
    }).parse(req.body);

    const existing = await prisma.examBatch.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ message: '批次不存在' });
    }

    // 状态流转校验
    const validTransitions: Record<string, string[]> = {
      draft: ['active', 'archived'],
      active: ['completed', 'archived'],
      completed: ['archived'],
      archived: [], // 归档后不可逆
    };

    if (!validTransitions[existing.status]?.includes(status)) {
      return res.status(400).json({
        message: `无效的状态转换：${existing.status} → ${status}`,
      });
    }

    const updated = await prisma.examBatch.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('更新状态失败:', err);
    res.status(500).json({ message: '状态更新失败' });
  }
});
