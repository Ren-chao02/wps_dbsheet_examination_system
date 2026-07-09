import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

class BatchScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number = 60_000): void {
    if (this.timer) return;
    console.log(`[BatchScheduler] started, interval=${intervalMs / 1000}s`);
    this.runOnce(); // 启动时立即执行一次
    this.timer = setInterval(() => this.runOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[BatchScheduler] stopped');
    }
  }

  private async runOnce(): Promise<void> {
    try {
      await Promise.all([
        this.autoStartExams(),
        this.autoEndExams(),
        this.autoCompleteBatches(),
      ]);
    } catch (err: any) {
      console.error('[BatchScheduler] error:', err.message);
    }
  }

  /**
   * 已排期或已发布的考试到达 startTime → 自动开始
   *
   * 覆盖两类场景：
   *  - scheduled：常规排期，startTime 到点自动开始
   *  - published：发布时 startTime 已过（如发布晚于计划开始时间，或批次激活级联发布），
   *    下一轮调度即兜底转为 in_progress，避免永远卡在 published
   *
   * 边界：startTime 为 null（随到随考模式）不满足 lte，自动被排除 —— 此类考试
   * 由学生进入触发开始，由 autoCompleteBatches 在批次到期时兜底结束。
   */
  private async autoStartExams(): Promise<void> {
    const result = await prisma.exam.updateMany({
      where: {
        status: { in: ['scheduled', 'published'] },
        startTime: { lte: new Date() },
      },
      data: { status: 'in_progress' },
    });
    if (result.count > 0) {
      console.log(`[BatchScheduler] auto-started ${result.count} exams`);
    }
  }

  /**
   * 进行中或已发布的考试到达 endTime → 自动结束
   *
   * 覆盖两类场景：
   *  - in_progress：常规结束，endTime 到点自动收卷
   *  - published：已发布但从未开始且已过期（如集中模式考试发布后无人触发 /start，
   *    endTime 已过），直接转为 ended，避免永远停留在"已发布（待考）"
   *
   * 边界：endTime 为 null（随到随考模式）不满足 lte，自动被排除。
   */
  private async autoEndExams(): Promise<void> {
    const result = await prisma.exam.updateMany({
      where: {
        status: { in: ['in_progress', 'published'] },
        endTime: { lte: new Date() },
      },
      data: { status: 'ended', endTime: new Date() },
    });
    if (result.count > 0) {
      console.log(`[BatchScheduler] auto-ended ${result.count} exams`);
    }
  }

  /** 进行中的批次到达 endTime → 自动完成（含级联结束子考试） */
  private async autoCompleteBatches(): Promise<void> {
    const batches = await prisma.examBatch.findMany({
      where: {
        status: 'active',
        endTime: { lte: new Date() },
      },
      select: { id: true },
    });

    if (batches.length === 0) return;

    for (const batch of batches) {
      // 级联结束该批次下仍在进行或已发布（未参考）的考试
      // published 状态的考试在批次到期时也必须结束，避免永远停留在"已发布（待考）"
      await prisma.exam.updateMany({
        where: { batchId: batch.id, status: { in: ['in_progress', 'published'] } },
        data: { status: 'ended', endTime: new Date() },
      });
      await prisma.examBatch.update({
        where: { id: batch.id },
        data: { status: 'completed' },
      });
    }
    console.log(`[BatchScheduler] auto-completed ${batches.length} batches`);
  }
}

export const batchScheduler = new BatchScheduler();
