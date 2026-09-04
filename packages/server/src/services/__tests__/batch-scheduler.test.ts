import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BatchScheduler 单元测试
 *
 * 重点验证：
 *  1. published 状态已被纳入自动流转，避免"考试已结束但仍显示已发布（待考）"的回归。
 *  2. 考试自动结束时会同步收尾 in_progress 的学生提交（submission），
 *     避免学生端永远显示"考试中"。详见 packages/server/src/services/batch-scheduler.ts。
 *  3. 不再覆盖 exam.endTime（保留原始结束时间）。
 */

// 用 vi.hoisted 提升 mock 引用，确保 vi.mock factory 内可访问
const {
  mockExamFindMany,
  mockExamUpdateMany,
  mockSubmissionUpdateMany,
  mockExamBatchFindMany,
  mockExamBatchUpdate,
} = vi.hoisted(() => ({
  mockExamFindMany: vi.fn(),
  mockExamUpdateMany: vi.fn(),
  mockSubmissionUpdateMany: vi.fn(),
  mockExamBatchFindMany: vi.fn(),
  mockExamBatchUpdate: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    exam = { findMany: mockExamFindMany, updateMany: mockExamUpdateMany };
    examBatch = { findMany: mockExamBatchFindMany, update: mockExamBatchUpdate };
    studentSubmission = { updateMany: mockSubmissionUpdateMany };
  },
}));

import { batchScheduler } from '../batch-scheduler';

describe('BatchScheduler', () => {
  beforeEach(() => {
    mockExamFindMany.mockReset();
    mockExamUpdateMany.mockReset();
    mockSubmissionUpdateMany.mockReset();
    mockExamBatchFindMany.mockReset();
    mockExamBatchUpdate.mockReset();
    // 默认返回值：无操作
    mockExamFindMany.mockResolvedValue([]);
    mockExamUpdateMany.mockResolvedValue({ count: 0 });
    mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });
    mockExamBatchFindMany.mockResolvedValue([]);
    mockExamBatchUpdate.mockResolvedValue({});
  });

  describe('autoStartExams', () => {
    it('同时覆盖 scheduled 和 published 状态（修复核心）', async () => {
      await (batchScheduler as any).autoStartExams();

      expect(mockExamUpdateMany).toHaveBeenCalledTimes(1);
      const args = mockExamUpdateMany.mock.calls[0][0];
      expect(args.where.status).toEqual({ in: ['scheduled', 'published'] });
      expect(args.where.startTime).toEqual({ lte: expect.any(Date) });
      expect(args.data.status).toBe('in_progress');
    });

    it('回归断言：不能再退化为仅 scheduled', async () => {
      await (batchScheduler as any).autoStartExams();
      const status = mockExamUpdateMany.mock.calls[0][0].where.status;
      // 不允许是字符串 'scheduled'，必须是包含 published 的 in 数组
      expect(status).not.toBe('scheduled');
      expect(status).toMatchObject({ in: expect.arrayContaining(['scheduled', 'published']) });
    });
  });

  describe('autoEndExams', () => {
    it('同时覆盖 in_progress 和 published 状态（修复核心）', async () => {
      // 模拟有过期考试需要结束
      mockExamFindMany.mockResolvedValue([
        { id: 'exam-1', endTime: new Date('2026-07-08T12:51:15Z') },
      ]);

      await (batchScheduler as any).autoEndExams();

      // findMany 查询条件包含 in_progress 和 published
      const findArgs = mockExamFindMany.mock.calls[0][0];
      expect(findArgs.where.status).toEqual({ in: ['in_progress', 'published'] });
      expect(findArgs.where.endTime).toEqual({ lte: expect.any(Date) });

      // updateMany 更新状态为 ended
      expect(mockExamUpdateMany).toHaveBeenCalledTimes(1);
      const updateArgs = mockExamUpdateMany.mock.calls[0][0];
      expect(updateArgs.data.status).toBe('ended');
      // 不再覆盖 endTime（保留原始结束时间）
      expect(updateArgs.data.endTime).toBeUndefined();
    });

    it('回归断言：不能再退化为仅 in_progress', async () => {
      mockExamFindMany.mockResolvedValue([{ id: 'exam-1', endTime: new Date() }]);
      await (batchScheduler as any).autoEndExams();
      const status = mockExamFindMany.mock.calls[0][0].where.status;
      expect(status).not.toBe('in_progress');
      expect(status).toMatchObject({ in: expect.arrayContaining(['in_progress', 'published']) });
    });

    it('同步收尾 in_progress 的学生提交（修复"永远显示考试中"的核心）', async () => {
      mockExamFindMany.mockResolvedValue([
        { id: 'exam-1', endTime: new Date('2026-07-08T12:51:15Z') },
        { id: 'exam-2', endTime: new Date('2026-07-08T13:00:00Z') },
      ]);

      await (batchScheduler as any).autoEndExams();

      // 每场考试一次 submission 收尾
      expect(mockSubmissionUpdateMany).toHaveBeenCalledTimes(2);
      const subArgs = mockSubmissionUpdateMany.mock.calls[0][0];
      expect(subArgs.where.examId).toBe('exam-1');
      expect(subArgs.where.status).toBe('in_progress');
      expect(subArgs.data.status).toBe('submitted');
      // submittedAt 使用 exam.endTime（而不是当前时间）
      expect(subArgs.data.submittedAt).toEqual(new Date('2026-07-08T12:51:15Z'));
    });

    it('无过期考试时不调用 updateMany 和 submission 收尾', async () => {
      mockExamFindMany.mockResolvedValue([]);
      await (batchScheduler as any).autoEndExams();
      expect(mockExamUpdateMany).not.toHaveBeenCalled();
      expect(mockSubmissionUpdateMany).not.toHaveBeenCalled();
    });
  });

  describe('autoCompleteBatches', () => {
    it('无活跃批次时不执行任何更新', async () => {
      mockExamBatchFindMany.mockResolvedValue([]);
      await (batchScheduler as any).autoCompleteBatches();

      expect(mockExamUpdateMany).not.toHaveBeenCalled();
      expect(mockExamBatchUpdate).not.toHaveBeenCalled();
      expect(mockSubmissionUpdateMany).not.toHaveBeenCalled();
    });

    it('级联结束 in_progress 和 published 子考试（修复核心）', async () => {
      mockExamBatchFindMany.mockResolvedValue([
        { id: 'batch-1' },
        { id: 'batch-2' },
      ]);
      // 每个批次下都有需要结束的考试
      mockExamFindMany.mockResolvedValue([{ id: 'exam-1', endTime: new Date() }]);

      await (batchScheduler as any).autoCompleteBatches();

      // 每个批次一次 exam.findMany + 一次 exam.updateMany + 一次 submission 收尾 + 一次批次更新
      expect(mockExamFindMany).toHaveBeenCalledTimes(2);
      expect(mockExamUpdateMany).toHaveBeenCalledTimes(2);
      expect(mockExamBatchUpdate).toHaveBeenCalledTimes(2);

      // 验证级联条件包含 published
      const firstFindArgs = mockExamFindMany.mock.calls[0][0];
      expect(firstFindArgs.where.batchId).toBe('batch-1');
      expect(firstFindArgs.where.status).toEqual({ in: ['in_progress', 'published'] });

      const firstUpdateArgs = mockExamUpdateMany.mock.calls[0][0];
      expect(firstUpdateArgs.data.status).toBe('ended');
      // 不再覆盖 endTime
      expect(firstUpdateArgs.data.endTime).toBeUndefined();

      // 验证批次被标记为 completed
      expect(mockExamBatchUpdate.mock.calls[0][0]).toMatchObject({
        where: { id: 'batch-1' },
        data: { status: 'completed' },
      });
    });

    it('回归断言：级联条件不能再仅是 in_progress', async () => {
      mockExamBatchFindMany.mockResolvedValue([{ id: 'batch-1' }]);
      mockExamFindMany.mockResolvedValue([{ id: 'exam-1', endTime: new Date() }]);
      await (batchScheduler as any).autoCompleteBatches();
      const status = mockExamFindMany.mock.calls[0][0].where.status;
      expect(status).not.toBe('in_progress');
      expect(status).toMatchObject({ in: expect.arrayContaining(['in_progress', 'published']) });
    });

    it('批次下无进行中考试时仍标记批次为 completed', async () => {
      mockExamBatchFindMany.mockResolvedValue([{ id: 'batch-1' }]);
      mockExamFindMany.mockResolvedValue([]);  // 批次下没有需要结束的考试

      await (batchScheduler as any).autoCompleteBatches();

      expect(mockExamUpdateMany).not.toHaveBeenCalled();
      expect(mockSubmissionUpdateMany).not.toHaveBeenCalled();
      // 批次仍然被标记为 completed
      expect(mockExamBatchUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('runOnce 集成', () => {
    it('三个调度任务都被调用', async () => {
      await (batchScheduler as any).runOnce();

      // autoStartExams: exam.updateMany 1 次（直接 updateMany，不先 findMany）
      // autoEndExams: exam.findMany 1 次（返回空，提前 return，不调 updateMany）
      // autoCompleteBatches: examBatch.findMany 1 次（返回空，不调 updateMany）
      expect(mockExamUpdateMany).toHaveBeenCalledTimes(1);   // 只有 autoStartExams
      expect(mockExamFindMany).toHaveBeenCalledTimes(1);      // autoEndExams 的 findMany
      expect(mockExamBatchFindMany).toHaveBeenCalledTimes(1); // autoCompleteBatches 的 findMany
    });

    it('单次任务异常不会中断其他任务', async () => {
      mockExamUpdateMany.mockRejectedValueOnce(new Error('db down'));
      // 不应抛出
      await expect((batchScheduler as any).runOnce()).resolves.not.toThrow();
    });
  });
});
