import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { validateCidrList } from '../utils/ip-utils';

export const batchRouter = Router();
batchRouter.use(authenticate);
batchRouter.use(authorize('teacher', 'admin'));

// ✅ Zod验证Schema
const batchCreateSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().optional().nullable(),
  examMode: z.enum(['unified', 'flexible']).default('unified'), // 考试模式
  startTime: z.coerce.date(), // 批次开始时间（必填）
  endTime: z.coerce.date(), // 批次结束时间（必填）
  examDuration: z.number().int().positive(), // 统一考试时长（分钟）
  waitingTime: z.number().int().nonnegative().default(10), // 候考时间（分钟）
  lateTolerance: z.number().int().nonnegative().default(15), // 迟到容忍（分钟）
  ipLimitEnabled: z.boolean().default(false), // IP限制
  allowedIps: z.array(z.string()).default([]), // CIDR白名单列表
  freezeMinutes: z.number().int().nonnegative().default(30), // 冻结时间（分钟）
  exitPolicy: z.enum(['finite', 'unlimited', 'none']).default('finite'), // 中途退出处理
  exitMaxCount: z.number().int().nonnegative().default(10), // 退出次数上限
  exitMaxMinutes: z.number().int().nonnegative().default(20), // 单次退出时间上限（分钟）
  rulesContent: z.string().optional().nullable(), // 考试须知内容
  rulesReadSeconds: z.number().int().nonnegative().default(15), // 考试须知强制阅读时长（秒）
  settings: z.preprocess(
    (val) => (val === null ? undefined : val),
    z.record(z.any()).default({}),
  ), // 批次级扩展配置
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

    if (data.ipLimitEnabled) {
      const { valid, invalid } = validateCidrList(data.allowedIps);
      if (!valid) {
        return res.status(400).json({ message: `IP白名单格式错误: ${invalid.join(', ')}` });
      }
    }

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
    const existing = await prisma.examBatch.findUnique({ 
      where: { id: req.params.id },
      include: { _count: { select: { exams: true } } },
    });
    if (!existing) {
      return res.status(404).json({ message: '批次不存在' });
    }
    if (existing.status === 'completed') {
      return res.status(400).json({ message: '已完成的批次无法修改' });
    }

    const data = batchUpdateSchema.parse(req.body);

    if (data.examMode && data.examMode !== existing.examMode) {
      if (existing._count.exams > 0) {
        return res.status(400).json({ 
          message: `该批次下已存在${existing._count.exams}场考试，请先清空或迁移子考试后再切换模式` 
        });
      }
    }

    if (data.ipLimitEnabled && data.allowedIps) {
      const { valid, invalid } = validateCidrList(data.allowedIps);
      if (!valid) {
        return res.status(400).json({ message: `IP白名单格式错误: ${invalid.join(', ')}` });
      }
    }

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

// PUT /api/batches/:id/status - 更新批次状态（含级联发布）
batchRouter.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = z.object({
      status: z.enum(['draft', 'active', 'completed', 'archived']),
    }).parse(req.body);

    const existing = await prisma.examBatch.findUnique({
      where: { id: req.params.id },
      include: { exams: { select: { id: true, status: true, _count: { select: { examQuestions: true } }, paper: { select: { _count: { select: { paperQuestions: true } } } } } } },
    });
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

    // 激活时必须设置开始时间和结束时间
    if (status === 'active' && (!existing.startTime || !existing.endTime)) {
      return res.status(400).json({ message: '激活批次前必须先设置开始时间和结束时间' });
    }

    // 级联发布：批次激活时，自动将其下已准备好的子考试发布
    let cascadePublished = 0;
    if (existing.status === 'draft' && status === 'active') {
      const readyExams = existing.exams.filter(e => {
        if (e.status !== 'draft') return false;
        const hasQuestions = e._count.examQuestions > 0 || (e.paper?._count.paperQuestions ?? 0) > 0;
        return hasQuestions;
      });
      if (readyExams.length > 0) {
        await prisma.exam.updateMany({
          where: { id: { in: readyExams.map(e => e.id) } },
          data: { status: 'published' },
        });
        cascadePublished = readyExams.length;
      }
    }

    const updated = await prisma.examBatch.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json({ ...updated, cascadePublished });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('更新状态失败:', err);
    res.status(500).json({ message: '状态更新失败' });
  }
});

// POST /api/batches/:id/deactivate — 下线批次（active → draft）
batchRouter.post('/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.examBatch.findUnique({
      where: { id: req.params.id },
      include: { exams: { select: { id: true, status: true } } },
    });

    if (!existing) {
      return res.status(404).json({ message: '批次不存在' });
    }
    if (existing.status !== 'active') {
      return res.status(400).json({ message: '只有进行中的批次才能下线' });
    }

    // 检查是否有进行中的考试
    const inProgressExams = existing.exams.filter(e => e.status === 'in_progress');
    if (inProgressExams.length > 0) {
      return res.status(400).json({
        message: `批次下有 ${inProgressExams.length} 场考试正在进行中，请先强制结束这些考试后再下线批次`,
      });
    }

    // 将已发布的考试退回草稿
    const publishedExams = existing.exams.filter(e => e.status === 'published');
    if (publishedExams.length > 0) {
      await prisma.exam.updateMany({
        where: { id: { in: publishedExams.map(e => e.id) } },
        data: { status: 'draft' },
      });
    }

    const updated = await prisma.examBatch.update({
      where: { id: req.params.id },
      data: { status: 'draft' },
    });

    res.json({ ...updated, revertedExams: publishedExams.length });
  } catch (err: any) {
    console.error('下线批次失败:', err);
    res.status(500).json({ message: '下线失败' });
  }
});

// POST /api/batches/:id/extend — 批次延期
batchRouter.post('/:id/extend', async (req: Request, res: Response) => {
  try {
    const { endTime } = z.object({
      endTime: z.string().refine(v => !isNaN(Date.parse(v)), { message: '无效的时间格式' }),
    }).parse(req.body);

    const existing = await prisma.examBatch.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ message: '批次不存在' });
    }
    if (existing.status !== 'active') {
      return res.status(400).json({ message: '只有进行中的批次才能延期' });
    }

    const newEndTime = new Date(endTime);
    if (existing.endTime && newEndTime <= existing.endTime) {
      return res.status(400).json({ message: '延期时间必须晚于当前结束时间' });
    }

    const updated = await prisma.examBatch.update({
      where: { id: req.params.id },
      data: { endTime: newEndTime },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('批次延期失败:', err);
    res.status(500).json({ message: '延期失败' });
  }
});
