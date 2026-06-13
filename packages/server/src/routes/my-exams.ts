import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const myExamRouter = Router();
myExamRouter.use(authenticate);
myExamRouter.use(authorize('student'));

// GET /api/my-exams — 学生的考试列表
myExamRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status } = req.query;

    const where: any = {};
    // Only show published/in_progress/ended exams
    if (status) {
      where.status = String(status);
    } else {
      where.status = { in: ['published', 'in_progress', 'ended'] };
    }

    const exams = await prisma.exam.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        mode: true,
        durationMinutes: true,
        startTime: true,
        endTime: true,
        totalScore: true,
        passScore: true,
        status: true,
        creator: { select: { realName: true } },
        _count: { select: { examQuestions: true } },
      },
    });

    // Check which exams the student has submissions for
    const submissions = await prisma.studentSubmission.findMany({
      where: {
        studentId: req.user!.userId,
        examId: { in: exams.map(e => e.id) },
      },
    });

    const subMap = new Map(submissions.map(s => [s.examId, s]));

    res.json(exams.map(exam => ({
      ...exam,
      mySubmission: subMap.get(exam.id) ? {
        id: subMap.get(exam.id)!.id,
        status: subMap.get(exam.id)!.status,
        totalScore: subMap.get(exam.id)!.totalScore,
        startedAt: subMap.get(exam.id)!.startedAt,
        submittedAt: subMap.get(exam.id)!.submittedAt,
      } : null,
    })));
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/my-exams/:id — 考试详情（含题目）
myExamRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        title: true,
        description: true,
        mode: true,
        durationMinutes: true,
        startTime: true,
        endTime: true,
        totalScore: true,
        passScore: true,
        status: true,
        settings: true,
        creator: { select: { realName: true } },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }

    // Get the student's submission
    const submission = await prisma.studentSubmission.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
      include: {
        details: {
          include: {
            question: {
              select: {
                id: true,
                title: true,
                description: true,
                type: true,
                score: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Get exam questions (for ExamDoing page to load questions on resume)
    const examQuestions = await prisma.examQuestion.findMany({
      where: { examId: req.params.id },
      include: { question: true },
      orderBy: { sortOrder: 'asc' },
    });

    const questions = examQuestions.map(eq => ({
      ...eq.question,
      scoreOverride: eq.scoreOverride,
      sortOrder: eq.sortOrder,
    }));

    res.json({ exam, submission, questions });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/my-exams/:id/start — 开始答题
myExamRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        examQuestions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'published' && exam.status !== 'in_progress') {
      return res.status(400).json({ message: '考试未发布或已结束' });
    }

    // Check if already has submission
    const existing = await prisma.studentSubmission.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });

    if (existing) {
      return res.json({
        submission: existing,
        questions: exam.examQuestions.map(eq => ({
          ...eq.question,
          scoreOverride: eq.scoreOverride,
          sortOrder: eq.sortOrder,
        })),
      });
    }

    // Create submission
    const submission = await prisma.studentSubmission.create({
      data: {
        examId: req.params.id,
        studentId: req.user!.userId,
        status: 'in_progress',
        startedAt: new Date(),
        details: {
          create: exam.examQuestions.map(eq => ({
            questionId: eq.questionId,
          })),
        },
      },
      include: {
        details: true,
      },
    });

    // Create exam session
    await prisma.examSession.create({
      data: {
        submissionId: submission.id,
        studentId: req.user!.userId,
        examId: req.params.id,
      },
    });

    res.json({
      submission,
      questions: exam.examQuestions.map(eq => ({
        ...eq.question,
        scoreOverride: eq.scoreOverride,
        sortOrder: eq.sortOrder,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/my-exams/:id/submit — 提交答卷
myExamRouter.post('/:id/submit', async (req: Request, res: Response) => {
  try {
    const submission = await prisma.studentSubmission.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });

    if (!submission) {
      return res.status(404).json({ message: '未找到答题记录，请先开始答题' });
    }
    if (submission.status === 'submitted' || submission.status === 'graded') {
      return res.status(400).json({ message: '已提交，无法重复提交' });
    }

    const updated = await prisma.studentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
      },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/my-exams/:id/result — 查看成绩
myExamRouter.get('/:id/result', async (req: Request, res: Response) => {
  try {
    const submission = await prisma.studentSubmission.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
      include: {
        exam: {
          select: { title: true, totalScore: true, passScore: true },
        },
        details: {
          include: {
            question: {
              select: { id: true, title: true, type: true, score: true },
            },
            verificationResults: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        verificationResults: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: '未找到答题记录' });
    }

    if (submission.status !== 'graded') {
      return res.json({
        submission: {
          id: submission.id,
          status: submission.status,
          exam: submission.exam,
        },
        message: '尚未完成评分',
      });
    }

    res.json(submission);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
