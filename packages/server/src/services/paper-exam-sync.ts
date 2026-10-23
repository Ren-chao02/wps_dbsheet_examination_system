/**
 * 把试卷快照同步到考试：题位、总分、难度目标。
 *
 * 创建绑卷与换卷原本各写了一遍这段逻辑，两处都漏了难度目标——拷贝语义必须只有一处，
 * 否则以后每加一个"随试卷走"的字段都会漏一处。
 */
import { prisma } from '../config/prisma';
import { Prisma } from '@prisma/client';

export async function syncPaperIntoExam(params: {
  examId: string;
  paperId: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<{ totalScore: number }> {
  const { examId, paperId, tx = prisma } = params;

  await tx.examQuestion.deleteMany({ where: { examId } });

  if (!paperId) {
    // 解绑语义沿用旧行为：没有试卷时考试回到默认 100 分；难度目标随之清空，
    // 否则旧的配比会残留下来，页面显示"没有试卷却配了难度目标"。
    await tx.exam.update({
      where: { id: examId },
      data: { totalScore: 100, difficultyTarget: Prisma.JsonNull },
    });
    return { totalScore: 100 };
  }

  const paper = await tx.paper.findUnique({ where: { id: paperId }, select: { difficultyTarget: true } });
  const paperQuestions = await tx.paperQuestion.findMany({
    where: { paperId },
    include: { question: true },
    orderBy: { sortOrder: 'asc' },
  });

  if (paperQuestions.length > 0) {
    // 连题位信息一起拷过去：rule 题位（按知识点抽题）没有固定题目，
    // 只拷 questionId 会把抽题规则丢掉，考试就退化成"缺失大半题目"
    await tx.examQuestion.createMany({
      data: paperQuestions.map((pq, index) => ({
        examId,
        questionId: pq.questionId,
        sortOrder: pq.sortOrder,
        scoreOverride: pq.score ?? null,
        slotType: pq.slotType ?? 'fixed',
        rule: (pq.rule ?? undefined) as any,
        slotIndex: index,
      })),
    });
  }

  // 抽题题位的分值取题位分（没有固定题目可回退）；固定题位仍可用题目分兜底
  const totalScore = paperQuestions.reduce((sum, pq) => sum + (pq.score ?? pq.question?.score ?? 0), 0);
  await tx.exam.update({
    where: { id: examId },
    data: { totalScore, difficultyTarget: (paper?.difficultyTarget ?? Prisma.JsonNull) as any },
  });
  return { totalScore };
}
