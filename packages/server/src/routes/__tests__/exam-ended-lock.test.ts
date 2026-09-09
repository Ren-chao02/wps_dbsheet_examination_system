/**
 * 已结束考试锁定测试 — 考试状态为 ended 后禁止再编辑/修改配置
 *
 * 覆盖：
 * - PUT /api/exams/:id：ended 考试返回 400（新增）
 * - POST /api/exam-room-assignments/exams/:examId/rooms：ended 考试返回 400（新增）
 * - POST /api/exam-table-assignments/:examId/bulk：ended 考试返回 400（新增）
 * - in_progress 既有编辑限制不回归（PUT 仍 400）
 * - ended 之外的状态不被误伤（守卫放行，next 被调用）
 *
 * 通过 vi.mock 替换 authenticate / authorize（免 JWT）、config/prisma（免 DB）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ============================================================
// Mock：authenticate / authorize — 免 JWT、免 DB
// ============================================================
vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u-teacher-1', userId: 'u-teacher-1', username: 'teacher1', role: 'teacher' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

// ============================================================
// Mock：config/prisma — 免 DB
// ============================================================
const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    exam: { findUnique: vi.fn(), update: vi.fn() },
    examRoom: { findUnique: vi.fn() },
    examRoomAssignment: { findUnique: vi.fn(), create: vi.fn() },
    examTableAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { mockPrisma: prisma };
});

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { examRouter } from '../exams';
import { examRoomAssignmentRouter } from '../exam-room-assignments';
import { examTableAssignmentRouter } from '../exam-table-assignments';

function makeApp(router: express.Router, basePath = '/api') {
  const app = express();
  app.use(express.json());
  app.use(basePath, router);
  return app;
}

const ENDED_EXAM = {
  id: 'exam-1',
  title: '已结束考试',
  status: 'ended',
  createdBy: 'u-teacher-1',
  batchId: null,
  paperId: null,
  startTime: null,
  endTime: null,
};

describe('已结束考试锁定', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('PUT /api/exams/:id', () => {
    it('考试已结束(ended)时拒绝编辑，返回 400', async () => {
      mockPrisma.exam.findUnique.mockResolvedValue(ENDED_EXAM);
      mockPrisma.exam.update.mockResolvedValue(ENDED_EXAM);

      const app = makeApp(examRouter, '/api/exams');
      const res = await request(app)
        .put('/api/exams/exam-1')
        .send({ title: '改名', mode: 'exam' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('已结束');
      // 守卫生效后不应继续走到数据库 update
      expect(mockPrisma.exam.update).not.toHaveBeenCalled();
    });

    it('考试进行中(in_progress)仍保持既有的禁止编辑限制', async () => {
      mockPrisma.exam.findUnique.mockResolvedValue({
        ...ENDED_EXAM,
        status: 'in_progress',
      });
      mockPrisma.exam.update.mockResolvedValue({ ...ENDED_EXAM, status: 'in_progress' });

      const app = makeApp(examRouter, '/api/exams');
      const res = await request(app)
        .put('/api/exams/exam-1')
        .send({ title: '改名', mode: 'exam' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/exam-room-assignments/exams/:examId/rooms', () => {
    it('考试已结束(ended)时拒绝分配考场，返回 400', async () => {
      const ROOM_ID = '00000000-0000-0000-0000-00000000000a';
      // 守卫与后续 handler 共用同一个 findUnique mock；返回对象需同时含 status 与时间字段
      mockPrisma.exam.findUnique.mockResolvedValue(ENDED_EXAM);
      mockPrisma.examRoom.findUnique.mockResolvedValue({ id: ROOM_ID, status: 'available' });
      mockPrisma.examRoomAssignment.findUnique.mockResolvedValue(null);
      mockPrisma.examRoomAssignment.create.mockResolvedValue({ id: 'assignment-1' });

      const app = makeApp(examRoomAssignmentRouter, '/api/exam-room-assignments');
      const res = await request(app)
        .post('/api/exam-room-assignments/exams/exam-1/rooms')
        .send({ roomId: ROOM_ID });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('已结束');
      expect(mockPrisma.examRoomAssignment.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/exam-table-assignments/:examId/bulk', () => {
    it('考试已结束(ended)时拒绝批量分配表格，返回 400', async () => {
      mockPrisma.exam.findUnique.mockResolvedValue(ENDED_EXAM);
      mockPrisma.examTableAssignment.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.examTableAssignment.createMany.mockResolvedValue({ count: 1 });

      const app = makeApp(examTableAssignmentRouter, '/api/exam-table-assignments');
      const res = await request(app)
        .post('/api/exam-table-assignments/exam-1/bulk')
        .send({
          items: [
            { studentId: 'stu-1', shareUrl: 'https://www.kdocs.cn/l/fileabc' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('已结束');
      expect(mockPrisma.examTableAssignment.createMany).not.toHaveBeenCalled();
    });
  });
});
