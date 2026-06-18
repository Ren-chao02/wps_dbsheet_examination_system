import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const practiceRouter = Router();
practiceRouter.use(authenticate);
practiceRouter.use(authorize('student'));

const practiceSubmitSchema = z.object({
  paperId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    answerJson: z.record(z.any()).default({}),
  })),
});

// POST /api/practice/submit — 提交练习
practiceRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const { paperId, answers } = practiceSubmitSchema.parse(req.body);

    // Load paper with questions and answer rules
    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        paperQuestions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    // Score each answer (simplified scoring - in real system would use verification engine)
    let totalScore = 0;
    const details = answers.map(ans => {
      const pq = paper.paperQuestions.find(pq => pq.questionId === ans.questionId);
      if (!pq) return null;

      // Simple scoring logic: if answer has content, give partial/full score
      // In production, this would use the verification engine for actual WPS operations
      const hasAnswer = Object.keys(ans.answerJson || {}).length > 0;
      const isCorrect = hasAnswer; // Simplified: any non-empty answer is considered correct for practice
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

    // Save practice record (optional - could be stored separately)
    // For now, just return the result

    res.json({
      totalScore,
      maxScore,
      passed,
      details,
      submittedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Practice submit error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/history — 练习历史（可选）
practiceRouter.get('/history', async (req: Request, res: Response) => {
  try {
    // Practice history can be stored as exam records with mode='practice'
    const practices = await prisma.exam.findMany({
      where: {
        mode: 'practice',
        status: { in: ['ended'] },
        submissions: {
          some: { studentId: req.user!.userId },
        },
      },
      include: {
        creator: { select: { realName: true } },
        submissions: {
          where: { studentId: req.user!.userId },
          select: { id: true, totalScore: true, submittedAt: true, status: true },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    res.json(practices);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
