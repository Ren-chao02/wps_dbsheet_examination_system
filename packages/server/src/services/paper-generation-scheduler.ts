import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { enqueuePaperGeneration } from '../jobs/paper-generation-queue';

export interface SchedulePaperGenerationParams {
  examId: string;
  totalStudents: number;
  /** reset = 新一轮生成（清空 summary/时间戳）；fill = 只补缺（保留上一轮结果） */
  mode: 'reset' | 'fill';
}

/**
 * 组卷预生成的唯一调度入口：重置/补缺状态行 → 入队 → 队列不可用时标 failed。
 *
 * publish、重新组卷后的 lifecycle、批次激活三处过去各写一遍这段逻辑，
 * 已经出现过「某处忘了清 summary」「某处忘了带 pending 守卫」的漂移；
 * 统一在这里后，新增入口只允许调用本函数。
 */
export async function schedulePaperGeneration(
  params: SchedulePaperGenerationParams,
): Promise<'pending' | 'failed'> {
  const { examId, totalStudents, mode } = params;

  if (mode === 'reset') {
    // 重复发布/重新组卷必须把上一轮的运行痕迹清掉（startedAt/finishedAt/error/summary），
    // 否则前端会把旧进度/旧失败原因当成本轮状态展示。可空 Json 字段必须用
    // Prisma.JsonNull 显式表达清空（undefined 才是 no-op，裸 null 不可赋值）。
    await prisma.examPaperGeneration.upsert({
      where: { examId },
      create: { examId, status: 'pending', totalStudents },
      update: {
        status: 'pending', totalStudents,
        queuedAt: new Date(), startedAt: null, finishedAt: null, error: null,
        summary: Prisma.JsonNull, unfilledSlots: Prisma.JsonNull,
      },
    });
  } else {
    // 补缺：保留上一轮的 summary/时间戳（它们描述的是已生成部分），只清失败原因
    await prisma.examPaperGeneration.upsert({
      where: { examId },
      create: { examId, status: 'pending', totalStudents },
      update: { status: 'pending', error: null, queuedAt: new Date() },
    });
  }

  const enq = await enqueuePaperGeneration(examId);
  if (!enq.queued) {
    // 只覆盖仍是 pending 的行：若迟到 job 已经跑完写成 done，不能倒回 failed
    await prisma.examPaperGeneration.updateMany({
      where: { examId, status: 'pending' },
      data: { status: 'failed', error: '组卷队列不可用（Redis 未启动）；开考时将现场生成' },
    });
    return 'failed';
  }
  return 'pending';
}
