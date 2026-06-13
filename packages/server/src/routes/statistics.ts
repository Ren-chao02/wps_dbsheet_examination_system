import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const statisticsRouter = Router();
statisticsRouter.use(authenticate);
statisticsRouter.use(authorize('teacher', 'admin'));

// GET /api/statistics/overview — 总览
statisticsRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    const [
      totalStudents,
      totalTeachers,
      totalQuestions,
      totalExams,
      totalSubmissions,
      gradedSubmissions,
      recentExams,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'student' } }),
      prisma.user.count({ where: { role: 'teacher' } }),
      prisma.question.count({ where: { status: 'published' } }),
      prisma.exam.count(),
      prisma.studentSubmission.count(),
      prisma.studentSubmission.count({ where: { status: 'graded' } }),
      prisma.exam.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { submissions: true } },
        },
      }),
    ]);

    res.json({
      totalStudents,
      totalTeachers,
      totalQuestions,
      totalExams,
      totalSubmissions,
      gradedSubmissions,
      gradingRate: totalSubmissions > 0
        ? Math.round((gradedSubmissions / totalSubmissions) * 100)
        : 0,
      recentExams,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/statistics/exam/:examId — 单场考试分析
statisticsRouter.get('/exam/:examId', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.examId },
      include: {
        examQuestions: {
          include: {
            question: { select: { id: true, title: true, type: true, score: true } },
          },
        },
        submissions: {
          where: { status: 'graded' },
          include: {
            student: { select: { id: true, realName: true } },
          },
        },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }

    const graded = exam.submissions;
    const scores = graded.map(s => s.totalScore ?? 0).sort((a, b) => a - b);

    // Score distribution
    const distribution = {
      '0-59': scores.filter(s => s < 60).length,
      '60-69': scores.filter(s => s >= 60 && s < 70).length,
      '70-79': scores.filter(s => s >= 70 && s < 80).length,
      '80-89': scores.filter(s => s >= 80 && s < 90).length,
      '90-100': scores.filter(s => s >= 90).length,
    };

    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    const maxScore = scores.length > 0 ? scores[scores.length - 1] : 0;
    const minScore = scores.length > 0 ? scores[0] : 0;
    const passRate = exam.passScore && graded.length > 0
      ? Math.round((graded.filter(s => (s.totalScore ?? 0) >= exam.passScore!).length / graded.length) * 100)
      : null;

    // Per-question stats
    const questionStats = await Promise.all(
      exam.examQuestions.map(async eq => {
        const details = await prisma.submissionDetail.findMany({
          where: {
            submission: { examId: exam.id, status: 'graded' },
            questionId: eq.questionId,
          },
        });

        const correctCount = details.filter(d => d.isCorrect).length;
        const avgQuestionScore = details.length > 0
          ? Math.round(details.reduce((s, d) => s + (d.score ?? 0), 0) / details.length * 100) / 100
          : 0;

        return {
          questionId: eq.questionId,
          title: eq.question.title,
          type: eq.question.type,
          maxScore: eq.scoreOverride ?? eq.question.score,
          answerCount: details.length,
          correctCount,
          correctRate: details.length > 0
            ? Math.round((correctCount / details.length) * 100)
            : 0,
          avgScore: avgQuestionScore,
        };
      })
    );

    res.json({
      examId: exam.id,
      examTitle: exam.title,
      totalScore: exam.totalScore,
      passScore: exam.passScore,
      submissionCount: graded.length,
      avgScore,
      maxScore,
      minScore,
      passRate,
      distribution,
      questionStats,
      submissions: graded.map(s => ({
        id: s.id,
        studentName: s.student.realName || s.student.id,
        score: s.totalScore,
        submittedAt: s.submittedAt,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/statistics/student/:studentId
statisticsRouter.get('/student/:studentId', async (req: Request, res: Response) => {
  try {
    const student = await prisma.user.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, username: true, realName: true },
    });

    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }

    const submissions = await prisma.studentSubmission.findMany({
      where: { studentId: req.params.studentId, status: 'graded' },
      include: {
        exam: { select: { id: true, title: true, totalScore: true, passScore: true, mode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalExams = submissions.length;
    const avgScore = totalExams > 0
      ? Math.round(submissions.reduce((s, sub) => s + (sub.totalScore ?? 0), 0) / totalExams)
      : 0;

    const passedExams = submissions.filter(s =>
      s.exam.passScore && (s.totalScore ?? 0) >= s.exam.passScore
    ).length;

    res.json({
      student,
      totalExams,
      avgScore,
      passedExams,
      passRate: totalExams > 0 ? Math.round((passedExams / totalExams) * 100) : 0,
      submissions: submissions.map(s => ({
        examTitle: s.exam.title,
        mode: s.exam.mode,
        score: s.totalScore,
        passScore: s.exam.passScore,
        passed: s.exam.passScore ? (s.totalScore ?? 0) >= s.exam.passScore : null,
        submittedAt: s.submittedAt,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
