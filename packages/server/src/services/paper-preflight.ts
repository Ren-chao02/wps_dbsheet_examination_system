/**
 * 发布前预检：在发布那一刻逐题位回答"这个题位至少有一道可用题吗？"。
 *
 * 与生成共用 `listSlotCandidates`，所以候选池与三档放宽的口径一致；但**预检不模拟跨题位占用**
 * （固定题位已绑定的题、先序抽题已占用的题，不会从后续题位的池子里扣除），
 * 因此"预检通过"是**存在性上界**，不等于每份卷子必然填满——真实缺口以生成结果
 * `unfilledSlots` 为准（会汇总进 `ExamPaperGeneration.summary`，发布后可见）。
 * 后续若要让发布即精确，需按生成同序模拟分配并累加 usedQuestionIds（P1c 可选）。
 *
 * 空题位 / 不存在的考试返回 ok:true：调用方（发布路由）已有"考试必须有题目"的前置校验。
 */
import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';
import { listSlotCandidates, loadQuestionPoolWhereForExamPaper, type SlotRule } from './paper-generator';

export interface PreflightIssue {
  slotIndex: number;
  reason: string;
  candidates: number;
  signatureConflict: boolean;
}

export async function preflightExamPaper(
  examId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ ok: boolean; issues: PreflightIssue[] }> {
  const slots = await tx.examQuestion.findMany({
    where: { examId },
    orderBy: [{ slotIndex: 'asc' }, { sortOrder: 'asc' }],
  });

  const poolWhere = slots.some(s => s.slotType === 'rule')
    ? await loadQuestionPoolWhereForExamPaper(examId, tx)
    : undefined;

  const issues: PreflightIssue[] = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    // 回退口径刻意与生成侧一致（见 paper-generator.ts）：slotIndex 为空/0 时用循环下标，
    // 否则预检与生成对"第几个题位"的称呼会不一致，教师按 slotIndex 对不上。
    const slotIndex = slot.slotIndex || i;

    if (slot.slotType !== 'rule') {
      // 固定题位没有题目 = 开考时必然少一道题，属硬失败
      if (!slot.questionId) {
        issues.push({ slotIndex, reason: '固定题位未绑定题目', candidates: 0, signatureConflict: false });
      }
      continue;
    }

    const rule = (slot.rule || {}) as SlotRule;
    const slotScore = slot.scoreOverride ?? 0;

    const strict = await listSlotCandidates({ rule, slotScore, level: 'strict', poolWhere, tx });
    if (strict.length > 0) continue;

    // 区分成因，给教师可执行的提示：
    //   relax-schemaRefs 有候选 → 是结构签名没对齐（题位声明的表/字段与题库不一致）
    //   relax-difficulty 有候选 → 是难度条件太窄
    //   都空                   → 候选池本身为空（题型/能力点/分值/池范围）
    const relaxed = await listSlotCandidates({ rule, slotScore, level: 'relax-schemaRefs', poolWhere, tx });
    const signatureConflict = relaxed.length > 0;
    // 签名冲突时 byScore 的结果不会被用到（它只负责区分"难度不足"与"池为空"），
    // 少发一次注定被丢弃的查询。
    const byScore = signatureConflict
      ? []
      : await listSlotCandidates({ rule, slotScore, level: 'relax-difficulty', poolWhere, tx });
    issues.push({
      slotIndex,
      candidates: 0,
      signatureConflict,
      reason: signatureConflict
        ? '候选题的引用结构与题位声明不一致（请统一「引用结构」或换题）'
        : byScore.length > 0
          ? '候选题难度不足（该难度下没有可用题）'
          // 分值在每一档都恒定过滤（paper-generator.ts 的 pool 内判断），不属于"难度不足"的成因；
          // 「池为空」还要覆盖两类常被忽略的原因：题目未上架、规则含引擎不支持的 action
          : '候选池为空（检查题目是否已上架 / 题型与能力点 / 规则是否可自动判分 / 题库可见范围）',
    });
  }

  return { ok: issues.length === 0, issues };
}
