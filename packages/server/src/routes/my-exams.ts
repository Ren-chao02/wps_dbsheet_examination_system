import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { hashString, shuffleWithSeed } from '../utils/helpers';
import { isIpAllowed } from '../utils/ip-utils';

import { autoEndExpiredExams, studentExamVisibilityOR } from '../utils/exam-utils';

export const myExamRouter = Router();
myExamRouter.use(authenticate);
myExamRouter.use(authorize('student'));

/**
 * 学生侧状态映射：弱化"评分中"的全局属性。
 * grading 是阅卷环节的内部状态，学生无需感知，统一映射为 submitted（已提交），
 * 简化学生侧状态流转链路，减少不一致概率。
 * 教师侧仍可看到真实 grading 状态（见 grading 路由）。
 */
function studentFacingStatus(status: string): string {
  return status === 'grading' ? 'submitted' : status;
}

// GET /api/my-exams — 学生的考试列表
myExamRouter.get('/', async (req: Request, res: Response) => {
  try {
    await autoEndExpiredExams();

    const { status } = req.query;

    const where: any = {};
    // Only show published/in_progress/ended exams
    if (status) {
      where.status = String(status);
    } else {
      where.status = { in: ['published', 'in_progress', 'ended'] };
    }
    // 可见性过滤口径与 student-profile / history 一致（见 studentExamVisibilityOR）
    where.OR = studentExamVisibilityOR(req.user!.userId);

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
        batch: { select: { name: true, startTime: true, endTime: true, examDuration: true, examMode: true, lateTolerance: true, waitingTime: true } },
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

    // Get the student's assigned room for each exam
    const examIds = exams.map(e => e.id);
    const roomAssignments = await prisma.examRoomStudent.findMany({
      where: {
        studentId: req.user!.userId,
        assignment: { examId: { in: examIds } },
      },
      include: {
        assignment: {
          include: {
            room: { select: { name: true } },
          },
        },
      },
    });
    const roomMap = new Map(roomAssignments.map(r => [r.assignment.examId, r.assignment.room.name]));

    res.json(exams.map(exam => ({
      ...exam,
      roomName: roomMap.get(exam.id) || null,
      mySubmission: subMap.get(exam.id) ? {
        id: subMap.get(exam.id)!.id,
        status: studentFacingStatus(subMap.get(exam.id)!.status),
        totalScore: subMap.get(exam.id)!.totalScore,
        startedAt: subMap.get(exam.id)!.startedAt,
        submittedAt: subMap.get(exam.id)!.submittedAt,
      } : null,
    })));
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/my-exams/history — 学生的成绩历史（仅已评分）
// 注意：必须定义在 /:id 之前，否则 /history 会被 :id 参数路由匹配
myExamRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const submissions = await prisma.studentSubmission.findMany({
      where: {
        studentId: req.user!.userId,
        status: 'graded',
        exam: {
          status: { in: ['published', 'in_progress', 'ended'] },
          OR: studentExamVisibilityOR(req.user!.userId),
        },
      },
      orderBy: { gradedAt: 'desc' },
      select: {
        id: true,
        status: true,
        totalScore: true,
        submittedAt: true,
        gradedAt: true,
        graderComment: true,
        exam: {
          select: {
            id: true,
            title: true,
            totalScore: true,
            passScore: true,
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    res.json(submissions);
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
        batch: {
          select: {
            name: true,
            examMode: true,
            startTime: true,
            endTime: true,
            waitingTime: true,
            lateTolerance: true,
            ipLimitEnabled: true,
            freezeMinutes: true,
            exitPolicy: true,
            exitMaxCount: true,
            exitMaxMinutes: true,
            rulesContent: true,
            rulesReadSeconds: true,
          },
        },
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

    // Get exam questions (for the exam doing page to load questions on resume)
    let examQuestions = await prisma.examQuestion.findMany({
      where: { examId: req.params.id },
      include: { question: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Shuffle questions if exam settings has shuffleQuestions
    const settings = (exam?.settings || {}) as any;
    if (settings.shuffleQuestions) {
      const seed = hashString(req.params.id + req.user!.userId);
      examQuestions = shuffleWithSeed(examQuestions, seed);
    }

    const questions = examQuestions.map(eq => ({
      ...eq.question,
      scoreOverride: eq.scoreOverride,
      sortOrder: eq.sortOrder,
    }));

    // 查询 WPS 表格分配信息（用于 WPS 实操版界面）
    let wpsTable: { shareUrl: string; fileId: string } | null = null;
    const tableAssignment = await prisma.examTableAssignment.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });
    if (tableAssignment?.shareUrl) {
      wpsTable = { shareUrl: tableAssignment.shareUrl, fileId: tableAssignment.fileId };
    }

    res.json({ exam, submission, questions, wpsTable });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});


// POST /api/my-exams/:id/start-wps — 开始 WPS 实操考试
myExamRouter.post('/:id/start-wps', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        batch: { select: { status: true, ipLimitEnabled: true, allowedIps: true, examMode: true, startTime: true, endTime: true, examDuration: true, waitingTime: true, lateTolerance: true } },
        examQuestions: { include: { question: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (exam.status !== 'published' && exam.status !== 'in_progress') {
      return res.status(400).json({ message: '考试未发布或已结束' });
    }
    if (exam.batch && exam.batch.status !== 'active') {
      return res.status(400).json({ message: '考试所属批次尚未激活，无法开始考试' });
    }

    // IP 白名单校验
    if (exam.batch?.ipLimitEnabled) {
      const clientIp = ((req.headers['x-forwarded-for'] as string) || req.ip || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim();
      const allowed = isIpAllowed(clientIp, (exam.batch.allowedIps as string[]) || []);
      if (!allowed) {
        return res.status(403).json({
          message: '当前 IP 不在允许访问范围内，请联系管理员确认白名单配置',
          clientIp,
        });
      }
    }

    // 提前查询已有 submission，用于判断是否为断点续考
    const existingSubmission = await prisma.studentSubmission.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });
    const isResuming = existingSubmission?.status === 'in_progress';

    // 考试时间校验：候考时间 + 考试结束仍拦截，迟到时间不拦截（仅前端显示）
    const batch = exam.batch;
    if (batch) {
      const examMode = batch.examMode || 'unified';
      const effectiveStart = exam.startTime ? new Date(exam.startTime).getTime() : null;
      const effectiveEnd = exam.endTime ? new Date(exam.endTime).getTime() : null;
      const waitingTime = batch.waitingTime || 0;
      const now = Date.now();

      if (examMode === 'unified') {
        // 候考时间未到：拦截（断点续考除外）
        if (effectiveStart && !isResuming) {
          const waitingStart = effectiveStart - waitingTime * 60 * 1000;
          if (now < waitingStart) {
            return res.status(400).json({ message: '候考时间未到，请在考试开始前进入' });
          }
        }
        // 考试已结束：拦截
        if (effectiveEnd && now > effectiveEnd) {
          return res.status(400).json({ message: '考试已结束' });
        }
      } else if (examMode === 'flexible') {
        // 批次尚未开始：拦截
        if (effectiveStart && now < effectiveStart) {
          return res.status(400).json({ message: '批次考试尚未开始' });
        }
        // 考试已结束：拦截
        if (effectiveEnd && now > effectiveEnd) {
          return res.status(400).json({ message: '批次考试已结束' });
        }
      }
    }

    // 校验考生是否已分配到该考试
    const isAssignedWps = await prisma.examRoomStudent.findFirst({
      where: {
        studentId: req.user!.userId,
        assignment: { examId: req.params.id },
      },
    });
    if (!isAssignedWps) {
      return res.status(403).json({ message: '您未被分配到该考试，请联系监考老师' });
    }


    const assignment = await prisma.examTableAssignment.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
    });

    if (!assignment) {
      return res.status(400).json({ message: '尚未分配 WPS 表格，请联系教师' });
    }

    let submission = existingSubmission;

    const tableSpaceId = `${assignment.fileId}:${assignment.accessToken || ''}`;

    if (submission) {
      // 断点续考：保留原始 startedAt，确保剩余考试时间从首次开考时刻持续累计，
      // 而非每次重新进入都重置为满时长（考试时间应在后台持续计算）。
      // 仅在原先没有 startedAt（异常数据）或非续考场景下才设置当前时间。
      submission = await prisma.studentSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'in_progress',
          ...(isResuming && submission.startedAt ? {} : { startedAt: new Date() }),
          tableSpaceId,
        },
      });
    } else {
      submission = await prisma.studentSubmission.create({
        data: {
          examId: req.params.id,
          studentId: req.user!.userId,
          status: 'in_progress',
          startedAt: new Date(),
          tableSpaceId,
          details: {
            create: exam.examQuestions.map(eq => ({ questionId: eq.questionId })),
          },
        },
      });
      await prisma.examSession.create({
        data: {
          submissionId: submission.id,
          studentId: req.user!.userId,
          examId: req.params.id,
          ipAddress: req.ip || req.socket.remoteAddress || null,
        },
      });
    }

    res.json({
      submission,
      shareUrl: assignment.shareUrl,
      fileId: assignment.fileId,
      exam: {
        id: exam.id,
        title: exam.title,
        durationMinutes: exam.durationMinutes,
        totalScore: exam.totalScore,
        passScore: exam.passScore,
      },
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

// POST /api/my-exams/:id/heartbeat — 心跳上报 + 切屏计数
myExamRouter.post('/:id/heartbeat', async (req: Request, res: Response) => {
  try {
    const { tabSwitchCount } = req.body;

    const session = await prisma.examSession.findFirst({
      where: {
        studentId: req.user!.userId,
        examId: req.params.id,
      },
    });

    if (session) {
      // Store tab switch count in the session's IP address field (repurpose) or use ws_connected
      // For now, update the session with heartbeat info
      await prisma.examSession.update({
        where: { id: session.id },
        data: {
          lastHeartbeat: new Date(),
          ipAddress: req.ip || req.socket.remoteAddress || null,
        },
      });
    }

    res.json({ ok: true });
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

    // Server-side time validation
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (exam?.durationMinutes && submission.startedAt) {
      const deadline = new Date(submission.startedAt).getTime() + exam.durationMinutes * 60 * 1000;
      const grace = 60 * 1000; // 1 minute grace period
      if (Date.now() > deadline + grace) {
        // Time expired, but still allow submission (auto-submit scenario)
      }
    }

    const updated = await prisma.studentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
      },
    });

    // 自动判分已关闭，改为教师通过"阅卷管理→自动阅卷"手动触发
    // gradeSubmission(submission.id).catch(err => {
    //   console.error(`[my-exams] 自动判分失败: ${submission.id}`, err);
    // });

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
          status: studentFacingStatus(submission.status),
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
