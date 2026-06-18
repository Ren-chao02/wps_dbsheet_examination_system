import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const examRouter = Router();
examRouter.use(authenticate);
examRouter.use(authorize('teacher', 'admin'));

const examSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().optional(),
  mode: z.enum(['practice', 'quiz', 'exam']).default('practice'),
  durationMinutes: z.number().int().positive().nullable().optional(),
  startTime: z.string().datetime().nullable().optional(),
  endTime: z.string().datetime().nullable().optional(),
  passScore: z.number().int().min(0).nullable().optional(),
  settings: z.record(z.any()).default({}),
  paperId: z.string().uuid().nullable().optional(),
});

const examQuestionSchema = z.object({
  questionIds: z.array(z.object({
    questionId: z.string().uuid(),
    sortOrder: z.number().int().min(0).default(0),
    scoreOverride: z.number().int().min(0).nullable().optional(),
  })),
});

// GET /api/exams
examRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', status, mode } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (status) where.status = String(status);
    if (mode) where.mode = String(mode);

    const [exams, total] = await Promise.all([
      prisma.exam.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { select: { id: true, realName: true } },
          paper: { select: { id: true, name: true, totalScore: true, passScore: true } },
          _count: { select: { examQuestions: true, submissions: true } },
        },
      }),
      prisma.exam.count({ where }),
    ]);

    res.json({ data: exams, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id
examRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, realName: true } },
        paper: { select: { id: true, name: true, totalScore: true, passScore: true } },
        examQuestions: {
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

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }

    res.json(exam);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams
examRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = examSchema.parse(req.body);

    const { paperId, ...rest } = data;
    const exam = await prisma.exam.create({
      data: {
        ...rest,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        createdBy: req.user!.userId,
        paperId: paperId ?? null,
      },
    });

    res.status(201).json(exam);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/exams/:id
examRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status === 'in_progress') {
      return res.status(400).json({ message: '考试进行中，无法编辑' });
    }

    const data = examSchema.parse(req.body);
    const { paperId, ...rest } = data;
    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        paperId: paperId ?? null,
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

// DELETE /api/exams/:id
examRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status === 'in_progress') {
      return res.status(400).json({ message: '考试进行中，无法删除' });
    }

    await prisma.exam.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '考试不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/exams/:id/questions — 设置考试题目
examRouter.put('/:id/questions', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status === 'in_progress' || exam.status === 'ended') {
      return res.status(400).json({ message: '考试已开始或已结束，无法修改题目' });
    }

    const { questionIds } = examQuestionSchema.parse(req.body);

    // Delete existing and create new
    await prisma.examQuestion.deleteMany({ where: { examId: req.params.id } });
    if (questionIds.length > 0) {
      await prisma.examQuestion.createMany({
        data: questionIds.map(q => ({
          examId: req.params.id,
          questionId: q.questionId,
          sortOrder: q.sortOrder,
          scoreOverride: q.scoreOverride,
        })),
      });
    }

    // Update total score
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds.map(q => q.questionId) } },
    });
    const totalScore = questionIds.reduce((sum, q) => {
      const question = questions.find(qq => qq.id === q.questionId);
      return sum + (q.scoreOverride ?? question?.score ?? 0);
    }, 0);

    await prisma.exam.update({
      where: { id: req.params.id },
      data: { totalScore },
    });

    const updated = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        examQuestions: {
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

// POST /api/exams/:id/publish
examRouter.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { examQuestions: true } }, paper: { select: { _count: { select: { paperQuestions: true } } } } },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    const hasQuestions = exam._count.examQuestions > 0 || (exam.paper?._count.paperQuestions ?? 0) > 0;
    if (!hasQuestions) {
      return res.status(400).json({ message: '考试没有题目，无法发布' });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'published' },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/start
examRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'published') {
      return res.status(400).json({ message: '考试未发布，无法开始' });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'in_progress', startTime: new Date() },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/end
examRouter.post('/:id/end', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'in_progress') {
      return res.status(400).json({ message: '考试未在进行中' });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'ended', endTime: new Date() },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id/submissions
examRouter.get('/:id/submissions', async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.studentSubmission.findMany({
      where: { examId: req.params.id },
      include: {
        student: { select: { id: true, username: true, realName: true } },
        _count: { select: { details: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(submissions);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
