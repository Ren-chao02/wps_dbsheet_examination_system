/**
 * 组卷预生成调度器的唯一入口：reset/fill 两种模式的状态行形状、
 * 入队调用、以及队列不可用时带 pending 守卫的 failed 回写。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { upsert, updateMany, enqueue } = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('../../config/prisma', () => ({ prisma: { examPaperGeneration: { upsert, updateMany } } }));
vi.mock('../../jobs/paper-generation-queue', () => ({ enqueuePaperGeneration: enqueue }));

import { schedulePaperGeneration } from '../paper-generation-scheduler';

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({});
  updateMany.mockResolvedValue({ count: 1 });
  enqueue.mockResolvedValue({ queued: true });
});

describe('schedulePaperGeneration', () => {
  it('reset：清空上一轮 summary/时间戳后入队', async () => {
    await expect(schedulePaperGeneration({ examId: 'e-1', totalStudents: 30, mode: 'reset' }))
      .resolves.toBe('pending');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1' },
      update: expect.objectContaining({ status: 'pending', totalStudents: 30, startedAt: null }),
    }));
    // 清空语义必须钉死：重复发布时旧 summary/失败原因不能被当成本轮状态展示。
    // Prisma.JsonNull 是同一单例，用 toBe 才能区分「显式清空」与「忘了写（undefined = no-op）」。
    const update = upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({
      status: 'pending', totalStudents: 30, startedAt: null, finishedAt: null, error: null,
    });
    expect(update.summary).toBe(Prisma.JsonNull);
    expect(update.unfilledSlots).toBe(Prisma.JsonNull);
    expect(enqueue).toHaveBeenCalledWith('e-1');
  });

  it('fill：保留上一轮结果，仅置 pending/清 error', async () => {
    await schedulePaperGeneration({ examId: 'e-1', totalStudents: 30, mode: 'fill' });
    const update = upsert.mock.calls[0][0].update;
    expect(update).toMatchObject({ status: 'pending', error: null });
    expect(update).not.toHaveProperty('summary');
  });

  it('队列不可用 → 状态行标 failed（带 pending 守卫）', async () => {
    enqueue.mockResolvedValue({ queued: false });
    await expect(schedulePaperGeneration({ examId: 'e-1', totalStudents: 30, mode: 'reset' }))
      .resolves.toBe('failed');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'e-1', status: 'pending' },
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
