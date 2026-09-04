import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { autoEndExpiredExams, finalizeExamSubmissions } from '../utils/exam-utils';

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

    const { page = '1', pageSize = '20', status, mode } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (status) where.status = String(status);
    if (mode) where.mode = String(mode);

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

    res.json({ data: exams, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/exams/:id
examRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    await autoEndExpiredExams();

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
    const exam = await prisma.exam.create({
      data: {
        ...rest,
        startTime: data.startTime ? new Date(data.startTime) : null,
        endTime: data.endTime ? new Date(data.endTime) : null,
        createdBy: req.user!.userId,
        paperId: paperId ?? null,
        batchId: batchId ?? null,
      },
    });

    // 如果绑定了试卷，自动同步试卷题目到考试
    if (paperId) {
      const paperQuestions = await prisma.paperQuestion.findMany({
        where: { paperId },
        include: { question: true },
        orderBy: { sortOrder: 'asc' },
      });

      if (paperQuestions.length > 0) {
        await prisma.examQuestion.createMany({
          data: paperQuestions.map(pq => ({
            examId: exam.id,
            questionId: pq.questionId,
            sortOrder: pq.sortOrder,
            scoreOverride: pq.score ?? null,
          })),
        });

        const totalScore = paperQuestions.reduce((sum, pq) => sum + (pq.score ?? pq.question?.score ?? 0), 0);
        await prisma.exam.update({
          where: { id: exam.id },
          data: { totalScore },
        });
      }
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

    // 如果更换了试卷绑定，重新同步 ExamQuestion 和 totalScore
    const newPaperId = paperId ?? null;
    if (newPaperId !== exam.paperId) {
      // 删除旧的题目关联
      await prisma.examQuestion.deleteMany({ where: { examId: req.params.id } });

      if (newPaperId) {
        // 同步新试卷的题目
        const paperQuestions = await prisma.paperQuestion.findMany({
          where: { paperId: newPaperId },
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        });

        if (paperQuestions.length > 0) {
          await prisma.examQuestion.createMany({
            data: paperQuestions.map(pq => ({
              examId: req.params.id,
              questionId: pq.questionId,
              sortOrder: pq.sortOrder,
              scoreOverride: pq.score ?? null,
            })),
          });
        }

        const totalScore = paperQuestions.reduce((sum, pq) => sum + (pq.score ?? pq.question?.score ?? 0), 0);
        await prisma.exam.update({
          where: { id: req.params.id },
          data: { totalScore },
        });
      } else {
        // 清空试卷后重置总分
        await prisma.exam.update({
          where: { id: req.params.id },
          data: { totalScore: 100 },
        });
      }
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

    // 发布时：有未来开始时间 → scheduled，否则 → published
    const newStatus = exam.startTime && new Date(exam.startTime) > new Date() ? 'scheduled' : 'published';

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: newStatus },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/unpublish — 撤销发布（已发布 → 草稿）
examRouter.post('/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });

    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'published' && exam.status !== 'scheduled') {
      return res.status(400).json({ message: '只有已发布或已排期的考试才能撤销发布' });
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

// POST /api/exams/:id/start
examRouter.post('/:id/start', async (req: Request, res: Response) => {
  try {
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
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) {
      return res.status(404).json({ message: '考试不存在' });
    }
    if (exam.status !== 'in_progress') {
      return res.status(400).json({ message: '考试未在进行中' });
    }

    const endedAt = new Date();
    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'ended', endTime: endedAt },
    });

    // 级联更新考场预约状态
    await prisma.examRoomAssignment.updateMany({
      where: { examId: req.params.id, status: 'in_progress' },
      data: { status: 'completed' },
    });

    // 全局状态兜底：强制回收所有"考试中"的提交，标记为系统代交
    const submittedCount = await finalizeExamSubmissions(req.params.id, endedAt);
    if (submittedCount > 0) {
      console.log(`[exam/end] exam ${req.params.id}: auto-submitted ${submittedCount} stale submissions`);
    }

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/archive — 归档考试（ended → archived）
examRouter.post('/:id/archive', async (req: Request, res: Response) => {
  try {
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
    const exam = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (!['draft', 'published', 'scheduled'].includes(exam.status)) {
      return res.status(400).json({ message: `当前状态 ${exam.status} 无法取消` });
    }

    const updated = await prisma.exam.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exams/:id/revive — 恢复考试（cancelled → draft）
examRouter.post('/:id/revive', async (req: Request, res: Response) => {
  try {
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

// GET /api/exams/:id/students — 获取考试已分配学生列表
examRouter.get('/:id/students', authenticate, authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
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
