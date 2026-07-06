import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const practiceRouter = Router();
practiceRouter.use(authenticate);
practiceRouter.use(authorize('student'));

export const practiceSubmitSchema = z.object({
  paperId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    answerJson: z.record(z.any()).default({}),
  })),
});

export const favoriteSchema = z.object({
  questionId: z.string().uuid(),
});

export const feedbackSchema = z.object({
  questionId: z.string().uuid(),
  feedbackType: z.enum(['question', 'explanation']),
  content: z.string().min(1),
});

const assignmentSchema = z.object({
  fileId: z.string().min(1),
  shareUrl: z.string().optional(),
  accessToken: z.string().optional(),
});

const startSchema = z.object({
  primaryCategoryId: z.string().uuid().optional(),
  secondaryCategoryId: z.string().uuid().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  count: z.number().int().min(1).max(20).default(5),
});

// POST /api/practice/assignment — 注册/更新当前学生的练习文件
practiceRouter.post('/assignment', async (req: Request, res: Response) => {
  try {
    const { fileId, shareUrl, accessToken } = assignmentSchema.parse(req.body);
    const studentId = req.user!.userId;

    const assignment = await prisma.practiceTableAssignment.upsert({
      where: { studentId },
      update: { fileId, shareUrl, accessToken },
      create: { studentId, fileId, shareUrl, accessToken },
    });

    res.json(assignment);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/assignment — 查自己是否已注册练习文件
practiceRouter.get('/assignment', async (req: Request, res: Response) => {
  try {
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId: req.user!.userId },
    });
    res.json(assignment);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/questions/catalog — 返回分类/难度树，供前端选择器
practiceRouter.get('/questions/catalog', async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.questionCategory.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, name: true, parentId: true, level: true, sortOrder: true,
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });

    // 仅返回有 published 题目的分类，避免空选项
    const questions = await prisma.question.findMany({
      where: { status: 'published' },
      select: { primaryCategoryId: true, secondaryCategoryId: true, difficulty: true },
    });
    const usedPrimary = new Set(questions.map(q => q.primaryCategoryId).filter(Boolean) as string[]);
    const usedSecondary = new Set(questions.map(q => q.secondaryCategoryId).filter(Boolean) as string[]);
    const difficulties = Array.from(new Set(questions.map(q => q.difficulty)));

    res.json({
      categories: categories.filter(c =>
        (c.level === 1 && usedPrimary.has(c.id)) ||
        (c.level === 2 && usedSecondary.has(c.id)),
      ),
      difficulties,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/submit — 提交练习并持久化记录
practiceRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const { paperId, answers } = practiceSubmitSchema.parse(req.body);
    const studentId = req.user!.userId;

    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        paperQuestions: { include: { question: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    let totalScore = 0;
    const details = answers.map((ans) => {
      const pq = paper.paperQuestions.find(pq => pq.questionId === ans.questionId);
      if (!pq) return null;

      const hasAnswer = Object.keys(ans.answerJson || {}).length > 0;
      const isCorrect = hasAnswer;
      const score = isCorrect ? pq.score : 0;
      totalScore += score;

      return {
        questionId: ans.questionId,
        score,
        isCorrect,
        maxScore: pq.score,
      };
    }).filter(Boolean);

    const maxScore = paper.totalScore;
    const passed = paper.passScore ? totalScore >= paper.passScore : totalScore > 0;

    const record = await prisma.practiceRecord.create({
      data: {
        studentId,
        paperId,
        score: totalScore,
        maxScore,
        passed,
        answers: answers as any,
        details: details as any,
        startedAt: new Date(),
        submittedAt: new Date(),
      },
    });

    // 更新错题本
    const wrong = details.filter((d): d is NonNullable<typeof d> => d !== null && !d.isCorrect);
    for (const d of wrong) {
      await prisma.wrongQuestion.upsert({
        where: { studentId_questionId: { studentId, questionId: d.questionId } },
        update: {
          wrongCount: { increment: 1 },
          lastWrongAt: new Date(),
          sourceType: 'practice',
          sourceId: record.id,
        },
        create: {
          studentId,
          questionId: d.questionId,
          sourceType: 'practice',
          sourceId: record.id,
          lastWrongAt: new Date(),
        },
      });
    }

    res.json({
      totalScore,
      maxScore,
      passed,
      details,
      recordId: record.id,
      submittedAt: record.submittedAt,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Practice submit error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/history — 练习历史
practiceRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const records = await prisma.practiceRecord.findMany({
      where: { studentId: req.user!.userId },
      include: {
        paper: { select: { id: true, name: true, totalScore: true, passScore: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json(records);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/wrong — 错题本
practiceRouter.get('/wrong', async (req: Request, res: Response) => {
  try {
    const items = await prisma.wrongQuestion.findMany({
      where: { studentId: req.user!.userId },
      include: {
        question: {
          select: { id: true, title: true, type: true, difficulty: true, score: true },
        },
      },
      orderBy: { lastWrongAt: 'desc' },
    });

    res.json(items);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/favorite — 切换收藏
practiceRouter.post('/favorite', async (req: Request, res: Response) => {
  try {
    const { questionId } = favoriteSchema.parse(req.body);
    const studentId = req.user!.userId;

    const existing = await prisma.favoriteQuestion.findUnique({
      where: { studentId_questionId: { studentId, questionId } },
    });

    if (existing) {
      await prisma.favoriteQuestion.delete({ where: { id: existing.id } });
      return res.json({ favorited: false });
    }

    await prisma.favoriteQuestion.create({ data: { studentId, questionId } });
    res.json({ favorited: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/favorite — 收藏列表
practiceRouter.get('/favorite', async (req: Request, res: Response) => {
  try {
    const items = await prisma.favoriteQuestion.findMany({
      where: { studentId: req.user!.userId },
      include: {
        question: {
          select: { id: true, title: true, type: true, difficulty: true, score: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(items);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/feedback — 题目/解析反馈
practiceRouter.post('/feedback', async (req: Request, res: Response) => {
  try {
    const { questionId, feedbackType, content } = feedbackSchema.parse(req.body);
    const studentId = req.user!.userId;

    const item = await prisma.questionFeedback.create({
      data: { studentId, questionId, feedbackType, content },
    });

    res.json(item);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
