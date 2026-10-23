/**
 * 异常卷子接口：只列放宽/修复过的卷子，教师排查用。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});

const { sqFindMany, userFindMany, examFindUnique } = vi.hoisted(() => ({
  sqFindMany: vi.fn(),
  userFindMany: vi.fn(),
  examFindUnique: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  prisma: {
    exam: { findUnique: examFindUnique },
    studentExamQuestion: { findMany: sqFindMany },
    user: { findMany: userFindMany },
  },
}));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

import { examRouter } from '../exams';

const app = express();
app.use(express.json());
app.use('/api/exams', examRouter);

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue({ id: 'e-1', createdBy: 't-1', status: 'published', assignments: [] });
  userFindMany.mockResolvedValue([{ id: 's-1', realName: '张三', username: 'stu1' }]);
});

describe('GET /api/exams/:id/paper-generation/anomalies', () => {
  it('只返回含非 strict pickMeta 的学生，并带姓名/题目/级别', async () => {
    sqFindMany.mockResolvedValue([
      { studentId: 's-1', slotIndex: 0, questionId: 'q-1', pickMeta: { level: 'strict' }, question: { title: 'A' } },
      { studentId: 's-1', slotIndex: 1, questionId: 'q-2', pickMeta: { level: 'relax-schemaRefs' }, question: { title: 'B' } },
      { studentId: 's-1', slotIndex: 2, questionId: 'q-4', pickMeta: { level: 'repair', repairedFrom: 'q-old' }, question: { title: 'D' } },
      { studentId: 's-2', slotIndex: 0, questionId: 'q-3', pickMeta: { level: 'strict' }, question: { title: 'C' } },
    ]);
    const res = await request(app).get('/api/exams/e-1/paper-generation/anomalies');
    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(false);
    expect(res.body.students).toHaveLength(1);
    expect(res.body.students[0]).toMatchObject({
      studentId: 's-1',
      name: '张三',
      slots: [
        { slotIndex: 1, questionId: 'q-2', title: 'B', level: 'relax-schemaRefs', repairedFrom: null },
        { slotIndex: 2, questionId: 'q-4', title: 'D', level: 'repair', repairedFrom: 'q-old' },
      ],
    });
  });

  it('全部 strict → 空列表', async () => {
    sqFindMany.mockResolvedValue([
      { studentId: 's-2', slotIndex: 0, questionId: 'q-3', pickMeta: { level: 'strict' }, question: { title: 'C' } },
    ]);
    const res = await request(app).get('/api/exams/e-1/paper-generation/anomalies');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ truncated: false, students: [] });
    expect(userFindMany).not.toHaveBeenCalled();
  });
});
