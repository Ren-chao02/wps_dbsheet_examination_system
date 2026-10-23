/**
 * 发布前预检：在考试发布那一刻回答一个问题——"按现在的题位配置，能不能给每个考生
 * 生成一份完整卷子？"。
 *
 * 与生成共用 `listSlotCandidates`，所以"预检通过"与"生成抽得出"是同一口径；
 * 硬约束不满足时阻断发布，把缺口逐题位告诉教师，而不是等到开考才暴露。
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
    const byScore = await listSlotCandidates({ rule, slotScore, level: 'relax-difficulty', poolWhere, tx });
    const signatureConflict = relaxed.length > 0;
    issues.push({
      slotIndex,
      candidates: 0,
      signatureConflict,
      reason: signatureConflict
        ? '候选题的引用结构与题位声明不一致（请统一「引用结构」或换题）'
        : byScore.length > 0
          ? '候选题难度不足（该难度下没有分值一致的题）'
          : '候选池为空（检查题型/能力点/分值/题库可见范围）',
    });
  }

  return { ok: issues.length === 0, issues };
}
