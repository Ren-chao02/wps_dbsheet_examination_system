import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const gradingRouter = Router();
gradingRouter.use(authenticate);

// POST /api/grading/batch/:examId — 批量开始评分（具体路径必须在参数路径前）
gradingRouter.post('/batch/:examId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.studentSubmission.findMany({
      where: {
        examId: req.params.examId,
        status: 'submitted',
      },
    });

    if (submissions.length === 0) {
      return res.status(400).json({ message: '没有待评分的答卷' });
    }

    // Set all to grading
    await prisma.studentSubmission.updateMany({
      where: {
        examId: req.params.examId,
        status: 'submitted',
      },
      data: { status: 'grading' },
    });

    res.json({ message: `已将 ${submissions.length} 份答卷设为评分中` });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/grading/:submissionId — 查看判分详情
gradingRouter.get('/:submissionId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userRole = req.user!.role;

    const submission = await prisma.studentSubmission.findUnique({
      where: { id: req.params.submissionId },
      include: {
        exam: { select: { id: true, title: true, totalScore: true, passScore: true } },
        student: { select: { id: true, username: true, realName: true } },
        details: {
          include: {
            question: { select: { id: true, title: true, type: true, score: true, answerRules: true } },
            verificationResults: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        verificationResults: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: '答卷不存在' });
    }

    // Students can only view their own graded submissions
    if (userRole === 'student' && submission.studentId !== userId) {
      return res.status(403).json({ message: '无权查看' });
    }

    res.json(submission);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/grading/:submissionId — 触发自动判分 (目前为手动判分入口)
gradingRouter.post('/:submissionId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: req.params.submissionId },
    });

    if (!submission) {
      return res.status(404).json({ message: '答卷不存在' });
    }
    if (submission.status !== 'submitted') {
      return res.status(400).json({ message: '答卷未提交或已评分' });
    }

    // Set status to grading
    await prisma.studentSubmission.update({
      where: { id: req.params.submissionId },
      data: { status: 'grading' },
    });

    // For Phase 1: just transition to grading state (manual grading)
    // In Phase 2, this will trigger the rule engine

    res.json({ message: '已开始评分流程', submissionId: req.params.submissionId });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

const overrideSchema = z.object({
  score: z.number().int().min(0).optional(),
  isCorrect: z.boolean().optional(),
});

// POST /api/grading/:submissionId/detail/:detailId — 手动对某道题打分
gradingRouter.post('/:submissionId/detail/:detailId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const { score, isCorrect } = overrideSchema.parse(req.body);

    const detail = await prisma.submissionDetail.findFirst({
      where: {
        id: req.params.detailId,
        submissionId: req.params.submissionId,
      },
    });

    if (!detail) {
      return res.status(404).json({ message: '答题详情不存在' });
    }

    const updated = await prisma.submissionDetail.update({
      where: { id: req.params.detailId },
      data: { score, isCorrect },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/grading/:submissionId/finalize — 完成评分
gradingRouter.post('/:submissionId/finalize', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: req.params.submissionId },
      include: {
        details: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: '答卷不存在' });
    }

    // Calculate total score from details
    const totalScore = submission.details.reduce(
      (sum, d) => sum + (d.score ?? 0),
      0
    );

    const zComment = z.object({ comment: z.string().optional() });
    const { comment } = zComment.parse(req.body);

    const updated = await prisma.studentSubmission.update({
      where: { id: req.params.submissionId },
      data: {
        status: 'graded',
        totalScore,
        gradedBy: req.user!.userId,
        gradedAt: new Date(),
        graderComment: comment,
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


