/**
 * 数据范围层（Data Scope）—— 「谁能看到哪些数据」的唯一规则出口
 *
 * 背景：此前的归属校验只有写路径（middleware/exam-ownership.ts），读路径大量裸查询；
 * 2026-10-11 全量走查发现除学生名册外，考试答卷/行为日志/导出等对任何教师全局可读。
 * 本模块把「角色 × 资源」的可见范围收敛为两种形态：
 *   1. where 构造器 —— 列表/统计/导出用。调用方必须用 AND 组合（search 等业务条件
 *      会占用 OR 字段，对象展开合并会互相覆盖）
 *   2. 断言 —— 单资源读写校验，吸收原 exam-ownership.ts 的全部函数
 * 规则表见 docs/superpowers/specs/2026-10-11-org-structure-data-scope-design.md §3。
 * 本模块不依赖 HTTP：输入 ScopeCtx、输出 where/判定，可直接单测。
 *
 * 本阶段（P1）只实现「教师 = 我创建/监考的考试 + 我任教班级的学生」；
 * 院系维度（院系管理员、院系共享池）随 P2/P3 在同一模块内扩展。
 */
import { Request } from 'express';
import { prisma } from '../config/prisma';

export type AccessVerdict = 'ok' | 'forbidden' | 'not-found';

export interface ScopeCtx {
  userId: string;
  role: string; // 'admin' | 'teacher' | 'student'
  isAdmin: boolean;
}

/** 从请求构造范围上下文。约定：每个 handler 只构造一次并向下传递（缓存挂在对象上）。 */
export function scopeCtxOf(req: Request): ScopeCtx {
  const role = req.user?.role ?? 'student';
  return { userId: req.user?.userId ?? '', role, isAdmin: role === 'admin' };
}

/** 便于单测直接构造 */
export function makeScopeCtx(userId: string, role: string): ScopeCtx {
  return { userId, role, isAdmin: role === 'admin' };
}

// ── 请求级缓存（WeakMap 挂在 ctx 对象上；同一请求内多处调用只查一次库） ──
const classIdsCache = new WeakMap<ScopeCtx, Promise<string[]>>();

/** 我任教（TeacherClass）的班级 ID 列表。admin 固定为 []（admin 走各自的全量分支）。 */
export function myClassIds(ctx: ScopeCtx): Promise<string[]> {
  let p = classIdsCache.get(ctx);
  if (!p) {
    p = ctx.isAdmin
      ? Promise.resolve([])
      : prisma.teacherClass
          .findMany({ where: { teacherId: ctx.userId }, select: { classId: true } })
          .then((rows) => rows.map((r) => r.classId));
    classIdsCache.set(ctx, p);
  }
  return p;
}

// ── where 构造器 ──

/** 学生名册范围：admin 全校；教师限任教班级。未分班学生（classRoomId 为空）不在任何教师范围内。 */
export async function studentWhere(ctx: ScopeCtx): Promise<Record<string, any>> {
  if (ctx.isAdmin) return { role: 'student' };
  return { role: 'student', classRoomId: { in: await myClassIds(ctx) } };
}

/** 考试范围：admin 全部；教师仅「我创建 + 我监考」。 */
export async function examWhere(ctx: ScopeCtx): Promise<Record<string, any>> {
  if (ctx.isAdmin) return {};
  return {
    OR: [
      { createdBy: ctx.userId },
      { assignments: { some: { invigilators: { some: { id: ctx.userId } } } } },
    ],
  };
}

/** 行为日志范围：admin 全部；教师仅其可见考试（我创建/监考）的行为数据。 */
export async function behaviorWhere(ctx: ScopeCtx): Promise<Record<string, any>> {
  if (ctx.isAdmin) return {};
  const exams = await prisma.exam.findMany({
    where: await examWhere(ctx),
    select: { id: true },
  });
  return { examId: { in: exams.map((e) => e.id) } };
}

// ── 单资源断言 ──

/**
 * 考试写/管理归属：admin（先确认资源存在，避免把「改错 ID」误判成成功）、
 * 创建者、监考老师放行 —— 监考协同处理是刻意保留的宽松。
 */
export async function assertExamAccess(ctx: ScopeCtx, examId: string): Promise<AccessVerdict> {
  if (ctx.isAdmin) {
    const exists = await prisma.exam.findUnique({ where: { id: examId }, select: { id: true } });
    return exists ? 'ok' : 'not-found';
  }
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      createdBy: true,
      assignments: { select: { invigilators: { select: { id: true } } } },
    },
  });
  if (!exam) return 'not-found';
  if (exam.createdBy === ctx.userId) return 'ok';
  if (exam.assignments.some((a) => a.invigilators.some((u) => u.id === ctx.userId))) return 'ok';
  return 'forbidden';
}

/** 批次归属：admin 或创建者（批次级联影响面大，与考试同口径）。 */
export async function assertBatchAccess(ctx: ScopeCtx, batchId: string): Promise<AccessVerdict> {
  const batch = await prisma.examBatch.findUnique({
    where: { id: batchId },
    select: { createdBy: true },
  });
  if (!batch) return 'not-found';
  if (ctx.isAdmin) return 'ok';
  if (batch.createdBy === ctx.userId) return 'ok';
  return 'forbidden';
}

/**
 * 学生归属：admin、本人、任教班级的教师放行。
 * 注意：**未分班学生（classRoomId 为空）不再对所有教师放行** —— 旧宽松是为了
 * 「导入后尚未分班时教师点不动学生」，现在未分班学生由管理员负责分班，
 * 而考试数据由 assertExamAccess 独立把关（两条轴分离），宽松已无必要。
 */
export async function assertStudentAccess(ctx: ScopeCtx, studentId: string): Promise<AccessVerdict> {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, classRoomId: true },
  });
  if (!student) return 'not-found';
  if (ctx.isAdmin) return 'ok';
  if (ctx.userId === studentId) return 'ok';
  if (ctx.role !== 'teacher') return 'forbidden';
  if (!student.classRoomId) return 'forbidden';
  const classIds = await myClassIds(ctx);
  return classIds.includes(student.classRoomId) ? 'ok' : 'forbidden';
}

/** 答卷归属：跟随其所属考试的归属。 */
export async function assertSubmissionAccess(ctx: ScopeCtx, submissionId: string): Promise<AccessVerdict> {
  const submission = await prisma.studentSubmission.findUnique({
    where: { id: submissionId },
    select: { examId: true },
  });
  if (!submission) return 'not-found';
  return assertExamAccess(ctx, submission.examId);
}

/** 统一的拒绝响应。message 可按场景定制（读场景文案与写场景不同）。 */
export function denyAccess(res: any, verdict: Exclude<AccessVerdict, 'ok'>, message?: string) {
  if (verdict === 'not-found') {
    return res.status(404).json({ message: '资源不存在' });
  }
  return res.status(403).json({ message: message ?? '无权操作他人创建的考试，请联系考试创建者或管理员' });
}
