/**
 * 导出中心数据范围回归测试（P1）：
 * - 教师导出学生 → 自动限定任教班级
 * - 教师导出答卷/行为/批改留痕 → 自动限定「我创建/监考」的考试
 * - 审计日志：教师 403（请求阶段就拒绝，不建任务）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ message: '未认证' });
      const userId = (req.headers['x-test-user'] as string) || 'u-1';
      req.user = { id: userId, userId, username: userId, role, permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    teacherClass: { findMany: vi.fn() },
    exam: { findMany: vi.fn(), findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    studentSubmission: { findMany: vi.fn() },
    studentBehaviorLog: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    examBatch: { findMany: vi.fn() },
    examRoom: { findMany: vi.fn() },
    gradeReviewLog: { findMany: vi.fn() },
    exportTask: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { exportRouter, fetchEntityData } from '../export';
import { makeScopeCtx } from '../../services/data-scope';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/export', exportRouter);
  return app;
}

const TEACHER = () => makeScopeCtx('t-1', 'teacher');
const ADMIN = () => makeScopeCtx('admin-1', 'admin');

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: 'c-1' }]);
  mockPrisma.exam.findMany.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.studentSubmission.findMany.mockResolvedValue([]);
  mockPrisma.studentBehaviorLog.findMany.mockResolvedValue([]);
  mockPrisma.auditLog.findMany.mockResolvedValue([]);
  mockPrisma.examBatch.findMany.mockResolvedValue([]);
  mockPrisma.examRoom.findMany.mockResolvedValue([]);
  mockPrisma.gradeReviewLog.findMany.mockResolvedValue([]);
});

describe('fetchEntityData 范围', () => {
  it('student：教师限定任教班级', async () => {
    await fetchEntityData(TEACHER(), 'student');
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ role: 'student', classRoomId: { in: ['c-1'] } });
  });

  it('submission：教师限定「我创建/监考」的考试（关系过滤）', async () => {
    await fetchEntityData(TEACHER(), 'submission');
    const where = mockPrisma.studentSubmission.findMany.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({
      exam: {
        OR: [
          { createdBy: 't-1' },
          { assignments: { some: { invigilators: { some: { id: 't-1' } } } } },
        ],
      },
    });
  });

  it('batch：教师限定自己创建的批次', async () => {
    await fetchEntityData(TEACHER(), 'batch');
    const where = mockPrisma.examBatch.findMany.mock.calls[0][0].where;
    expect(where.AND[1]).toEqual({ createdBy: 't-1' });
  });

  it('audit：非管理员直接抛错（不查库）', async () => {
    await expect(fetchEntityData(TEACHER(), 'audit')).rejects.toThrow('审计日志仅校级管理员可导出');
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('audit：管理员正常查询', async () => {
    await fetchEntityData(ADMIN(), 'audit');
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('POST /trigger 审计导出拦截', () => {
  it('教师导出 audit → 403 且不创建任务', async () => {
    const res = await request(makeApp())
      .post('/api/export/trigger')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ entityType: 'audit', format: 'excel' });
    expect(res.status).toBe(403);
    expect(mockPrisma.exportTask.create).not.toHaveBeenCalled();
  });
});
