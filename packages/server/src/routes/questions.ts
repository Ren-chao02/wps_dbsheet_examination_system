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

// ✅ 更新Zod验证Schema：支持两级分类和元数据字段
const questionSchema = z.object({
  // ❌ 删除原有字段
  // categoryId: z.string().uuid().nullable().optional(),

  // ✅ 新增字段
  primaryCategoryId: z.string().uuid().nullable().optional(),
  secondaryCategoryId: z.string().uuid().nullable().optional(),
  teacherName: z.string().max(64).optional(),

  // 保留现有字段
  title: z.string().min(1).max(512),
  description: z.string().optional(),
  // type字段已移除，统一默认为实操题(comprehensive)
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  score: z.number().int().min(0).default(10),
  answerRules: z.array(answerRuleSchema).default([]),
  hints: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

// GET /api/questions - 支持高级筛选（9个维度）
questionRouter.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      search,
      difficulty,
      status,
      teacherName,
      primaryCategory,
      secondaryCategory,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    } = req.query;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 构建动态查询条件
    const where: any = {};

    // 基础搜索
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    // 基础筛选
    if (difficulty) where.difficulty = String(difficulty);
    if (status) where.status = String(status);

    // ✨ 新增：出题老师模糊匹配
    if (teacherName) {
      where.teacherName = { contains: String(teacherName), mode: 'insensitive' };
    }

    // ✨ 新增：一级分类筛选（支持ID或名称）
    if (primaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(primaryCategory));
      if (isUuid) {
        where.primaryCategoryId = String(primaryCategory);
      } else {
        where.primaryCategory = { name: { contains: String(primaryCategory), mode: 'insensitive' } };
      }
    }

    // ✨ 新增：二级分类筛选（支持ID或名称）
    if (secondaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(secondaryCategory));
      if (isUuid) {
        where.secondaryCategoryId = String(secondaryCategory);
      } else {
        where.secondaryCategory = { name: { contains: String(secondaryCategory), mode: 'insensitive' } };
      }
    }

    // ✨ 新增：创建时间范围筛选
    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) where.createdAt.gte = new Date(String(createdAtStart));
      if (createdAtEnd) where.createdAt.lte = new Date(String(createdAtEnd));
    }

    // ✨ 新增：更新时间范围筛选
    if (updatedAtStart || updatedAtEnd) {
      where.updatedAt = {};
      if (updatedAtStart) where.updatedAt.gte = new Date(String(updatedAtStart));
      if (updatedAtEnd) where.updatedAt.lte = new Date(String(updatedAtEnd));
    }

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          // ✅ 替换为两个分类关联
          primaryCategory: { select: { id: true, name: true } },
          secondaryCategory: { select: { id: true, name: true } },
          creator: { select: { id: true, realName: true } },
        },
      }),
      prisma.question.count({ where }),
    ]);

    res.json({ data: questions, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/questions/:id - 返回完整题目信息
questionRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const question = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: {
        // ✅ 返回完整的分类信息
        primaryCategory: true,
        secondaryCategory: true,
        creator: { select: { id: true, realName: true } },
      },
    });

    if (!question) {
      return res.status(404).json({ message: '题目不存在' });
    }

    res.json(question);
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/questions - 创建题目（自动填充元数据）
questionRouter.post('/', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = questionSchema.parse(req.body);

    // ✅ 自动填充元数据，统一设置为实操题
    const question = await prisma.question.create({
      data: {
        ...data,
        type: 'comprehensive',
        createdBy: req.user!.userId,
        // 如果未提供teacherName，使用当前用户姓名
        teacherName: data.teacherName || req.user?.realName || undefined,
      },
      include: {
        primaryCategory: { select: { id: true, name: true } },
        secondaryCategory: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(question);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error creating question:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/questions/:id - 更新题目（自动填充更新人）
questionRouter.put('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const existingQuestion = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existingQuestion) {
      return res.status(404).json({ message: '题目不存在' });
    }

    const data = questionSchema.parse(req.body);

    // ✅ 自动填充更新人
    const updated = await prisma.question.update({
      where: { id: req.params.id },
      data: {
        ...data,
        type: 'comprehensive',
        updatedBy: req.user?.realName || undefined,
      },
      include: {
        primaryCategory: { select: { id: true, name: true } },
        secondaryCategory: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error updating question:', err);
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
    console.error('Error deleting question:', err);
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
    console.error('Error updating question status:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
