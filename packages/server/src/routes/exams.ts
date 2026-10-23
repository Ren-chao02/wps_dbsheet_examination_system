import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { autoEndExpiredExams, finalizeExamSubmissions } from '../utils/exam-utils';
import { checkExamAccess, denyAccess } from '../middleware/exam-ownership';
import { scopeCtxOf, examWhere, assertExamAccess, assertPaperRead, questionWhere } from '../services/data-scope';
import { emitStudentSubmit, emitStudentUpdate } from '../services/socket';
import { preflightExamPaper } from '../services/paper-preflight';
import { syncPaperIntoExam } from '../services/paper-exam-sync';
import { enqueuePaperGeneration, getPaperGenerationProgress } from '../jobs/paper-generation-queue';
import { logger } from '../utils/logger';

export const examRouter = Router();
examRouter.use(authenticate);
examRouter.use(authorize('teacher', 'admin'));

const examSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().nullable().optional(),
  mode: z.enum(['practice', 'quiz', 'exam']).default('practice'),
  durationMinutes: z.number().int().positive().nullable().optional(),
  startTime: z.string().datetime().nullable().optional(),
  endTime: z.string().datetime().nullable().optional(),
  passScore: z.number().int().min(0).nullable().optional(),
  settings: z.record(z.any()).default({}),
  paperId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
});

const examQuestionSchema = z.object({
  questionIds: z.array(z.object({
    questionId: z.string().uuid(),
    sortOrder: z.number().int().min(0).default(0),
    scoreOverride: z.number().int().min(0).nullable().optional(),
  })),
});

// GET /api/exams
examRouter.get('/', async (req: Request, res: Response) => {
  try {
    await autoEndExpiredExams();

    const { page = '1', pageSize = '20', status, mode, search } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 数据范围：教师只能看到「我创建 + 我监考」的考试；admin 不受限。
    // 用 AND 组合而非对象展开 —— 下面的 search 会占用 OR 字段，展开会互相覆盖。
    const scope = scopeCtxOf(req);
    const conditions: any[] = [await examWhere(scope)];
    if (status) conditions.push({ status: String(status) });
    if (mode) conditions.push({ mode: String(mode) });
    if (search) {
      const kw = String(search);
      conditions.push({
        OR: [
          { title: { contains: kw, mode: 'insensitive' } },
          { creator: { realName: { contains: kw, mode: 'insensitive' } } },
        ],
      });
    }
    const where: any = { AND: conditions };

    const [exams, total] = await Promise.all([
      prisma.exam.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { select: { id: true, realName: true } },
          paper: { 
            select: { 
              id: true, 
              name: true, 
              totalScore: true, 
              passScore: true,
              _count: { select: { paperQuestions: true } }  // ✅ 统计试卷中的题目数量
            } 
          },
          batch: { select: { id: true, name: true, status: true, startTime: true, endTime: true, examDuration: true, examMode: true } },
          assignments: {
            select: {
              id: true,
              roomId: true,
              status: true,
              room: {
                select: { id: true, code: true, name: true },
              },
              _count: { select: { students: true } },
            },
          },
          _count: { select: { examQuestions: true, submissions: true } },
        },
      }),
      prisma.exam.count({ where }),
    ]);

    // 监考列表的四数（应参考/到考/交卷/缺考）：
    //   应参考 = 各考场分配的学生数之和；到考 = 有提交记录（学生开始作答即建记录，
    //   自动收卷只更新已有记录、不为缺考建记录）；交卷 = 已提交及之后的状态（grading/graded 同理）。
    // 用一次 groupBy 汇总本页所有考试，避免逐考试 N+1 查询。
    const examIds = exams.map((e) => e.id);
    const statusGroups = examIds.length
      ? await prisma.studentSubmission.groupBy({
          by: ['examId', 'status'],
          where: { examId: { in: examIds } },
          _count: { _all: true },
        })
      : [];
    const statsByExam = new Map<string, { attended: number; submitted: number }>();
    for (const g of statusGroups) {
      const s = statsByExam.get(g.examId) ?? { attended: 0, submitted: 0 };
      s.attended += g._count._all;
      if (g.status !== 'in_progress') s.submitted += g._count._all;
      statsByExam.set(g.examId, s);
    }
    const data = exams.map((e) => {
      const assigned = e.assignments.reduce((sum, a) => sum + a._count.students, 0);
      const s = statsByExam.get(e.id) ?? { attended: 0, submitted: 0 };
      return {
        ...e,
        submissionStats: { assigned, attended: s.attended, submitted: s.submitted, absent: Math.max(assigned - s.attended, 0) },
      };
    });

    res.json({ data, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id
examRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    await autoEndExpiredExams();

    const access = await assertExamAccess(scopeCtxOf(req), req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权查看该考试，请联系考试创建者或管理员');

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, realName: true } },
        paper: { select: { id: true, name: true, totalScore: true, passScore: true } },
        examQuestions: {
          include: {
            question: {
              include: {
                primaryCategory: { select: { id: true, name: true } },
                secondaryCategory: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }

    res.json(exam);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams
examRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = examSchema.parse(req.body);
    console.log('[POST /exams] payload keys:', Object.keys(req.body), 'batchId:', data.batchId, 'startTime:', data.startTime, 'endTime:', data.endTime);

    if (data.batchId) {
      const batch = await prisma.examBatch.findUnique({
        where: { id: data.batchId },
        select: { startTime: true, endTime: true, examMode: true, examDuration: true },
      });

      if (!batch) {
        return res.status(400).json({ message: '批次不存在' });
      }

      if (batch.examMode === 'unified') {
        if (!data.startTime || !data.endTime) {
          return res.status(400).json({ message: '集中统一模式下，必须设置考试开始时间和结束时间' });
        }

        if (!batch.startTime || !batch.endTime) {
          return res.status(400).json({ message: '集中统一模式下，批次必须设置开始时间和结束时间' });
        }

        const examStart = new Date(data.startTime);
        const examEnd = new Date(data.endTime);

        if (examStart < batch.startTime) {
          return res.status(400).json({ message: '考试开始时间不能早于批次开始时间' });
        }

        if (examEnd > batch.endTime) {
          return res.status(400).json({ message: '考试结束时间不能晚于批次结束时间' });
        }

        if (examStart >= examEnd) {
          return res.status(400).json({ message: '考试开始时间必须早于结束时间' });
        }

        // 集中统一模式下，考试时长必须与批次统一时长一致
        const actualDurationMinutes = Math.round((examEnd.getTime() - examStart.getTime()) / 60000);
        if (actualDurationMinutes !== batch.examDuration) {
          return res.status(400).json({
            message: `集中统一模式下，考试时长必须为 ${batch.examDuration} 分钟`,
          });
        }

        data.durationMinutes = batch.examDuration;
      }

      if (batch.examMode === 'flexible') {
        if (!data.durationMinutes) {
          return res.status(400).json({ message: '随到随考模式下，必须设置考试时长' });
        }

        data.startTime = null;
        data.endTime = null;
      }
    } else {
      // 无批次时必须设置开始时间和结束时间
      if (!data.startTime || !data.endTime) {
        return res.status(400).json({ message: '未关联批次的考试必须设置开始时间和结束时间' });
      }
      if (new Date(data.startTime) >= new Date(data.endTime)) {
        return res.status(400).json({ message: '考试开始时间必须早于结束时间' });
      }
    }

    const { paperId, batchId, ...rest } = data;

    // 数据范围 P2：绑定的试卷必须在自己可见的池内（本院系/校级/本人），
    // 否则拿到 ID 直连提交就能绕过列表可见性；校验必须在 create 之前
    if (paperId) {
      const access = await assertPaperRead(scopeCtxOf(req), paperId);
      if (access !== 'ok') return denyAccess(res, access, '该试卷不在你可见的范围内');
    }

    const exam = await prisma.exam.create({
      data: {
        ...rest,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        createdBy: req.user!.userId,
        // 默认归属创建者院系（无院系 = 校级 null），与题目/试卷创建同口径
        departmentId: req.user!.departmentId ?? null,
        paperId: paperId ?? null,
        batchId: batchId ?? null,
      },
    });

    // 如果绑定了试卷，自动同步试卷题目到考试（题位 / 总分 / 难度目标同一处拷贝）
    if (paperId) {
      await syncPaperIntoExam({ examId: exam.id, paperId });
    }

    res.status(201).json(exam);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/exams/:id
examRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    // ✅ 所有权检查：非 admin 只能编辑自己创建的考试
    if (req.user!.role !== 'admin' && exam.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能编辑自己创建的考试' });
    }
    if (exam.status === 'in_progress') {
      return res.status(400).json({ message: '考试进行中，无法编辑' });
    }
    // ✅ 已结束考试不可再编辑（只读：仅可通过详情/统计等查看）
    if (exam.status === 'ended') {
      return res.status(400).json({ message: '考试已结束，无法编辑' });
    }

    const data = examSchema.parse(req.body);
    const targetBatchId = data.batchId ?? exam.batchId;

    if (targetBatchId) {
      const batch = await prisma.examBatch.findUnique({
        where: { id: targetBatchId },
        select: { startTime: true, endTime: true, examMode: true, examDuration: true },
      });

      if (!batch) {
        return res.status(400).json({ message: '批次不存在' });
      }

      if (batch.examMode === 'unified') {
        const targetStartTime = data.startTime ? new Date(data.startTime) : exam.startTime;
        const targetEndTime = data.endTime ? new Date(data.endTime) : exam.endTime;

        if (!targetStartTime || !targetEndTime) {
          return res.status(400).json({ message: '集中统一模式下，必须设置考试开始时间和结束时间' });
        }

        if (!batch.startTime || !batch.endTime) {
          return res.status(400).json({ message: '集中统一模式下，批次必须设置开始时间和结束时间' });
        }

        if (targetStartTime < batch.startTime) {
          return res.status(400).json({ message: '考试开始时间不能早于批次开始时间' });
        }

        if (targetEndTime > batch.endTime) {
          return res.status(400).json({ message: '考试结束时间不能晚于批次结束时间' });
        }

        if (targetStartTime >= targetEndTime) {
          return res.status(400).json({ message: '考试开始时间必须早于结束时间' });
        }

        // 集中统一模式下，考试时长必须与批次统一时长一致
        const actualDurationMinutes = Math.round((targetEndTime.getTime() - targetStartTime.getTime()) / 60000);
        if (actualDurationMinutes !== batch.examDuration) {
          return res.status(400).json({
            message: `集中统一模式下，考试时长必须为 ${batch.examDuration} 分钟`,
          });
        }

        data.durationMinutes = batch.examDuration;
      }

      if (batch.examMode === 'flexible') {
        const targetDuration = data.durationMinutes ?? exam.durationMinutes;
        if (!targetDuration) {
          return res.status(400).json({ message: '随到随考模式下，必须设置考试时长' });
        }

        data.startTime = null;
        data.endTime = null;
      }
    }

    // 数据范围 P2：显式更换试卷时校验新试卷在可见池内（院校池/本人）。
    // 只看 data.paperId 的有值情形——不传 paperId 的普通编辑不受影响，置空（解绑）也无需判定。
    if (data.paperId) {
      const access = await assertPaperRead(scopeCtxOf(req), data.paperId);
      if (access !== 'ok') return denyAccess(res, access, '该试卷不在你可见的范围内');
    }

    const { paperId, batchId, ...rest } = data;
    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        // 仅在请求显式提供字段时才更新，否则保留原有值（避免编辑时误清空）
        startTime: data.startTime !== undefined ? (data.startTime ? new Date(data.startTime) : null) : exam.startTime,
        endTime: data.endTime !== undefined ? (data.endTime ? new Date(data.endTime) : null) : exam.endTime,
        paperId: paperId !== undefined ? (paperId ?? null) : exam.paperId,
        batchId: batchId !== undefined ? (batchId ?? null) : exam.batchId,
      },
    });

    // 如果更换了试卷绑定，重新同步 ExamQuestion / totalScore / 难度目标。
    // 与上面的 update data 同口径：只有请求显式提供 paperId 才算换卷/解绑。
    // 旧代码用 `paperId ?? null` 判断，导致「只改标题」被当成解绑，删光题位并把总分重置为 100。
    const effectivePaperId = paperId !== undefined ? (paperId ?? null) : exam.paperId;
    if (effectivePaperId !== exam.paperId) {
      await syncPaperIntoExam({ examId: req.params.id, paperId: effectivePaperId });
    }

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/exams/:id
examRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    // ✅ 所有权检查：非 admin 只能删除自己创建的考试
    if (req.user!.role !== 'admin' && exam.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能删除自己创建的考试' });
    }
    if (exam.status === 'in_progress') {
      return res.status(400).json({ message: '考试进行中，无法删除' });
    }

    // ⚠️ 成绩档案保护：删除会级联抹掉全部答卷、判分明细与验证结果。
    // 教师不能删除已经产生答卷的考试（无论是否已结束），只有管理员可以强制清理。
    if (req.user!.role !== 'admin') {
      const submissionCount = await prisma.studentSubmission.count({ where: { examId: req.params.id } });
      if (submissionCount > 0) {
        return res.status(400).json({
          message: `该考试已有 ${submissionCount} 份答卷，删除会一并清除全部成绩与判分记录；如需清理请联系管理员`,
        });
      }
    }

    // 使用事务显式清理全部关联记录，避免外键约束导致删除失败、留下孤儿考试
    const examId = req.params.id;
    await prisma.$transaction(async (tx) => {
      // 1. 考场学生（间接关联，无级联）
      await tx.examRoomStudent.deleteMany({ where: { assignment: { examId } } });
      // 2. 考试场次
      await tx.examSession.deleteMany({ where: { examId } });
      // 3. 考生答卷（其详情/验证结果通过 onDelete: Cascade 级联）
      await tx.studentSubmission.deleteMany({ where: { examId } });
      // 4. 行为日志 / 行为分析报告
      await tx.studentBehaviorLog.deleteMany({ where: { examId } });
      await tx.behaviorAnalysisReport.deleteMany({ where: { examId } });
      // 5. 表格分配 / 考场分配 / 考试题目（schema 有级联，显式清理更稳）
      await tx.examTableAssignment.deleteMany({ where: { examId } });
      await tx.examRoomAssignment.deleteMany({ where: { examId } });
      await tx.examQuestion.deleteMany({ where: { examId } });
      // 6. 考试主体
      await tx.exam.delete({ where: { id: examId } });
    });

    res.json({ message: '删除成功' });
  } catch (err: any) {
    console.error('删除考试失败:', err);
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ message: '该考试存在关联数据无法删除，请先清理相关记录' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/exams/:id/questions — 设置考试题目
examRouter.put('/:id/questions', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    // ✅ 所有权检查
    if (req.user!.role !== 'admin' && exam.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能修改自己创建的考试题目' });
    }
    if (exam.status === 'in_progress' || exam.status === 'ended') {
      return res.status(400).json({ message: '考试已开始或已结束，无法修改题目' });
    }

    const { questionIds } = examQuestionSchema.parse(req.body);

    // 数据范围 P2：只能挂载自己可见池（本院系/校级/本人）里的题目。
    // 必须在 deleteMany 之前 —— 先删后报错会把考试原有题目清光
    const scope = scopeCtxOf(req);
    const ids = [...new Set(questionIds.map(q => q.questionId))];
    if (ids.length > 0) {
      const visible = await prisma.question.findMany({
        where: { AND: [{ id: { in: ids } }, await questionWhere(scope)] },
        select: { id: true },
      });
      if (visible.length !== ids.length) {
        return res.status(403).json({ message: '包含不在你可见题库范围内的题目（本院系 / 校级 / 本人）' });
      }
    }

    // Delete existing and create new
    await prisma.examQuestion.deleteMany({ where: { examId: req.params.id } });
    if (questionIds.length > 0) {
      await prisma.examQuestion.createMany({
        data: questionIds.map(q => ({
          examId: req.params.id,
          questionId: q.questionId,
          sortOrder: q.sortOrder,
          scoreOverride: q.scoreOverride,
        })),
      });
    }

    // Update total score
    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds.map(q => q.questionId) } },
    });
    const totalScore = questionIds.reduce((sum, q) => {
      const question = questions.find(qq => qq.id === q.questionId);
      return sum + (q.scoreOverride ?? question?.score ?? 0);
    }, 0);

    await prisma.exam.update({
      where: { id: req.params.id },
      data: { totalScore },
    });

    const updated = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        examQuestions: {
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        },
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

// POST /api/exams/:id/publish
examRouter.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { examQuestions: true } },
        paper: { select: { _count: { select: { paperQuestions: true } } } },
        batch: { select: { status: true } },
      },
    });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    const hasQuestions = exam._count.examQuestions > 0 || (exam.paper?._count.paperQuestions ?? 0) > 0;
    if (!hasQuestions) {
      return res.status(400).json({ message: '考试没有题目，无法发布' });
    }
    if (exam.batch && exam.batch.status !== 'active') {
      return res.status(400).json({ message: '考试所属批次尚未激活，请先激活批次后再发布考试' });
    }

    // ✅ 校验：必须已分配考生，且所有考生都已分配 WPS 表格，否则不允许发布
    const studentIds = (await prisma.examRoomStudent.findMany({
      where: { assignment: { examId: req.params.id } },
      select: { studentId: true },
    })).map(s => s.studentId);
    if (studentIds.length === 0) {
      return res.status(400).json({ message: '考试尚未分配考生，无法发布，请先在考试设置中分配考生' });
    }
    const tableAssignedStudentIds = new Set(
      (await prisma.examTableAssignment.findMany({
        where: { examId: req.params.id },
        select: { studentId: true },
      })).map(t => t.studentId),
    );
    const missingTables = studentIds.filter(id => !tableAssignedStudentIds.has(id));
    if (missingTables.length > 0) {
      return res.status(400).json({ message: `还有 ${missingTables.length} 名考生未分配 WPS 表格，无法发布` });
    }

    // ── 组卷预检（硬约束）──
    // 预检不通过就不发布：否则学生会拿到缺题的卷子，而教师只能等开考后才发现。
    // 注意预检是「存在性上界」（不模拟跨题位占用），通过≠每份卷子必然填满，
    // 真实缺口以生成结果 unfilledSlots 为准（会汇总进 ExamPaperGeneration.summary）。
    const preflight = await preflightExamPaper(req.params.id);
    if (!preflight.ok) {
      // 首条 reason 拼进 message：前端目前只展示 message（明细要到 Task 7 才渲染），
      // 不带原因的话教师看到"N 个题位没有可用题目"也不知道该去修什么。
      return res.status(400).json({
        message: `组卷预检未通过：${preflight.issues[0].reason}（共 ${preflight.issues.length} 项）`,
        preflight: preflight.issues,
      });
    }

    // 发布时：有未来开始时间 → scheduled，否则 → published
    const newStatus = exam.startTime && new Date(exam.startTime) > new Date() ? 'scheduled' : 'published';

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    // 预生成：建/重置状态行后入队。调度失败**不能**让发布变成 500——考试此时已经发布了，
    // 正确语义是"发布成功 + 组卷欠账"（开考时现场生成兜底）。
    // 重复发布时必须把上一轮的运行痕迹清掉（startedAt/finishedAt/error/summary），
    // 否则前端会把旧进度/旧失败原因当成本轮状态展示。可空 Json 字段必须用
    // Prisma.JsonNull / Prisma.DbNull 显式表达清空（undefined 才是 no-op，裸 null 不可赋值）。
    let generationStatus: 'pending' | 'failed' = 'pending';
    try {
      await prisma.examPaperGeneration.upsert({
        where: { examId: req.params.id },
        create: { examId: req.params.id, status: 'pending', totalStudents: studentIds.length },
        update: {
          status: 'pending', totalStudents: studentIds.length,
          queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
          summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
        },
      });
      const enqueued = await enqueuePaperGeneration(req.params.id);
      if (!enqueued.queued) {
        generationStatus = 'failed';
        await prisma.examPaperGeneration.update({
          where: { examId: req.params.id },
          data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
        });
      }
    } catch (err) {
      generationStatus = 'failed';
      logger.error({ err }, '组卷预生成调度失败');
      // 尽力标记失败（upsert 成功时才有行；连行都没建时，开考兜底仍然成立）
      await prisma.examPaperGeneration
        .updateMany({ where: { examId: req.params.id }, data: { status: 'failed', error: '组卷调度失败；开考时将现场生成' } })
        .catch(() => {});
    }

    // 发布本身不因队列/调度失败而失败（开考现场生成兜底），但要把真实状态告诉前端
    res.json({ ...updated, paperGeneration: { status: generationStatus } });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id/paper-generation —— 组卷状态与质量报告
examRouter.get('/:id/paper-generation', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权查看该考试的组卷状态');

    const gen = await prisma.examPaperGeneration.findUnique({ where: { examId: req.params.id } });
    const progress = await getPaperGenerationProgress(req.params.id);
    res.json({
      status: gen?.status ?? 'none',
      ...progress,
      summary: gen?.summary ?? null,
      unfilledSlots: gen?.unfilledSlots ?? null,
      error: gen?.error ?? null,
      queuedAt: gen?.queuedAt ?? null,
      startedAt: gen?.startedAt ?? null,
      finishedAt: gen?.finishedAt ?? null,
    });
  } catch (err) {
    logger.error({ err, examId: req.params.id }, '读取组卷状态失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id/paper-generation/anomalies —— 放宽/修复过的卷子（教师排查用）
// 与上面的状态汇总同源：pickMeta.level 由组卷器写入，strict 以外的档位都说明该题位
// 是「降级」选出来的，教师需要知道哪些学生的卷子受影响，才能决定换卷还是接受。
examRouter.get('/:id/paper-generation/anomalies', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权查看该考试的组卷状态');

    const rows = await prisma.studentExamQuestion.findMany({
      where: { examId: req.params.id },
      select: {
        studentId: true, slotIndex: true, questionId: true, pickMeta: true,
        question: { select: { title: true } },
      },
      // 确定性：分页/截断结果稳定
      orderBy: [{ studentId: 'asc' }, { slotIndex: 'asc' }],
    });

    const byStudent = new Map<string, Array<{
      slotIndex: number; questionId: string; title: string; level: string; repairedFrom: string | null;
    }>>();
    for (const r of rows) {
      const meta = r.pickMeta as any;
      const level = meta?.level;
      // 无 pickMeta 的历史快照无从判断档位，按 strict 处理（不制造噪音）
      if (!level || level === 'strict') continue;
      const list = byStudent.get(r.studentId) ?? [];
      list.push({
        slotIndex: r.slotIndex,
        questionId: r.questionId,
        title: r.question?.title ?? '',
        level,
        repairedFrom: meta?.repairedFrom ?? null,
      });
      byStudent.set(r.studentId, list);
    }

    // 上限 50 人：这个接口是排查用，不是导出；超出的部分教师可以按学号定位后重查
    const allIds = [...byStudent.keys()];
    const ids = allIds.slice(0, 50);
    const users = ids.length > 0
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, realName: true, username: true } })
      : [];
    const nameOf = new Map(users.map(u => [u.id, u.realName || u.username]));
    res.json({
      truncated: allIds.length > ids.length,
      students: ids.map(id => ({ studentId: id, name: nameOf.get(id) ?? id, slots: byStudent.get(id) })),
    });
  } catch (err) {
    logger.error({ err, examId: req.params.id }, '读取异常卷子失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

// 「已开考」状态集合：这些提交一旦存在，对应学生的卷子快照绝不能再动
const STARTED_SUBMISSION_STATUSES = ['in_progress', 'submitted', 'grading', 'graded'] as const;

// POST /api/exams/:id/paper-generation/retry —— 补生成 / 重新组卷
examRouter.post('/:id/paper-generation/retry', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权操作该考试的组卷');

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (exam.status === 'draft') {
      // 草稿期预生成的快照会在发布后被幂等早退保留，教师随后改卷就不生效了——只允许发布后触发
      return res.status(409).json({ message: '考试尚未发布，发布后会自动预生成' });
    }
    if (exam.status === 'ended' || exam.status === 'cancelled' || exam.status === 'archived') {
      return res.status(409).json({ message: '考试已结束/取消，无法重新组卷' });
    }

    // 已有任务在跑时重试只会"删了快照但任务被去重忽略"，直接拒绝
    const gen = await prisma.examPaperGeneration.findUnique({
      where: { examId: req.params.id },
      select: { status: true },
    });
    if (gen?.status === 'running') {
      return res.status(409).json({ message: '组卷任务正在执行，请等待完成后再试' });
    }

    const started = await prisma.studentSubmission.count({
      where: { examId: req.params.id, status: { in: [...STARTED_SUBMISSION_STATUSES] } },
    });

    if (started > 0) {
      // 补生成：只补缺，不动已有快照。状态行可能因历史原因缺失，先确保它存在，
      // 否则 Worker 的 updateMany 无处可写，GET 会一直显示 status:'none'。
      const totalStudents = await prisma.examRoomStudent.count({ where: { assignment: { examId: req.params.id } } });
      await prisma.examPaperGeneration.upsert({
        where: { examId: req.params.id },
        create: { examId: req.params.id, status: 'pending', totalStudents },
        update: { status: 'pending', error: null, queuedAt: new Date() },
      });
      const enq = await enqueuePaperGeneration(req.params.id);
      if (!enq.queued) {
        await prisma.examPaperGeneration.update({
          where: { examId: req.params.id },
          data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
        });
        return res.status(503).json({ message: '组卷队列不可用，请稍后重试' });
      }
      return res.json({ mode: 'fill-missing' });
    }

    // 重新组卷：先预检（避免清空后才发现组不出来），再清空重建
    const preflight = await preflightExamPaper(req.params.id);
    if (!preflight.ok) {
      return res.status(400).json({ message: '组卷预检未通过', preflight: preflight.issues });
    }

    // 原子守卫：只删「该生没有任何已开始提交」的快照。
    // 上面的 count 与此处 DELETE 之间学生可能恰好开考——开考事务把 submission 与
    // 快照一起提交，而这条 DELETE 在单条语句的可见性快照里求值：
    //   · 已提交开考 → 子查询看得到 submission → 该生快照不会被删；
    //   · 尚未提交 → 其快照对本语句不可见 → 也删不到。
    // 因此「已开考绝不动快照」不依赖 count 与 delete 之间的时间窗。
    await prisma.studentExamQuestion.deleteMany({
      where: {
        examId: req.params.id,
        student: {
          submissions: {
            none: { examId: req.params.id, status: { in: [...STARTED_SUBMISSION_STATUSES] } },
          },
        },
      },
    });

    const totalStudents = await prisma.examRoomStudent.count({ where: { assignment: { examId: req.params.id } } });
    // upsert 而非 delete+create：双击/并发重试不会撞 examId 唯一约束变成 500
    await prisma.examPaperGeneration.upsert({
      where: { examId: req.params.id },
      create: { examId: req.params.id, status: 'pending', totalStudents },
      update: {
        status: 'pending', totalStudents,
        queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
        summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
      },
    });
    const enq = await enqueuePaperGeneration(req.params.id);
    if (!enq.queued) {
      await prisma.examPaperGeneration.update({
        where: { examId: req.params.id },
        data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
      });
      return res.status(503).json({ message: '组卷队列不可用，已标记为失败；开考时将现场生成' });
    }
    res.json({ mode: 'regenerate' });
  } catch (err) {
    logger.error({ err, examId: req.params.id }, '重新触发组卷失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/unpublish — 撤销发布（已发布 → 草稿）
examRouter.post('/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'published' && exam.status !== 'scheduled') {
      return res.status(400).json({ message: '只有已发布或已排期的考试才能撤销发布' });
    }

    // ⚠️ 必须同时收卷：随到随考（flexible）考试的 startTime/endTime 为 null，
    // 考试状态长期停在 published，此时已经有学生在作答。若只把状态改回 draft，
    // 这些答卷会永久卡在 in_progress —— 所有兜底只扫 in_progress/published 的"考试"，
    // 而它已变成 draft；教师阅卷列表（只查 submitted）也看不到。
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.exam.update({
        where: { id: req.params.id },
        data: { status: 'draft' },
      });
      const count = await finalizeExamSubmissions(req.params.id, new Date(), tx);
      if (count > 0) {
        console.log(`[exam/unpublish] exam ${req.params.id}: auto-submitted ${count} stale submissions`);
      }
      return result;
    }, { timeout: 30_000 });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/start
examRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'published' && exam.status !== 'scheduled') {
      return res.status(400).json({ message: '考试未发布或已排期，无法开始' });
    }

    // ✅ 校验：所有已分配考生必须已分配 WPS 表格，否则不允许开始
    const startStudentIds = (await prisma.examRoomStudent.findMany({
      where: { assignment: { examId: req.params.id } },
      select: { studentId: true },
    })).map(s => s.studentId);
    const startTableIds = new Set(
      (await prisma.examTableAssignment.findMany({
        where: { examId: req.params.id },
        select: { studentId: true },
      })).map(t => t.studentId),
    );
    const missingStartTables = startStudentIds.filter(id => !startTableIds.has(id));
    if (missingStartTables.length > 0) {
      return res.status(400).json({ message: `还有 ${missingStartTables.length} 名考生未分配 WPS 表格，无法开始考试` });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'in_progress', startTime: new Date() },
    });

    // 级联更新考场预约状态
    await prisma.examRoomAssignment.updateMany({
      where: { examId: req.params.id, status: 'scheduled' },
      data: { status: 'in_progress' },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/end
examRouter.post('/:id/end', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'in_progress') {
      return res.status(400).json({ message: '考试未在进行中' });
    }

    const endedAt = new Date();

    // ⚠️ 整体事务：考试置 ended、考场收尾、学生答卷收卷必须同生共死。
    // 若分步执行且中途失败，exam 已是 ended 便不再匹配任何兜底扫描条件
    // （兜底只扫 in_progress/published 的考试），答卷会永久卡在 in_progress
    // —— 教师阅卷列表看不到、判不了分。
    let submittedCount = 0;
    await prisma.$transaction(async (tx) => {
      await tx.exam.update({
        where: { id: req.params.id },
        data: { status: 'ended', endTime: endedAt },
      });
      await tx.examRoomAssignment.updateMany({
        where: { examId: req.params.id, status: 'in_progress' },
        data: { status: 'completed' },
      });
      submittedCount = await finalizeExamSubmissions(req.params.id, endedAt, tx);
    }, { timeout: 30_000 });

    if (submittedCount > 0) {
      console.log(`[exam/end] exam ${req.params.id}: auto-submitted ${submittedCount} stale submissions`);
    }

    const updated = await prisma.exam.findUnique({ where: { id: req.params.id } });
    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/archive — 归档考试（ended → archived）
examRouter.post('/:id/archive', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (exam.status !== 'ended') {
      return res.status(400).json({ message: '只有已结束的考试才能归档' });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'archived' },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/cancel — 取消考试（draft/published/scheduled → cancelled）
examRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (!['draft', 'published', 'scheduled'].includes(exam.status)) {
      return res.status(400).json({ message: `当前状态 ${exam.status} 无法取消` });
    }

    // 与 unpublish 同理：取消考试时也有人在作答（尤其随到随考），必须一并收卷，
    // 否则答卷永久悬空在 in_progress。
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.exam.update({
        where: { id: req.params.id },
        data: { status: 'cancelled' },
      });
      const count = await finalizeExamSubmissions(req.params.id, new Date(), tx);
      if (count > 0) {
        console.log(`[exam/cancel] exam ${req.params.id}: auto-submitted ${count} stale submissions`);
      }
      return result;
    }, { timeout: 30_000 });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/revive — 恢复考试（cancelled → draft）
examRouter.post('/:id/revive', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (exam.status !== 'cancelled') {
      return res.status(400).json({ message: '只有已取消的考试才能恢复' });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'draft' },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id/submissions
examRouter.get('/:id/submissions', async (req: Request, res: Response) => {
  try {
    const access = await assertExamAccess(scopeCtxOf(req), req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权查看该考试的答卷');

    const [submissions, assignments] = await Promise.all([
      prisma.studentSubmission.findMany({
        where: { examId: req.params.id },
        include: {
          student: { select: { id: true, username: true, realName: true } },
          _count: { select: { details: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.examTableAssignment.findMany({
        where: { examId: req.params.id },
        select: { studentId: true, fileId: true, shareUrl: true },
      }),
    ]);

    // 构建考生ID -> 表格分配信息的映射
    const assignmentMap = new Map(
      assignments.map((a) => [a.studentId, { fileId: a.fileId, shareUrl: a.shareUrl }])
    );

    // 为 tableSpaceId 为空的提交补填表格关联数据
    const enriched = submissions.map((sub) => {
      if (sub.tableSpaceId) return sub;
      const assignment = assignmentMap.get(sub.studentId);
      if (assignment) {
        return { ...sub, tableSpaceId: assignment.fileId };
      }
      return sub;
    });

    res.json(enriched);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/submissions/:studentId/force-submit — 监考老师强制交卷
// 状态机与学生自交卷完全一致：只允许 in_progress → submitted（条件更新防并发覆盖），
// 不触发自动判分（判分仍由教师经「自动阅卷」发起，与既有口径一致）。
examRouter.post('/:id/submissions/:studentId/force-submit', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const submission = await prisma.studentSubmission.findUnique({
      where: { examId_studentId: { examId: req.params.id, studentId: req.params.studentId } },
      include: { student: { select: { realName: true, username: true } } },
    });
    if (!submission) {
      return res.status(404).json({ message: '该考生尚未开始作答，无法强制交卷' });
    }

    const result = await prisma.studentSubmission.updateMany({
      where: { id: submission.id, status: 'in_progress' },
      data: { status: 'submitted', submittedAt: new Date(), isAutoSubmitted: false },
    });
    if (result.count === 0) {
      return res.status(400).json({ message: `当前状态（${submission.status}）不可强制交卷` });
    }

    // 实时推送给监考页；学生端由心跳回传状态自行感知（≤30s）
    emitStudentSubmit(req.params.id, req.params.studentId, submission.student.realName || submission.student.username);

    res.json({ success: true });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/submissions/:studentId/resume — 允许续考（把误交/中断的答卷退回作答中）
// 仅允许「已交卷且尚未进入判分」的答卷回退：一旦 grading/graded，续考会使判分结果与作答
// 状态不一致（判分读的是当时的表格 Schema），必须先在阅卷侧处理，故明确拒绝。
examRouter.post('/:id/submissions/:studentId/resume', async (req: Request, res: Response) => {
  try {
    const access = await checkExamAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      select: { status: true },
    });
    if (exam && (exam.status === 'ended' || exam.status === 'cancelled')) {
      return res.status(400).json({ message: '考试已结束/已取消，续考无意义；如需补考请新建考试' });
    }

    const submission = await prisma.studentSubmission.findUnique({
      where: { examId_studentId: { examId: req.params.id, studentId: req.params.studentId } },
    });
    if (!submission) {
      return res.status(404).json({ message: '该考生没有答卷记录' });
    }

    const result = await prisma.studentSubmission.updateMany({
      where: { id: submission.id, status: 'submitted' },
      data: { status: 'in_progress', submittedAt: null, isAutoSubmitted: false },
    });
    if (result.count === 0) {
      return res.status(400).json({
        message: submission.status === 'in_progress'
          ? '该考生正在作答中，无需续考'
          : `当前状态（${submission.status}）不可续考：答卷已进入判分流程，请先在阅卷侧处理`,
      });
    }

    // 学生若仍在线（socket 已建立），把状态推回"答题中"；离线则由其重新进入考场时读到
    emitStudentUpdate(req.params.id, req.params.studentId, { status: 'in_progress', submittedAt: null });

    res.json({ success: true });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id/students — 获取考试已分配学生列表
examRouter.get('/:id/students', authenticate, authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const access = await assertExamAccess(scopeCtxOf(req), req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权查看该考试的考生名单');

    const { id } = req.params;
    const exam = await prisma.exam.findUnique({
      where: { id },
      include: {
        assignments: {
          include: {
            room: { select: { id: true, code: true, name: true } },
            students: {
              include: {
                student: {
                  select: {
                    id: true,
                    realName: true,
                    username: true,
                    studentId: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!exam) return res.status(404).json({ message: '考试不存在' });

    const studentMap = new Map();
    for (const assignment of exam.assignments) {
      for (const rs of assignment.students) {
        studentMap.set(rs.student.id, rs.student);
      }
    }

    res.json({ students: Array.from(studentMap.values()) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id/room-assignments
examRouter.get('/:id/room-assignments', async (req: Request, res: Response) => {
  try {
    const access = await assertExamAccess(scopeCtxOf(req), req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '无权查看该考试的考场安排');

    const assignments = await prisma.examRoomStudent.findMany({
      where: { assignment: { examId: req.params.id } },
      include: {
        assignment: {
          include: {
            room: { select: { id: true, code: true, name: true } },
          },
        },
        student: { select: { id: true, username: true, realName: true } },
      },
    });

    res.json(
      assignments.map(a => ({
        studentId: a.studentId,
        // 监考页用姓名渲染「应参考名单」（缺考学生没有实时记录，姓名只能从这里来）
        studentName: a.student.realName || a.student.username,
        roomId: a.assignment.roomId,
        roomCode: a.assignment.room.code,
        roomName: a.assignment.room.name,
        seatNumber: a.seatNumber,
      }))
    );
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
