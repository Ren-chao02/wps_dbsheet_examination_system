import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import ExcelJS from 'exceljs';

export const statisticsRouter = Router();
statisticsRouter.use(authenticate);
statisticsRouter.use(authorize('teacher', 'admin'));

// 题目类型中文标签
const QUESTION_TYPE_LABELS: Record<string, string> = {
  create_table: '建表',
  add_field: '字段',
  config_view: '视图',
  create_form: '表单',
  comprehensive: '综合',
};

// 答卷状态中文标签
const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  pending: '未开始',
  in_progress: '作答中',
  submitted: '已提交·待评分',
  grading: '阅卷中',
  graded: '已评分',
};

// 格式化为 yyyy-MM-dd HH:mm:ss
function formatDateTime(d?: Date | string | null): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// 计算用时分（不足 1 分钟按 1 分钟计）
function calcDuration(start?: Date | null, submitted?: Date | null): string {
  if (!start || !submitted) return '';
  const ms = new Date(submitted).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  return String(Math.max(1, Math.round(ms / 60000)));
}

// 竞赛式并列排名：scores 需为降序；同分同名次，后续名次跳号（1,1,3）
function competitionRank(sortedDesc: number[], score: number): number | '' {
  const index = sortedDesc.indexOf(score);
  return index === -1 ? '' : index + 1;
}

// 汇总表头通用样式
function applyHeaderStyle(ws: ExcelJS.Worksheet, headerRow: number) {
  const row = ws.getRow(headerRow);
  row.height = 22;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1890FF' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
      right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
    };
  });
}

// GET /api/statistics/overview — 总览
statisticsRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    // ✅ 教师只能看到自己负责的班级学生和自己创建的考试；admin 看全部
    const isTeacher = req.user!.role === 'teacher';
    let teacherClassIds: string[] = [];
    if (isTeacher) {
      const teacherClasses = await prisma.teacherClass.findMany({
        where: { teacherId: req.user!.userId },
        select: { classId: true },
      });
      teacherClassIds = teacherClasses.map(tc => tc.classId);
    }

    const studentWhere = isTeacher
      ? { role: 'student' as const, classRoomId: { in: teacherClassIds } }
      : { role: 'student' as const };

    const examWhere = isTeacher
      ? { createdBy: req.user!.userId }
      : {};

    const [
      totalStudents,
      totalTeachers,
      totalQuestions,
      totalExams,
      totalSubmissions,
      gradedSubmissions,
      recentExams,
    ] = await Promise.all([
      prisma.user.count({ where: studentWhere }),
      prisma.user.count({ where: { role: 'teacher' } }),
      prisma.question.count({ where: { status: 'published' } }),
      prisma.exam.count({ where: examWhere }),
      prisma.studentSubmission.count({
        where: isTeacher ? { exam: { createdBy: req.user!.userId } } : {},
      }),
      prisma.studentSubmission.count({
        where: isTeacher
          ? { exam: { createdBy: req.user!.userId }, status: 'graded' }
          : { status: 'graded' },
      }),
      prisma.exam.findMany({
        where: examWhere,
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
    // ✅ 修复Bug#3：移除非空断言操作符，使用局部变量确保类型收窄
    const { passScore } = exam;
    const passRate = (passScore != null && graded.length > 0)
      ? Math.round((graded.filter(s => (s.totalScore ?? 0) >= passScore).length / graded.length) * 100)
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

// GET /api/statistics/exam/:examId/export — 导出成绩分析报告（.xlsx，三 Sheet）
statisticsRouter.get('/exam/:examId/export', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.examId },
      include: {
        batch: {
          select: { name: true, examMode: true, examDuration: true },
        },
        examQuestions: {
          include: { question: { select: { id: true, title: true, type: true, score: true } } },
        },
        assignments: {
          include: {
            students: {
              include: {
                student: { select: { id: true, username: true, realName: true } },
              },
            },
          },
        },
        submissions: {
          include: {
            student: { select: { id: true, username: true, realName: true } },
            details: true,
          },
        },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }

    // 校验考试归属：teacher 只能导出自己创建的考试，admin 放行
    if (req.user!.role !== 'admin' && exam.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '无权导出该考试的成绩' });
    }

    // ── 数据准备：应考名单 = 考务分配学生 ∪ 有答卷记录的学生 ──
    const students = new Map<string, { id: string; username: string; realName: string | null }>();
    for (const assignment of exam.assignments) {
      for (const rs of assignment.students) {
        students.set(rs.student.id, rs.student);
      }
    }
    const subByStudent = new Map<string, (typeof exam.submissions)[number]>();
    for (const sub of exam.submissions) {
      students.set(sub.student.id, sub.student);
      subByStudent.set(sub.studentId, sub);
    }
    if (students.size === 0) {
      return res.status(400).json({ message: '该考试暂无应考学生或答卷，无法导出' });
    }

    const totalScore = exam.totalScore || 0;
    const passScore = exam.passScore;

    // 已评分答卷的分数（降序，用于汇总与并列排名）
    const gradedScores = exam.submissions
      .filter(s => s.status === 'graded' && s.totalScore != null)
      .map(s => s.totalScore as number)
      .sort((a, b) => b - a);
    const gradedCount = gradedScores.length;
    const scoreSum = gradedScores.reduce((a, b) => a + b, 0);
    const avgScore = gradedCount > 0 ? Math.round(scoreSum / gradedCount) : 0;
    const maxScore = gradedCount > 0 ? gradedScores[0] : 0;
    const minScore = gradedCount > 0 ? gradedScores[gradedScores.length - 1] : 0;
    const passCount = passScore != null
      ? gradedScores.filter(s => s >= passScore).length
      : null;

    const distribution = {
      '0-59': gradedScores.filter(s => s < 60).length,
      '60-69': gradedScores.filter(s => s >= 60 && s < 70).length,
      '70-79': gradedScores.filter(s => s >= 70 && s < 80).length,
      '80-89': gradedScores.filter(s => s >= 80 && s < 90).length,
      '90-100': gradedScores.filter(s => s >= 90).length,
    };

    // 每题配置：满分 = scoreOverride ?? question.score
    const questionCols = exam.examQuestions.map(eq => ({
      questionId: eq.questionId,
      title: eq.question.title,
      type: QUESTION_TYPE_LABELS[eq.question.type] || eq.question.type,
      maxScore: eq.scoreOverride ?? eq.question.score,
    }));

    // 题目统计（口径与页面「题目分析」一致，均基于已评分答卷）
    const questionStats = questionCols.map(qc => {
      const details = exam.submissions
        .filter(s => s.status === 'graded')
        .flatMap(s => s.details.filter(d => d.questionId === qc.questionId));
      const correctCount = details.filter(d => d.isCorrect).length;
      return {
        ...qc,
        answerCount: details.length,
        correctCount,
        correctRate: details.length > 0 ? Math.round((correctCount / details.length) * 100) : 0,
        avgScore: details.length > 0
          ? Math.round(details.reduce((s, d) => s + (d.score ?? 0), 0) / details.length * 100) / 100
          : 0,
      };
    });

    // 学生行：已评分优先按分数降序，其余按学号
    const statusOf = (sub: (typeof exam.submissions)[number] | null) =>
      sub ? SUBMISSION_STATUS_LABELS[sub.status] || sub.status : '缺考';

    const entries = Array.from(students.values()).map(st => ({ ...st, sub: subByStudent.get(st.id) ?? null }));
    const gradedEntries = entries
      .filter(e => e.sub?.status === 'graded')
      .sort((a, b) => (b.sub!.totalScore ?? 0) - (a.sub!.totalScore ?? 0) || a.username.localeCompare(b.username));
    const otherEntries = entries
      .filter(e => e.sub?.status !== 'graded')
      .sort((a, b) => a.username.localeCompare(b.username));
    const ordered = [...gradedEntries, ...otherEntries];

    // ── 生成工作簿 ──
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '考试系统';
    workbook.created = new Date();

    // ── Sheet1: 考试汇总 ──
    const ws1 = workbook.addWorksheet('考试汇总');
    ws1.columns = [
      { width: 16 }, { width: 40 }, { width: 16 }, { width: 18 }, { width: 14 },
    ];
    ws1.getCell('A1').value = `${exam.title} · 成绩分析报告`;
    ws1.getCell('A1').font = { bold: true, size: 14 };
    ws1.mergeCells('A1:E1');
    ws1.getCell('A2').value = `导出时间：${formatDateTime(new Date())}`;
    ws1.getCell('A2').font = { color: { argb: 'FF808080' }, size: 10 };

    let rowNo = 4;
    const kv: Array<[string, string | number]> = [
      ['考试名称', exam.title],
      ['所属批次', exam.batch?.name || '—'],
      ['考试模式', exam.batch?.examMode === 'flexible' ? '随到随考' : exam.batch?.examMode === 'unified' ? '集中统一' : exam.mode],
      ['开始时间', formatDateTime(exam.startTime)],
      ['结束时间', formatDateTime(exam.endTime)],
      ['考试时长', `${exam.durationMinutes ?? exam.batch?.examDuration ?? '-'} 分钟`],
      ['满分', totalScore],
      ['及格分', passScore != null ? `${passScore} 分` : '未设置'],
      ['应考人数', students.size],
      ['已交卷人数', exam.submissions.filter(s => s.submittedAt).length],
      ['缺考(未交卷)人数', students.size - exam.submissions.filter(s => s.submittedAt).length],
      ['已评分答卷数', gradedCount],
      ['平均分', gradedCount > 0 ? `${avgScore} / ${totalScore}` : '—'],
      ['最高分', gradedCount > 0 ? maxScore : '—'],
      ['最低分', gradedCount > 0 ? minScore : '—'],
      ['及格人数', passCount != null ? passCount : '—'],
      ['及格率', passCount != null && gradedCount > 0 ? `${Math.round((passCount / gradedCount) * 100)}%` : '—'],
    ];
    for (const [label, value] of kv) {
      ws1.getCell(`A${rowNo}`).value = label;
      ws1.getCell(`A${rowNo}`).font = { bold: true };
      ws1.getCell(`B${rowNo}`).value = value;
      ws1.mergeCells(`B${rowNo}:E${rowNo}`);
      rowNo++;
    }
    if (passScore == null) {
      ws1.getCell(`A${rowNo}`).value = '提示';
      ws1.getCell(`A${rowNo}`).font = { bold: true, color: { argb: 'FFFF4D4F' } };
      ws1.getCell(`B${rowNo}`).value = '本场考试未配置及格分，Sheet2 中的及格状态不做判定。';
      ws1.getCell(`B${rowNo}`).font = { color: { argb: 'FFFF4D4F' } };
      ws1.mergeCells(`B${rowNo}:E${rowNo}`);
      rowNo++;
    }

    // 分数段分布
    rowNo += 1;
    ws1.getCell(`A${rowNo}`).value = '分数段分布';
    ws1.getCell(`A${rowNo}`).font = { bold: true, size: 12 };
    rowNo++;
    ws1.getCell(`A${rowNo}`).value = '分数段';
    ws1.getCell(`B${rowNo}`).value = '人数';
    applyHeaderStyle(ws1, rowNo);
    const distHeaderRow = rowNo;
    rowNo++;
    for (const [range, count] of Object.entries(distribution)) {
      ws1.getCell(`A${rowNo}`).value = range;
      ws1.getCell(`B${rowNo}`).value = count;
      rowNo++;
    }
    ws1.autoFilter = `A${distHeaderRow}:B${rowNo - 1}`;

    // ── Sheet2: 学生成绩明细 ──
    const ws2 = workbook.addWorksheet('学生成绩明细');
    const baseCols = [
      '序号', '姓名', '学号', '状态', '得分', '满分', '得分率(%)', '及格状态', '排名',
      '开始时间', '提交时间', '用时(分钟)',
    ];
    const header2 = [...baseCols, ...questionCols.map(qc => `${qc.title}（${qc.type}）`)];
    ws2.columns = header2.map(h => ({ header: h }));

    ordered.forEach((e, index) => {
      const sub = e.sub;
      const isGraded = sub?.status === 'graded' && sub.totalScore != null;
      const score = isGraded ? (sub.totalScore as number) : null;
      const detailCells = questionCols.map(qc => {
        if (!sub) return '';
        const detail = sub.details.find(d => d.questionId === qc.questionId);
        if (!detail || detail.score == null || qc.maxScore <= 0) return '';
        const rate = Math.round((detail.score / qc.maxScore) * 100);
        return `${detail.score}/${qc.maxScore} (${rate}%)`;
      });
      ws2.addRow([
        index + 1,
        e.realName || e.username,
        e.username,
        statusOf(sub),
        score ?? '',
        totalScore,
        score != null && totalScore > 0 ? Math.round((score / totalScore) * 100) : '',
        !sub ? '' : (isGraded && passScore != null)
          ? (score! >= passScore ? '及格' : '不及格')
          : (passScore == null ? '未设置' : ''),
        isGraded ? competitionRank(gradedScores, score!) : '',
        formatDateTime(sub?.startedAt),
        formatDateTime(sub?.submittedAt),
        calcDuration(sub?.startedAt, sub?.submittedAt),
        ...detailCells,
      ]);
    });
    applyHeaderStyle(ws2, 1);
    ws2.views = [{ state: 'frozen', ySplit: 1 }];
    // 列宽（基础列固定，题目列给到适合阅读的宽度）
    const colWidths = [5, 12, 14, 14, 8, 8, 10, 10, 8, 20, 20, 10];
    for (let i = 0; i < header2.length; i++) {
      ws2.getColumn(i + 1).width = i < colWidths.length ? colWidths[i] : 26;
    }
    ws2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: header2.length },
    };

    // ── Sheet3: 题目统计 ──
    const ws3 = workbook.addWorksheet('题目统计');
    ws3.columns = [
      { header: '序号', width: 6 },
      { header: '题目', width: 50 },
      { header: '类型', width: 10 },
      { header: '满分', width: 8 },
      { header: '答题数', width: 8 },
      { header: '正确数', width: 8 },
      { header: '正确率(%)', width: 10 },
      { header: '均分', width: 8 },
    ];
    questionStats.forEach((qs, index) => {
      ws3.addRow([
        index + 1,
        qs.title,
        qs.type,
        qs.maxScore,
        qs.answerCount,
        qs.correctCount,
        qs.correctRate,
        qs.avgScore,
      ]);
    });
    applyHeaderStyle(ws3, 1);
    ws3.views = [{ state: 'frozen', ySplit: 1 }];

    const fileName = encodeURIComponent(`${exam.title}_成绩分析.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
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
