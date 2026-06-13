import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const questionRouter = Router();
questionRouter.use(authenticate);

const answerRuleSchema = z.object({
  id: z.string(),
  action: z.string(),
  params: z.record(z.any()),
  score: z.number().int().min(0),
});

const questionSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(512),
  description: z.string().optional(),
  type: z.enum(['create_table', 'add_field', 'config_view', 'create_form', 'comprehensive']),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  score: z.number().int().min(0).default(10),
  answerRules: z.array(answerRuleSchema).default([]),
  hints: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

// GET /api/questions
questionRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', search, type, difficulty, status, categoryId } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    if (type) where.type = String(type);
    if (difficulty) where.difficulty = String(difficulty);
    if (status) where.status = String(status);
    if (categoryId) where.categoryId = String(categoryId);

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          category: { select: { id: true, name: true } },
          creator: { select: { id: true, realName: true } },
        },
      }),
      prisma.question.count({ where }),
    ]);

    res.json({ data: questions, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/questions/:id
questionRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const question = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: {
        category: { select: { id: true, name: true } },
        creator: { select: { id: true, realName: true } },
      },
    });

    if (!question) {
      return res.status(404).json({ message: '题目不存在' });
    }

    res.json(question);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/questions
questionRouter.post('/', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = questionSchema.parse(req.body);
    const question = await prisma.question.create({
      data: {
        ...data,
        createdBy: req.user!.userId,
      },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(question);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/questions/:id
questionRouter.put('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const question = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!question) {
      return res.status(404).json({ message: '题目不存在' });
    }

    const data = questionSchema.parse(req.body);
    const updated = await prisma.question.update({
      where: { id: req.params.id },
      data,
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/questions/:id
questionRouter.delete('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    // Check if question is used in any exam
    const used = await prisma.examQuestion.count({ where: { questionId: req.params.id } });
    if (used > 0) {
      return res.status(400).json({ message: '该题目已被考试引用，无法删除。请先归档' });
    }
    await prisma.question.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '题目不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/questions/:id/status
questionRouter.put('/:id/status', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const { status } = z.object({ status: z.enum(['draft', 'published', 'archived']) }).parse(req.body);
    const question = await prisma.question.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(question);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '题目不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
