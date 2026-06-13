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
        studentId: s.student.id,
        studentName: s.student.realName || s.student.id,
        score: s.totalScore,
        submittedAt: s.submittedAt,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/statistics/exam/:examId/export — CSV 导出
statisticsRouter.get('/exam/:examId/export', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.examId },
      include: {
        examQuestions: {
          include: { question: { select: { title: true, type: true, score: true } } },
        },
        submissions: {
          where: { status: 'graded' },
          include: {
            student: { select: { username: true, realName: true } },
            details: {
              include: { question: { select: { title: true } } },
            },
          },
        },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }

    const BOM = '\ufeff'; // UTF-8 BOM for Excel compatibility
    const headers = ['学生姓名', '学号', '总分', '得分', '通过率', '开始时间', '提交时间'];

    // Add per-question columns
    exam.examQuestions.forEach(eq => {
      headers.push(`${eq.question.title}(${eq.question.type})`);
    });

    const rows = exam.submissions.map(sub => {
      const row = [
        sub.student.realName || sub.student.username,
        sub.student.username,
        String(exam.totalScore),
        String(sub.totalScore ?? ''),
        sub.totalScore !== null ? `${Math.round((sub.totalScore / exam.totalScore) * 100)}%` : '',
        sub.startedAt ? new Date(sub.startedAt).toLocaleString('zh-CN') : '',
        sub.submittedAt ? new Date(sub.submittedAt).toLocaleString('zh-CN') : '',
      ];

      // Add per-question scores
      exam.examQuestions.forEach(eq => {
        const detail = sub.details.find(d => d.questionId === eq.questionId);
        row.push(detail ? `${detail.score ?? ''}/${eq.scoreOverride ?? eq.question.score}` : '');
      });

      return row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
    });

    const csv = BOM + headers.map(h => `"${h}"`).join(',') + '\n' + rows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(exam.title)}_成绩.csv"`);
    res.send(csv);
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
        details: {
          include: {
            question: { select: { type: true, score: true } },
          },
        },
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
      // Ability radar: per question type correct rate
      abilityRadar: (() => {
        const typeMap: Record<string, { total: number; correct: number }> = {};
        submissions.forEach(s => {
          s.details.forEach(d => {
            const type = d.question.type;
            if (!typeMap[type]) typeMap[type] = { total: 0, correct: 0 };
            typeMap[type].total++;
            if (d.isCorrect) typeMap[type].correct++;
          });
        });

        const labels: Record<string, string> = {
          create_table: '建表',
          add_field: '字段',
          config_view: '视图',
          create_form: '表单',
          comprehensive: '综合',
        };

        return Object.entries(typeMap).map(([type, data]) => ({
          type: labels[type] || type,
          rate: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
        }));
      })(),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
