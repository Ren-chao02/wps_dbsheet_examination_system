import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { enqueueGrading, enqueueExamGrading, enqueueExamGradingBatch } from '../jobs/grading-queue';
import { gradeSubmission } from '../services/grading-service';
import { checkExamAccess, checkSubmissionAccess, denyAccess } from '../middleware/exam-ownership';

/**
 * 将 WPS API 原始错误转为用户可读的友好消息
 */
function friendlyError(err: Error): string {
  const raw = err.message || '';
  if (/token.*expir|expir.*token|TokenExpired|invalid_token/i.test(raw)) {
    return 'WPS Token 已过期，请前往「WPS Token 管理」页面重新获取并回填 access_token';
  }
  if (/PermissionDenied/i.test(raw) && /access_token/i.test(raw)) {
    return 'WPS access_token 无效，请确认「WPS Token 管理」中已正确配置有效的 access_token';
  }
  if (/404 Not Found/i.test(raw)) {
    return '未找到对应的 WPS 多维表格文件，请检查学生是否已正确提交';
  }
  return `判分过程出错：${raw}`;
}

export const gradingRouter = Router();
gradingRouter.use(authenticate);

// POST /api/grading/batch/:examId — 批量自动判分（具体路径必须在参数路径前）
gradingRouter.post('/batch/:examId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.examId);
    if (access !== 'ok') return denyAccess(res, access);

    const { accessToken } = req.body;
    const submissions = await prisma.studentSubmission.findMany({
      where: {
        examId: req.params.examId,
        status: 'submitted',
      },
    });

    if (submissions.length === 0) {
      return res.status(400).json({ message: '没有待评分的答卷' });
    }

    // 优先走队列：几千人规模下同步串行判分会把 HTTP 请求挂住几十分钟，
    // 反代超时后教师必然重试，叠出多轮重复判分。
    const queued = await enqueueExamGradingBatch(req.params.examId, submissions.map(s => s.id));
    if (queued) {
      return res.json({
        queued: queued.queued,
        total: submissions.length,
        message: `已提交判分任务：${queued.queued} 份（后台处理中，可在本页刷新查看进度）`,
        async: true,
      });
    }
    // Redis 不可用：退回同步执行（小规模部署/开发环境）
    console.log('[grading/batch] Redis 不可用，回退同步串行判分');

    // 逐份执行自动判分（异步）
    const results = [];
    const errors = [];

    for (const sub of submissions) {
      try {
        const result = await gradeSubmission(sub.id, accessToken);
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
    res.status(500).json({ message: friendlyError(err) });
  }
});

// GET /api/grading/batch/:examId/progress — 批量判分的进度（按答卷状态统计）
// 与批量判分配合：入队后前端轮询本接口展示"还有多少份没判完"
gradingRouter.get('/batch/:examId/progress', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.examId);
    if (access !== 'ok') return denyAccess(res, access);

    const grouped = await prisma.studentSubmission.groupBy({
      by: ['status'],
      where: { examId: req.params.examId },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const g of grouped) counts[g.status] = g._count._all;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({
      total,
      byStatus: counts,
      pending: (counts['submitted'] ?? 0) + (counts['in_progress'] ?? 0),
      done: (counts['grading'] ?? 0) + (counts['graded'] ?? 0),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/grading/:submissionId — 查看判分详情（含验证结果）
// GET /api/grading/:submissionId — 查看判分详情（含验证结果）
//
// ⚠️ 仅教师/管理员可访问：响应里含 question.answerRules 与 verificationResults
// （expected/actual 即标准答案）。学生看成绩一律走 /api/my-exams/:id/result
// （该接口在判分完成后才返回成绩，且不含答案规则）。
gradingRouter.get('/:submissionId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
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
            // 成绩存档：本题的人工复核留痕（谁/何时/原分→新分/理由）
            reviewLogs: { orderBy: { createdAt: 'asc' } },
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

    const access = await checkSubmissionAccess(req, req.params.submissionId);
    if (access !== 'ok') return denyAccess(res, access);

    res.json(submission);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/grading/:submissionId — 触发自动判分
gradingRouter.post('/:submissionId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const access = await checkSubmissionAccess(req, req.params.submissionId);
    if (access !== 'ok') return denyAccess(res, access);

    const { accessToken } = req.body;
    const submission = await prisma.studentSubmission.findUnique({
      where: { id: req.params.submissionId },
    });

    if (!submission) {
      return res.status(404).json({ message: '答卷不存在' });
    }
    if (submission.status !== 'submitted' && submission.status !== 'grading') {
      return res.status(400).json({ message: '答卷状态不允许判分（需为 submitted 或 grading）' });
    }

    // ⚠️ 这里**不要**预删旧验证结果：清理动作已在 gradeSubmission 的事务内完成。
    // 在事务外先删，一旦判分失败（WPS token 过期是高频失败），旧结果已丢、
    // 新结果没写，教师端会看到"分数还在但明细全空"的不一致状态。
    //
    // ⚠️ 对已经是 grading（已自动判分过、可能已人工复核）的答卷重判，会重置全部题目分数，
    // 抹掉教师做过的逐题改分。因此要求调用方显式确认（前端弹确认框后再带 confirmRegrade）。
    if (submission.status === 'grading' && req.body?.confirmRegrade !== true) {
      return res.status(409).json({
        message: '该答卷已判过分（可能已有人工复核结果），重新判分会覆盖这些结果。确认要重判吗？',
        code: 'REGRADE_CONFIRM_REQUIRED',
      });
    }

    // 执行自动判分
    const result = await gradeSubmission(req.params.submissionId, accessToken);

    res.json({
      message: result.hasNeedsReview
        ? `自动判分完成，有 ${result.needsReviewCount} 条规则需人工复核`
        : '自动判分完成',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ message: friendlyError(err) });
  }
});

const overrideSchema = z.object({
  score: z.number().int().min(0).optional(),
  isCorrect: z.boolean().optional(),
});

// POST /api/grading/:submissionId/detail/:detailId — 手动对某道题打分（含复核 needsReview）
gradingRouter.post('/:submissionId/detail/:detailId', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const access = await checkSubmissionAccess(req, req.params.submissionId);
    if (access !== 'ok') return denyAccess(res, access);

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

    // 成绩存档：人工改分必须留痕（谁、何时、原分→新分），供申诉复核
    const [updated] = await prisma.$transaction([
      prisma.submissionDetail.update({
        where: { id: req.params.detailId },
        data: { score, isCorrect },
      }),
      prisma.gradeReviewLog.create({
        data: {
          submissionDetailId: detail.id,
          submissionId: detail.submissionId,
          reviewerId: req.user!.userId,
          reviewerName: req.user?.username || null,
          beforeScore: detail.score,
          afterScore: score ?? null,
          beforeCorrect: detail.isCorrect,
          afterCorrect: isCorrect ?? null,
          changeType: 'detail_override',
          reason: (req.body?.reason as string) || null,
        },
      }),
    ]);

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
    const access = await checkSubmissionAccess(req, req.params.submissionId);
    if (access !== 'ok') return denyAccess(res, access);

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

    // 规则得分是 0~100 的权重（百分制），落库前需换算回本题实际分值：
    // 本题满分 = 考试 scoreOverride ?? question.score，换算 = 规则分占比 × 本题满分
    const detail = await prisma.submissionDetail.findUnique({
      where: { id: req.params.detailId },
      include: { question: { select: { score: true, answerRules: true } } },
    });
    const rawRules = (detail?.question.answerRules as any[] | null) || [];
    const ruleSum = rawRules.reduce((s, r) => s + (r.score || 0), 0);

    const rawQuestionScore = allResults.reduce((sum, r) => sum + (r.passed ? r.score : 0), 0);
    const allPassed = allResults.every(r => r.passed);
    const hasReview = allResults.some(r => r.needsReview);

    let qMaxPoints = detail?.question.score ?? 0;
    if (detail) {
      const sub = await prisma.studentSubmission.findUnique({
        where: { id: detail.submissionId },
        select: { examId: true },
      });
      if (sub) {
        const eq = await prisma.examQuestion.findFirst({
          where: { examId: sub.examId, questionId: detail.questionId },
          select: { scoreOverride: true },
        });
        qMaxPoints = eq?.scoreOverride ?? qMaxPoints;
      }
    }

    const questionScore = !hasReview && qMaxPoints > 0 && ruleSum > 0
      ? Math.round((rawQuestionScore / ruleSum) * qMaxPoints)
      : rawQuestionScore;

    // 成绩存档：复核结果与题目分数变更一并留痕
    await prisma.$transaction([
      prisma.submissionDetail.update({
        where: { id: req.params.detailId },
        data: {
          score: hasReview ? null : questionScore,
          isCorrect: hasReview ? null : allPassed,
        },
      }),
      prisma.gradeReviewLog.create({
        data: {
          submissionDetailId: req.params.detailId,
          submissionId: req.params.submissionId,
          reviewerId: req.user!.userId,
          reviewerName: req.user?.username || null,
          beforeScore: detail?.score ?? null,
          afterScore: hasReview ? null : questionScore,
          beforeCorrect: detail?.isCorrect ?? null,
          afterCorrect: hasReview ? null : allPassed,
          changeType: 'rule_review',
          reason: `规则 ${ruleId} 复核为${passed ? '通过' : '不通过'}（${score} 分）`,
        },
      }),
    ]);

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
    const access = await checkSubmissionAccess(req, req.params.submissionId);
    if (access !== 'ok') return denyAccess(res, access);

    const submission = await prisma.studentSubmission.findUnique({
      where: { id: req.params.submissionId },
      include: {
        details: true,
      },
    });

    if (!submission) {
      return res.status(404).json({ message: '答卷不存在' });
    }

    // ⚠️ 状态守卫：只有「判分中（grading，含待人工复核）」的答卷才允许定分出成绩。
    // 否则对一份尚未自动判分的 submitted 答卷点「完成评分」，totalScore 会由
    // 全为 null 的明细求和得 0，并落成**不可逆的 graded** —— 学生成绩归零且再也无法重判。
    if (submission.status !== 'grading') {
      return res.status(400).json({
        message: submission.status === 'graded'
          ? '该答卷已完成评分，如需修改请先重新自动判分'
          : '该答卷尚未完成自动判分，请先执行「自动阅卷」再定分',
      });
    }

    // Calculate total score from details
    const totalScore = submission.details.reduce(
      (sum, d) => sum + (d.score ?? 0),
      0
    );

    const zComment = z.object({ comment: z.string().optional() });
    const { comment } = zComment.parse(req.body);

    // 条件更新：与自动判分并发时，后写者不会覆盖已变化的状态
    const result = await prisma.studentSubmission.updateMany({
      where: { id: req.params.submissionId, status: 'grading' },
      data: {
        status: 'graded',
        totalScore,
        gradedBy: req.user!.userId,
        gradedAt: new Date(),
        graderComment: comment,
      },
    });
    // 「定分」这一动作本身的存档由 StudentSubmission 承载
    // （gradedBy / gradedAt / totalScore / graderComment 即完整记录），
    // 因此这里不再往 GradeReviewLog 写一行——该表只记录**题目分数的人工变更**，
    // 语义更干净：查这张表就是"哪些题被人改过"。
    if (result.count === 0) {
      return res.status(409).json({ message: '答卷状态已变化，请刷新后重试' });
    }
    const updated = await prisma.studentSubmission.findUnique({ where: { id: req.params.submissionId } });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
