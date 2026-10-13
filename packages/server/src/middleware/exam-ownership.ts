/**
 * 兼容层 —— 归属校验的实现已迁入 services/data-scope.ts（2026-10-13，数据范围收口 P1）。
 *
 * 保留本文件旧签名（接收 req）是为了不动 6 个既有调用点；P4 清理时把调用点直接
 * 改为 data-scope 并删除本文件。新代码请直接从 services/data-scope 导入。
 *
 * 语义变化（有意为之）：checkStudentAccess 不再对「未分班学生」放行 ——
 * 旧宽松是为了「导入后尚未分班时教师点不动学生」，现在未分班学生由管理员负责分班，
 * 考试数据由 assertExamAccess 独立把关（两条轴分离），宽松已无必要。
 */
import { Request } from 'express';
import {
  scopeCtxOf,
  assertExamAccess,
  assertBatchAccess,
  assertStudentAccess,
  assertSubmissionAccess,
} from '../services/data-scope';

export type { AccessVerdict } from '../services/data-scope';
export { denyAccess } from '../services/data-scope';

export async function checkExamAccess(req: Request, examId: string) {
  return assertExamAccess(scopeCtxOf(req), examId);
}

export async function checkBatchAccess(req: Request, batchId: string) {
  return assertBatchAccess(scopeCtxOf(req), batchId);
}

export async function checkStudentAccess(req: Request, studentId: string) {
  return assertStudentAccess(scopeCtxOf(req), studentId);
}

export async function checkSubmissionAccess(req: Request, submissionId: string) {
  return assertSubmissionAccess(scopeCtxOf(req), submissionId);
}
