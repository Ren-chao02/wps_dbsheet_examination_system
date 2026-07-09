import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * BatchScheduler 单元测试
 *
 * 重点验证：published 状态已被纳入自动流转，避免"考试已结束但仍显示
 * 已发布（待考）"的回归。详见 packages/server/src/services/batch-scheduler.ts。
 */

// 用 vi.hoisted 提升 mock 引用，确保 vi.mock factory 内可访问
const { mockExamUpdateMany, mockExamBatchFindMany, mockExamBatchUpdate } = vi.hoisted(() => ({
  mockExamUpdateMany: vi.fn(),
  mockExamBatchFindMany: vi.fn(),
  mockExamBatchUpdate: vi.fn(),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class MockPrismaClient {
    exam = { updateMany: mockExamUpdateMany };
    examBatch = { findMany: mockExamBatchFindMany, update: mockExamBatchUpdate };
  },
}));

import { batchScheduler } from '../batch-scheduler';

describe('BatchScheduler', () => {
  beforeEach(() => {
    mockExamUpdateMany.mockReset();
    mockExamBatchFindMany.mockReset();
    mockExamBatchUpdate.mockReset();
    // 默认返回值：无操作
    mockExamUpdateMany.mockResolvedValue({ count: 0 });
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
      await (batchScheduler as any).autoEndExams();

      expect(mockExamUpdateMany).toHaveBeenCalledTimes(1);
      const args = mockExamUpdateMany.mock.calls[0][0];
      expect(args.where.status).toEqual({ in: ['in_progress', 'published'] });
      expect(args.where.endTime).toEqual({ lte: expect.any(Date) });
      expect(args.data.status).toBe('ended');
      expect(args.data.endTime).toEqual(expect.any(Date));
    });

    it('回归断言：不能再退化为仅 in_progress', async () => {
      await (batchScheduler as any).autoEndExams();
      const status = mockExamUpdateMany.mock.calls[0][0].where.status;
      expect(status).not.toBe('in_progress');
      expect(status).toMatchObject({ in: expect.arrayContaining(['in_progress', 'published']) });
    });
  });

  describe('autoCompleteBatches', () => {
    it('无活跃批次时不执行任何更新', async () => {
      mockExamBatchFindMany.mockResolvedValue([]);
      await (batchScheduler as any).autoCompleteBatches();

      expect(mockExamUpdateMany).not.toHaveBeenCalled();
      expect(mockExamBatchUpdate).not.toHaveBeenCalled();
    });

    it('级联结束 in_progress 和 published 子考试（修复核心）', async () => {
      mockExamBatchFindMany.mockResolvedValue([
        { id: 'batch-1' },
        { id: 'batch-2' },
      ]);

      await (batchScheduler as any).autoCompleteBatches();

      // 每个批次一次级联 updateMany + 一次批次状态更新
      expect(mockExamUpdateMany).toHaveBeenCalledTimes(2);
      expect(mockExamBatchUpdate).toHaveBeenCalledTimes(2);

      // 验证级联条件包含 published
      const firstCallArgs = mockExamUpdateMany.mock.calls[0][0];
      expect(firstCallArgs.where.batchId).toBe('batch-1');
      expect(firstCallArgs.where.status).toEqual({ in: ['in_progress', 'published'] });
      expect(firstCallArgs.data.status).toBe('ended');
      expect(firstCallArgs.data.endTime).toEqual(expect.any(Date));

      // 验证批次被标记为 completed
      expect(mockExamBatchUpdate.mock.calls[0][0]).toMatchObject({
        where: { id: 'batch-1' },
        data: { status: 'completed' },
      });
    });

    it('回归断言：级联条件不能再仅是 in_progress', async () => {
      mockExamBatchFindMany.mockResolvedValue([{ id: 'batch-1' }]);
      await (batchScheduler as any).autoCompleteBatches();
      const status = mockExamUpdateMany.mock.calls[0][0].where.status;
      expect(status).not.toBe('in_progress');
      expect(status).toMatchObject({ in: expect.arrayContaining(['in_progress', 'published']) });
    });
  });

  describe('runOnce 集成', () => {
    it('三个调度任务都被调用', async () => {
      await (batchScheduler as any).runOnce();

      // autoStartExams + autoEndExams + autoCompleteBatches（autoCompleteBatches 内部还有 findMany）
      // autoStartExams 和 autoEndExams 各调用 exam.updateMany 一次
      // autoCompleteBatches 调用 examBatch.findMany 一次（返回空，无后续 updateMany）
      expect(mockExamUpdateMany).toHaveBeenCalledTimes(2);
      expect(mockExamBatchFindMany).toHaveBeenCalledTimes(1);
    });

    it('单次任务异常不会中断其他任务', async () => {
      mockExamUpdateMany.mockRejectedValueOnce(new Error('db down'));
      // 不应抛出
      await expect((batchScheduler as any).runOnce()).resolves.not.toThrow();
    });
  });
});
