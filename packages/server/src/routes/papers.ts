import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const paperRouter = Router();
paperRouter.use(authenticate);
paperRouter.use(authorize('teacher', 'admin'));

const paperSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().optional(),
  difficulty: z.string().optional(),
  passScore: z.number().int().min(0).nullable().optional(),
});

const paperQuestionSchema = z.object({
  questionIds: z.array(z.object({
    questionId: z.string().uuid(),
    sortOrder: z.number().int().min(0).default(0),
    score: z.number().int().min(0).default(10),
  })),
});

// GET /api/papers
paperRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', search, difficulty, source } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (search) {
      where.name = { contains: String(search), mode: 'insensitive' };
    }
    if (difficulty) {
      where.difficulty = String(difficulty);
    }
    if (source) {
      where.source = String(source);
    }

    const [papers, total] = await Promise.all([
      prisma.paper.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { select: { id: true, realName: true } },
          _count: { select: { paperQuestions: true, exams: true } },
        },
      }),
      prisma.paper.count({ where }),
    ]);

    res.json({ data: papers, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/papers/:id
paperRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, realName: true } },
        paperQuestions: {
          include: {
            question: {
              include: {
                primaryCategory: { select: { id: true, name: true } },
                secondaryCategory: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    res.json(paper);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/papers
paperRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = paperSchema.parse(req.body);

    const paper = await prisma.paper.create({
      data: {
        ...data,
        createdBy: req.user!.userId,
      },
    });

    res.status(201).json(paper);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/papers/:id
paperRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    const data = paperSchema.parse(req.body);
    const updated = await prisma.paper.update({
      where: { id: req.params.id },
      data,
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/papers/:id
paperRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { exams: true } } },
    });
    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }
    if (paper._count.exams > 0) {
      return res.status(400).json({ message: '试卷已被考试使用，无法删除' });
    }

    await prisma.paper.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/papers/:id/questions — 设置试卷题目
paperRouter.put('/:id/questions', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    const { questionIds } = paperQuestionSchema.parse(req.body);

    // Delete existing and create new
    await prisma.paperQuestion.deleteMany({ where: { paperId: req.params.id } });
    if (questionIds.length > 0) {
      await prisma.paperQuestion.createMany({
        data: questionIds.map(q => ({
          paperId: req.params.id,
          questionId: q.questionId,
          sortOrder: q.sortOrder,
          score: q.score,
        })),
      });
    }

    // Update total score
    const totalScore = questionIds.reduce((sum, q) => sum + q.score, 0);
    await prisma.paper.update({
      where: { id: req.params.id },
      data: { totalScore },
    });

    const updated = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: {
        paperQuestions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
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

// POST /api/papers/:id/duplicate — 复制试卷
paperRouter.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const original = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: {
        paperQuestions: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!original) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    const duplicated = await prisma.paper.create({
      data: {
        name: `${original.name} - 副本`,
        description: original.description,
        difficulty: original.difficulty,
        passScore: original.passScore,
        totalScore: original.totalScore,
        createdBy: req.user!.userId,
        paperQuestions: {
          create: original.paperQuestions.map(pq => ({
            questionId: pq.questionId,
            sortOrder: pq.sortOrder,
            score: pq.score,
          })),
        },
      },
    });

    res.status(201).json(duplicated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
