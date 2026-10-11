/**
 * 考试相关资源的归属校验（教师侧越权防护）
 *
 * 历史缺陷：绝大多数教师接口只校验角色（`authorize('teacher','admin')`），
 * 不校验资源归属。结果是任意教师可以：
 *   - 提前结束他人正在进行中的考试（触发全员强制交卷）
 *   - 给他人答卷批量判分、逐题改分、出成绩
 *   - 删除他人批次（级联把已发布考试退回草稿）
 *
 * 判定口径（满足其一即可放行）：
 *   - admin：全放行
 *   - 考试创建者（Exam.createdBy）
 *   - 该考试的监考老师（ExamRoomAssignment.invigilators 含该用户）
 *     —— 允许监考老师协同处理，避免把合理的多人协作误伤成越权
 */
import { Request } from 'express';
import { prisma } from '../config/prisma';

export type AccessVerdict = 'ok' | 'forbidden' | 'not-found';

export async function checkExamAccess(req: Request, examId: string): Promise<AccessVerdict> {
  if (req.user?.role === 'admin') {
    // admin 仍需确认资源存在，否则会把"改错 ID"误判成成功
    const exists = await prisma.exam.findUnique({ where: { id: examId }, select: { id: true } });
    return exists ? 'ok' : 'not-found';
  }

  const userId = req.user?.userId;
  if (!userId) return 'forbidden';

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: {
      createdBy: true,
      assignments: { select: { invigilators: { select: { id: true } } } },
    },
  });
  if (!exam) return 'not-found';
  if (exam.createdBy === userId) return 'ok';
  if (exam.assignments.some(a => a.invigilators.some(u => u.id === userId))) return 'ok';
  return 'forbidden';
}

/**
 * 批次归属校验。批次的级联影响面很大（下线批次会把其下已发布考试全部退回草稿、
 * 完成批次会结束全部子考试），因此与考试同口径：admin / 创建者放行。
 */
export async function checkBatchAccess(req: Request, batchId: string): Promise<AccessVerdict> {
  const batch = await prisma.examBatch.findUnique({
    where: { id: batchId },
    select: { createdBy: true },
  });
  if (!batch) return 'not-found';
  if (req.user?.role === 'admin') return 'ok';
  if (batch.createdBy === req.user?.userId) return 'ok';
  return 'forbidden';
}

/**
 * 学生归属校验：教师只能操作自己带的班级里的学生。
 *
 * 注意一处刻意的宽松：**未分班**的学生（classRoomId 为空）对所有教师放行。
 * 因为班级是后配的，若严格拒绝，导入后尚未分班的学生会让所有教师都"点不动"，
 * 影响正常教学；而这类学生不归属任何教师，不存在"抢别人班学生"的问题。
 */
export async function checkStudentAccess(req: Request, studentId: string): Promise<AccessVerdict> {
  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: { id: true, classRoomId: true },
  });
  if (!student) return 'not-found';
  if (req.user?.role === 'admin') return 'ok';
  if (req.user?.userId === studentId) return 'ok';
  if (req.user?.role !== 'teacher') return 'forbidden';
  if (!student.classRoomId) return 'ok';

  const link = await prisma.teacherClass.findFirst({
    where: { teacherId: req.user.userId, classId: student.classRoomId },
    select: { id: true },
  });
  return link ? 'ok' : 'forbidden';
}

export async function checkSubmissionAccess(req: Request, submissionId: string): Promise<AccessVerdict> {
  const submission = await prisma.studentSubmission.findUnique({
    where: { id: submissionId },
    select: { examId: true },
  });
  if (!submission) return 'not-found';
  return checkExamAccess(req, submission.examId);
}

/** 统一的拒绝响应，避免各路由重复写文案 */
export function denyAccess(res: any, verdict: Exclude<AccessVerdict, 'ok'>) {
  if (verdict === 'not-found') {
    return res.status(404).json({ message: '资源不存在' });
  }
  return res.status(403).json({ message: '无权操作他人创建的考试，请联系考试创建者或管理员' });
}
