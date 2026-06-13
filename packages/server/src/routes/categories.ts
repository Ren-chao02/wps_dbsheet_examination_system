import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const categoryRouter = Router();
categoryRouter.use(authenticate);

const categorySchema = z.object({
  name: z.string().min(1).max(128),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

// GET /api/categories
categoryRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.questionCategory.findMany({
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(categories);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/categories
categoryRouter.post('/', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await prisma.questionCategory.create({ data });
    res.status(201).json(category);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/categories/:id
categoryRouter.put('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await prisma.questionCategory.update({
      where: { id: req.params.id },
      data,
    });
    res.json(category);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '分类不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/categories/:id
categoryRouter.delete('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    // Check for child categories or questions
    const children = await prisma.questionCategory.count({ where: { parentId: req.params.id } });
    const questions = await prisma.question.count({ where: { categoryId: req.params.id } });
    if (children > 0 || questions > 0) {
      return res.status(400).json({ message: '该分类下存在子分类或题目，无法删除' });
    }
    await prisma.questionCategory.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '分类不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
