import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { hashString, shuffleWithSeed } from '../utils/helpers';
import { isIpAllowed } from '../utils/ip-utils';

import { autoEndExpiredExams, studentExamVisibilityOR, computeStudentDeadline, computeEarliestSubmitAt } from '../utils/exam-utils';
import { loadTablePreview } from '../services/wps-table-service';
import { wpsConfigService } from '../services/wps-config-service';
import { generateStudentPaper } from '../services/paper-generator';

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

/** 判分不依赖 WPS 表格的题型（客观题） */
const OBJECTIVE_QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false'];

/**
 * 学生视角的题目裁剪。
 *
 * ⚠️ 安全边界：`answerRules` 是判分规则（含标准答案/字段名/目标值），`analysis` 是解析，
 * 二者一旦下发到学生浏览器，学生可直接读取答案。作答期间一律剥离，
 * 仅保留作答必需的题干字段。成绩页需要的解析由 /:id/result 在判分后单独下发。
 */
function toStudentQuestion(q: any, extra: Record<string, unknown> = {}) {
  const {
    id, title, description, type, difficulty, score, hints, tags, primaryCategoryId, secondaryCategoryId,
  } = q;

  // 客观题：**选项要发给学生（不然没得选），正确答案绝不能发**。
  // objectiveAnswer 里同时存着 options 与 correct，这里只取 options。
  const options = Array.isArray(q?.objectiveAnswer?.options)
    ? q.objectiveAnswer.options.map((o: any) => ({ key: String(o?.key ?? ''), text: String(o?.text ?? '') }))
    : undefined;

  return {
    id, title, description, type, difficulty, score, hints, tags, primaryCategoryId, secondaryCategoryId,
    ...(options ? { options } : {}),
    ...extra,
  };
}

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
            examDuration: true,
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

    // 可见性校验：与考试列表、成绩查询使用同一口径（studentExamVisibilityOR）。
    // 否则任何学生拿到一个考试 UUID 就能读到该场考试的题目（历史缺陷：
    // 本接口曾是「知道 ID 即可读题」的越权入口）。
    const visible = await prisma.exam.findFirst({
      where: {
        id: req.params.id,
        OR: studentExamVisibilityOR(req.user!.userId),
      },
      select: { id: true },
    });
    if (!visible) {
      return res.status(403).json({ message: '您未被分配到该考试，请联系监考老师' });
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

    // ── 题目下发 ─────────────────────────────────────────────
    // 有卷子快照（已开考）→ 下发该生**实际拿到**的题目；
    // 没有快照（还没开考，如入场须知页）→ 只下发固定题位，
    // 题量另行用 questionCount 告知（rule 题位此刻还没抽题，不能凭空生成）。
    const settings = (exam?.settings || {}) as any;
    const shuffle = <T,>(arr: T[]): T[] =>
      settings.shuffleQuestions ? shuffleWithSeed(arr, hashString(req.params.id + req.user!.userId)) : arr;

    const paperRows = submission
      ? await prisma.studentExamQuestion.findMany({
          where: { examId: req.params.id, studentId: req.user!.userId },
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        })
      : [];

    const examSlots = await prisma.examQuestion.findMany({
      where: { examId: req.params.id },
      include: { question: true },
      orderBy: [{ slotIndex: 'asc' }, { sortOrder: 'asc' }],
    });

    let questions;
    if (paperRows.length > 0) {
      questions = shuffle(paperRows).map(row =>
        toStudentQuestion(row.question, { scoreOverride: null, sortOrder: row.sortOrder, score: row.score }),
      );
    } else {
      // 未开考：只给固定题位（题面本身不泄题），题量用 questionCount 表达
      const fixed = examSlots.filter(eq => eq.slotType !== 'rule' && eq.questionId && eq.question);
      questions = shuffle(fixed).map(eq =>
        toStudentQuestion(eq.question, {
          scoreOverride: eq.scoreOverride,
          sortOrder: eq.sortOrder,
          score: eq.scoreOverride ?? eq.question!.score,
        }),
      );
    }

    // 该生卷子的题位总数（含尚未抽题的 rule 题位），供入场页展示"共 N 题"
    const questionCount = paperRows.length > 0 ? paperRows.length : examSlots.length;

    // 查询 WPS 表格分配信息（用于 WPS 实操版界面）
    let wpsTable: { shareUrl: string; fileId: string } | null = null;
    const tableAssignment = await prisma.examTableAssignment.findUnique({
      where: {
        examId_studentId: {
          examId: req.params.id,
          studentId: req.user!.userId,
        },
      },
      select: { shareUrl: true, fileId: true },
    });
    if (tableAssignment?.shareUrl) {
      wpsTable = { shareUrl: tableAssignment.shareUrl, fileId: tableAssignment.fileId };
    }

    // 每人截止时间（随到随考模式下每人不同）：由服务端统一计算并下发，
    // 客户端不再自行推算 —— 两端各算一次是历史上时间口径漂移的根源。
    const deadline = computeStudentDeadline(exam, submission);
    // 最早交卷时刻（未配置为 null）：与 deadline 同模式由服务端算好下发，学生端只负责禁用按钮
    const submitAllowedAt = computeEarliestSubmitAt(exam, submission);

    // 自愈：本人时间已到但答卷仍是 in_progress（学生关掉页面没触发自动交卷）→ 就地收卷，
    // 否则这份卷子要等到批次结束才被兜底收集，期间教师阅卷列表里看不到它。
    if (deadline !== null && submission && submission.status === 'in_progress' && Date.now() >= deadline) {
      const finalized = await prisma.studentSubmission.updateMany({
        where: { id: submission.id, status: 'in_progress' },
        data: { status: 'submitted', submittedAt: new Date(deadline), isAutoSubmitted: true },
      });
      if (finalized.count > 0) {
        submission.status = 'submitted';
        submission.submittedAt = new Date(deadline);
      }
    }

    res.json({ exam, submission, questions, questionCount, wpsTable, deadline, submitAllowedAt });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});


// ============================================================
// WPS 表格辅助接口（考试页右侧面板专用，只读，不参与判分）
//
// 内嵌 iframe 能否显示表格取决于该链接的权限设置与浏览器三方 Cookie 策略，
// 天然可能失败，因此提供一条不依赖浏览器登录态的只读兜底（实现见 wps-table-service）：
//   GET /wps-preview —— 读取该考生表格的真实数据，供右侧「实时数据面板」轮询渲染，
//   学生即便在独立窗口操作表格，主页面也能看到表格当前状态。
// ============================================================

// GET /api/my-exams/:id/wps-preview — 考生表格实时数据预览（只读）
myExamRouter.get('/:id/wps-preview', async (req: Request, res: Response) => {
  const { id: examId } = req.params;
  const studentId = req.user!.userId;

  try {
    const assignment = await prisma.examTableAssignment.findUnique({
      where: { examId_studentId: { examId, studentId } },
      select: { fileId: true, accessToken: true },
    });
    if (!assignment) {
      return res.status(404).json({ message: '本场考试尚未分配 WPS 表格，请联系监考老师' });
    }

    // 优先用系统当前（自动刷新）的 token；分配记录里的 token 是分配时的快照，会过期
    const current = await wpsConfigService.get();
    const payload = await loadTablePreview({
      cacheKey: `${examId}:${studentId}`,
      fileId: assignment.fileId,
      accessTokens: [current?.accessToken, assignment.accessToken],
      sheetId: typeof req.query.sheetId === 'string' ? req.query.sheetId : undefined,
    });
    res.json(payload);
  } catch (err: any) {
    // 预览失败不影响考试与判分，返回可读原因供面板提示
    console.error('[wps-preview] 读取表格失败:', err?.message || err);
    res.status(err?.statusCode || 502).json({ message: `读取表格失败：${err?.message || '未知错误'}` });
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
      // ⚠️ 必须走 req.ip（配合 app.ts 的 trust proxy 配置）而不是直接读请求头：
      // 请求头是客户端可伪造的，直读 X-Forwarded-For 等于白名单形同虚设
      // （学生在校外自带一个校内 IP 头即可绕过"仅限校内考试"的限制）。
      // trust proxy 只信任反向代理追加的那一跳，伪造值会被代理覆盖或忽略。
      const clientIp = (req.ip || req.socket.remoteAddress || '')
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/, ''); // IPv4-mapped IPv6 归一化，否则白名单匹配不上

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

    // ✅ 已交卷/判分中的答卷不允许重新进入考试：
    // 否则下面的续考分支会把 submitted/grading/graded 重置回 in_progress，
    // 答卷从教师阅卷列表（按 submitted 状态查询）中消失，状态机被破坏。
    if (
      existingSubmission &&
      ['submitted', 'grading', 'graded'].includes(existingSubmission.status)
    ) {
      return res.status(400).json({ message: '答卷已提交，无法重新进入考试' });
    }

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

    // 纯客观题考试不需要 WPS 表格：只有卷子里确实含实操题题位时才强制要求分配，
    // 否则"只考选择题"的考试会因为没配表格而根本开不了考。
    const hasHandsOnSlot = exam.examQuestions.some(
      eq => !!eq.question && !OBJECTIVE_QUESTION_TYPES.includes(eq.question.type as any),
    );
    if (!assignment && hasHandsOnSlot) {
      return res.status(400).json({ message: '尚未分配 WPS 表格，请联系教师' });
    }

    let submission = existingSubmission;

    // 没有实操题时表空间留空：判分链路会跳过 WPS 读取
    const tableSpaceId = assignment ? `${assignment.fileId}:${assignment.accessToken || ''}` : '';

    if (submission) {
      // 断点续考：条件更新，只有**仍是 in_progress** 才写回。
      // 读检查写之间服务端可能已经收卷（到点自动交卷 / 教师结束考试 / 批次级联），
      // 无条件 update 会把 submitted 覆盖回 in_progress —— 此后该答卷不再被任何兜底
      // 收集（所有兜底只扫 in_progress 的"考试"，考试已 ended 就不再匹配），
      // 教师阅卷列表（只查 submitted）也看不到它，形成永久悬空的"半死"答卷。
      const resumed = await prisma.studentSubmission.updateMany({
        where: { id: submission.id, status: 'in_progress' },
        data: {
          // 保留原始 startedAt，确保剩余时间从首次开考时刻持续累计
          ...(isResuming && submission.startedAt ? {} : { startedAt: new Date() }),
          tableSpaceId,
        },
      });
      if (resumed.count === 0) {
        return res.status(400).json({ message: '答卷已提交，无法重新进入考试' });
      }
      submission = await prisma.studentSubmission.findUnique({ where: { id: submission.id } });
      if (!submission) return res.status(500).json({ message: '服务器错误' });

      // 补建缺失的监考会话（历史上创建失败后没有补建路径，导致监考场次记录缺失）
      const session = await prisma.examSession.findFirst({
        where: { studentId: req.user!.userId, examId: req.params.id },
        select: { id: true },
      });
      if (!session) {
        await prisma.examSession.create({
          data: {
            submissionId: submission.id,
            studentId: req.user!.userId,
            examId: req.params.id,
            ipAddress: req.ip || req.socket.remoteAddress || null,
          },
        }).catch(() => { /* 会话仅用于监考展示，失败不阻断入场 */ });
      }
    } else {
      try {
        submission = await prisma.$transaction(async (tx) => {
          // 事务内重查考试状态：避免"入场校验通过 → 落库前考试已被结束"的竞态。
          // 结束时 finalize 只收已存在的答卷，新建的答卷会永久悬空在 in_progress。
          const fresh = await tx.exam.findUnique({
            where: { id: req.params.id },
            select: { status: true },
          });
          if (!fresh || (fresh.status !== 'published' && fresh.status !== 'in_progress')) {
            throw Object.assign(new Error('考试已结束，无法开始作答'), { statusCode: 400 });
          }

          // 先生成该生专属卷子快照（fixed 题位直接用、rule 题位按知识点抽题），
          // 再按快照建答题明细 —— 明细必须引用「该生实际拿到的题」，
          // 而不是考试题位（rule 题位本来就没有固定题目）
          const paper = await generateStudentPaper(req.params.id, req.user!.userId, tx);
          if (paper.unfilledSlots.length > 0) {
            console.warn(
              `[start-wps] exam=${req.params.id} student=${req.user!.userId} 有 ${paper.unfilledSlots.length} 个题位无候选题:`,
              JSON.stringify(paper.unfilledSlots),
            );
          }

          const paperRows = await tx.studentExamQuestion.findMany({
            where: { examId: req.params.id, studentId: req.user!.userId },
            orderBy: { sortOrder: 'asc' },
            select: { questionId: true },
          });

          const created = await tx.studentSubmission.create({
            data: {
              examId: req.params.id,
              studentId: req.user!.userId,
              status: 'in_progress',
              startedAt: new Date(),
              tableSpaceId,
              details: {
                create: paperRows.map(r => ({ questionId: r.questionId })),
              },
            },
          });
          // 会话仅用于监考展示：失败不阻断入场（没有它学生仍在正常答卷）
          await tx.examSession.create({
            data: {
              submissionId: created.id,
              studentId: req.user!.userId,
              examId: req.params.id,
              ipAddress: req.ip || req.socket.remoteAddress || null,
            },
          }).catch(() => { /* 同上 */ });
          return created;
        });
      } catch (err: any) {
        // 双击/双标签同时入场：唯一约束 @@unique([examId, studentId]) 会拦下后到者，
        // 这不是错误，直接复用已创建的那份答卷
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          submission = await prisma.studentSubmission.findUnique({
            where: { examId_studentId: { examId: req.params.id, studentId: req.user!.userId } },
          });
          if (!submission) return res.status(500).json({ message: '服务器错误' });
        } else {
          return res.status(err?.statusCode || 500).json({
            message: err?.statusCode ? err.message : '服务器错误',
          });
        }
      }
    }

    // 下发该生**实际拿到**的卷子（刚生成的快照），而不是考试题位：
    // 抽题题位没有固定题目，按题位返回会少给题目、与详情接口口径不一致
    const paperQuestions = await prisma.studentExamQuestion.findMany({
      where: { examId: req.params.id, studentId: req.user!.userId },
      include: { question: true },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({
      submission,
      shareUrl: assignment?.shareUrl ?? null,
      fileId: assignment?.fileId ?? null,
      exam: {
        id: exam.id,
        title: exam.title,
        durationMinutes: exam.durationMinutes,
        totalScore: exam.totalScore,
        passScore: exam.passScore,
      },
      questions: paperQuestions.map(row =>
        toStudentQuestion(row.question, { scoreOverride: null, sortOrder: row.sortOrder, score: row.score }),
      ),
      questionCount: paperQuestions.length,
      deadline: computeStudentDeadline(exam, submission),
    });
  } catch (err: any) {
    // 这里原先静默返回 500，线上只看到"服务器错误"，无从定位。开考是关键路径，必须留日志。
    console.error('[start-wps] 开考失败 exam=%s student=%s:', req.params.id, req.user?.userId, err);
    res.status(err?.statusCode || 500).json({ message: err?.statusCode ? err.message : '服务器错误' });
  }
});

// POST /api/my-exams/:id/heartbeat — 心跳上报 + 切屏计数
myExamRouter.post('/:id/heartbeat', async (req: Request, res: Response) => {
  try {
    const examId = req.params.id;
    const studentId = req.user!.userId;

    const session = await prisma.examSession.findFirst({
      where: {
        studentId,
        examId,
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
    } else {
      // 归属校验：session 不存在时不能直接放行 —— 任何学生拿到一个考试 UUID 就能伪造心跳，
      // 污染监考数据。心跳是高频接口（每人每 10 秒一次），不能复用重型的三层关系过滤
      // （studentExamVisibilityOR），这里只查该生自己的参与痕迹：
      // 答卷（studentSubmission）、考场座位（examRoomStudent）、表格分配（examTableAssignment），
      // 均为单行索引点查，命中其一即视为归属该考试。
      const [sub, seat, table] = await Promise.all([
        prisma.studentSubmission.findUnique({
          where: { examId_studentId: { examId, studentId } },
          select: { id: true },
        }),
        prisma.examRoomStudent.findFirst({
          where: { studentId, assignment: { examId } },
          select: { id: true },
        }),
        prisma.examTableAssignment.findUnique({
          where: { examId_studentId: { examId, studentId } },
          select: { id: true },
        }),
      ]);
      if (!sub && !seat && !table) {
        return res.status(403).json({ message: '您未被分配到该考试，心跳已忽略' });
      }
    }

    // 回传答卷状态：监考老师「强制交卷」后，学生端在下一次 HTTP 心跳（≤30s）内感知并停止作答。
    // 走 examId_studentId 唯一索引点查，比其他分支的查询更轻。
    const submission = await prisma.studentSubmission.findUnique({
      where: { examId_studentId: { examId, studentId } },
      select: { status: true },
    });

    res.json({ ok: true, submissionStatus: submission?.status ?? null });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/my-exams/:id/answers — 保存客观题作答（自动保存，可反复调用）
//
// 客观题在页面内直接作答，必须随时落库：机房断电、浏览器崩溃、误刷新都不该丢答案。
// 只允许写「该生卷子里确实有的题」，且只在 in_progress 期间可写
// （交卷后作答不能再被改动，否则成绩可被事后篡改）。
myExamRouter.put('/:id/answers', async (req: Request, res: Response) => {
  try {
    const examId = req.params.id;
    const studentId = req.user!.userId;

    const payload = z.object({
      answers: z.array(z.object({
        questionId: z.string().uuid(),
        answer: z.union([z.string(), z.array(z.string()), z.null()]),
      })).max(200),
    }).parse(req.body);

    const submission = await prisma.studentSubmission.findUnique({
      where: { examId_studentId: { examId, studentId } },
      select: { id: true, status: true },
    });
    if (!submission) {
      return res.status(404).json({ message: '未找到答题记录，请先开始答题' });
    }
    if (submission.status !== 'in_progress') {
      return res.status(400).json({ message: '答卷已提交，无法再修改作答' });
    }

    // 该生实际拿到的题目（抽题组卷下每人不同，不能用考试题位校验）
    const paper = await prisma.studentExamQuestion.findMany({
      where: { examId, studentId },
      select: { questionId: true },
    });
    const allowed = new Set(paper.map(p => p.questionId));
    const rejected = payload.answers.filter(a => !allowed.has(a.questionId)).map(a => a.questionId);
    if (rejected.length > 0) {
      return res.status(403).json({ message: '作答中包含不属于本场考试的题目', rejected });
    }

    const now = new Date();
    const writes = payload.answers.map(a => prisma.submissionDetail.updateMany({
      where: { submissionId: submission.id, questionId: a.questionId },
      data: { answerJson: { answer: a.answer } as any },
    }));
    if (writes.length > 0) await prisma.$transaction(writes);

    res.json({ saved: payload.answers.length, savedAt: now.toISOString() });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
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

    // 状态机只允许 in_progress → submitted。
    // ⚠️ 必须把 grading 视为"已交卷"：教师在自动阅卷后答卷会进入 grading（待复核），
    // 此时学生端的任何一次重试（手点交卷/到点自动交卷/网络重发）都不能把它打回 submitted，
    // 否则答卷会从教师待复核列表消失，已写入的判分明细与状态不一致。
    if (submission.status !== 'in_progress') {
      return res.status(400).json({
        message: '已提交，无法重复提交',
        status: submission.status,
      });
    }

    // 最早交卷限制（防误交/秒交）：时刻由与服务端下发同一函数计算，保证"按钮说能交就能交"。
    // 例外：本人截止时间已到（到点自动交卷兜底）时不再限制——否则教师把"最早交卷"
    // 配得比考试时长还长时，卷子会被卡住永远交不上。
    const examForLimits = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: {
        settings: true,
        startTime: true,
        endTime: true,
        durationMinutes: true,
        batch: { select: { examMode: true, endTime: true, examDuration: true } },
      },
    });
    if (examForLimits) {
      const submitAllowedAt = computeEarliestSubmitAt(examForLimits, submission);
      const deadline = computeStudentDeadline(examForLimits, submission);
      const deadlinePassed = deadline !== null && Date.now() >= deadline;
      if (submitAllowedAt !== null && Date.now() < submitAllowedAt && !deadlinePassed) {
        const earliestMinutes = Number((examForLimits.settings as any)?.earliestSubmitMinutes || 0);
        const remainMin = Math.max(1, Math.ceil((submitAllowedAt - Date.now()) / 60000));
        return res.status(400).json({
          message: `本场考试开考 ${earliestMinutes} 分钟内不可交卷，请继续作答（约 ${remainMin} 分钟后可交卷）`,
        });
      }
    }

    // 条件更新：只有仍是 in_progress 才写入。
    // 手点交卷、到点自动交卷、服务端收卷三者并发时，后到者 count=0 即视为"已提交"，
    // 避免把服务端已收的卷子或教师正在复核的卷子覆盖回 submitted（含提交时间被改写）。
    const result = await prisma.studentSubmission.updateMany({
      where: { id: submission.id, status: 'in_progress' },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        isAutoSubmitted: false,
      },
    });

    if (result.count === 0) {
      return res.status(400).json({ message: '已提交，无法重复提交' });
    }

    // 自动判分已关闭，改为教师通过"阅卷管理→自动阅卷"手动触发
    // gradeSubmission(submission.id).catch(err => {
    //   console.error(`[my-exams] 自动判分失败: ${submission.id}`, err);
    // });

    const updated = await prisma.studentSubmission.findUnique({ where: { id: submission.id } });
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
