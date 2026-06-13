import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { enqueueGrading, enqueueExamGrading } from '../jobs/grading-queue';
import { gradeSubmission } from '../services/grading-service';

export const gradingRouter = Router();
gradingRouter.use(authenticate);

// POST /api/grading/batch/:examId — 批量自动判分（具体路径必须在参数路径前）
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

    // 逐份执行自动判分（异步）
    const results = [];
    const errors = [];

    for (const sub of submissions) {
      try {
        const result = await gradeSubmission(sub.id);
        results.push(result);
      } catch (err: any) {
        errors.push({ submissionId: sub.id, error: err.message });
      }
    }

    res.json({
      message: `批量判分完成：成功 ${results.length} 份，失败 ${errors.length} 份`,
      total: submissions.length,
      success: results.length,
      failed: errors.length,
      results: results.map(r => ({
        submissionId: r.submissionId,
        totalScore: r.totalScore,
        maxScore: r.maxScore,
        hasNeedsReview: r.hasNeedsReview,
        needsReviewCount: r.needsReviewCount,
      })),
      errors,
    });
  } catch (err: any) {
    res.status(500).json({ message: '服务器错误', detail: err.message });
  }
});

// GET /api/grading/:submissionId — 查看判分详情（含验证结果）
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
            verificationResults: {
              orderBy: { verifiedAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        verificationResults: {
          orderBy: { verifiedAt: 'asc' },
        },
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

// POST /api/grading/:submissionId — 触发自动判分
gradingRouter.post('/:submissionId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: req.params.submissionId },
    });

    if (!submission) {
      return res.status(404).json({ message: '答卷不存在' });
    }
    if (submission.status !== 'submitted' && submission.status !== 'grading') {
      return res.status(400).json({ message: '答卷状态不允许判分（需为 submitted 或 grading）' });
    }

    // 清除旧的验证结果（重新判分）
    await prisma.verificationResult.deleteMany({
      where: { submissionId: req.params.submissionId },
    });

    // 执行自动判分
    const result = await gradeSubmission(req.params.submissionId);

    res.json({
      message: result.hasNeedsReview
        ? `自动判分完成，有 ${result.needsReviewCount} 条规则需人工复核`
        : '自动判分完成',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ message: '判分失败', detail: err.message });
  }
});

const overrideSchema = z.object({
  score: z.number().int().min(0).optional(),
  isCorrect: z.boolean().optional(),
});

// POST /api/grading/:submissionId/detail/:detailId — 手动对某道题打分（含复核 needsReview）
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

// POST /api/grading/:submissionId/review/:detailId — 复核 needsReview 的规则
gradingRouter.post('/:submissionId/review/:detailId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const reviewSchema = z.object({
      ruleId: z.string(),
      passed: z.boolean(),
      score: z.number().int().min(0),
    });
    const { ruleId, passed, score } = reviewSchema.parse(req.body);

    // 更新对应的 verification result
    await prisma.verificationResult.updateMany({
      where: {
        submissionDetailId: req.params.detailId,
        submissionId: req.params.submissionId,
        ruleId,
      },
      data: {
        passed,
        score,
        needsReview: false,
      },
    });

    // 重新计算该题的总分
    const allResults = await prisma.verificationResult.findMany({
      where: {
        submissionDetailId: req.params.detailId,
      },
    });

    const questionScore = allResults.reduce((sum, r) => sum + (r.passed ? r.score : 0), 0);
    const allPassed = allResults.every(r => r.passed);
    const hasReview = allResults.some(r => r.needsReview);

    await prisma.submissionDetail.update({
      where: { id: req.params.detailId },
      data: {
        score: hasReview ? null : questionScore,
        isCorrect: hasReview ? null : allPassed,
      },
    });

    res.json({ message: '复核完成', score: questionScore, isCorrect: allPassed });
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
