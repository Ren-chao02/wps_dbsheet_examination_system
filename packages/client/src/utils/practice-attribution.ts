/**
 * 链式练习的判分归因（纯函数）。
 *
 * 链里"上一步没做出来"会让后面几步集体失败 —— 学生看到 6 条红叉，但真正的原因只有一个。
 * 这里只做能站得住脚的归因：多题因**同一张表缺失**失败 → 折叠成一条；
 * 不猜"哪一步本该建它"（那需要链元数据，MVP 不引入）。
 * 缺表识别复用 rule-message.ts 的 extractMissingTable —— 正则只有那一处。
 */
import { extractMissingTable } from './rule-message';

export interface GradingDetailLike {
  questionTitle: string;
  isCorrect?: boolean;
  ruleResults?: Array<{ passed?: boolean; needsReview?: boolean; errorMessage?: string }>;
}

export interface ChainFailure {
  missingTable: string;
  /** 1-based 步骤号（与结果页的题号一致） */
  failedSteps: number[];
}

export function buildChainAttribution(details?: GradingDetailLike[] | null): ChainFailure[] {
  // details 允许为 null/undefined：判分快照在「已提交、结果未写回」的窗口里就是 null，
  // 归因只在有明细时才产出，调用方不必先做空值判断
  const byTable = new Map<string, number[]>();
  (details ?? []).forEach((d, idx) => {
    for (const r of d.ruleResults ?? []) {
      const table = extractMissingTable(r.errorMessage);
      if (!table) continue;
      if (!byTable.has(table)) byTable.set(table, []);
      const steps = byTable.get(table)!;
      if (!steps.includes(idx + 1)) steps.push(idx + 1);
    }
  });
  return [...byTable.entries()]
    .filter(([, steps]) => steps.length >= 2)
    .map(([missingTable, failedSteps]) => ({ missingTable, failedSteps: failedSteps.sort((a, b) => a - b) }))
    .sort((a, b) => a.failedSteps[0] - b.failedSteps[0]);
}

/** 该题是否有「待人工复核」的规则（现在与"做错"长得一样，要分开显示） */
export function hasNeedsReview(ruleResults?: Array<{ needsReview?: boolean }>): boolean {
  return (ruleResults ?? []).some(r => r.needsReview);
}

/** 题级结论三态（与规则级「needsReview 优先于 passed」同一口径） */
export type QuestionVerdict = 'correct' | 'needs_review' | 'incorrect';

/**
 * 题级结论：哪些"失败"不该算学生做错。
 *
 * 判分服务对 needsReview 规则记 passed=false（拿不到数据、引擎拒绝硬判），
 * 只按 isCorrect 下结论会把系统原因标成「错误」，与下方规则明细（标「待人工复核」）
 * 自相矛盾，学生以为自己哪里做错了。所以题级按「失败规则的性质」定调：
 * - 'needs_review'：失败规则里只要有一条 needsReview —— 系统给不出结论，不能算做错
 *   （混合情形也按此走：题里可能确有做错的规则，规则明细会逐条标出，
 *    而"这题的结论待定"是更不误导学生的题级口径）；
 * - 'incorrect'：确实有 passed=false 且 needsReview=false 的规则（真的做错了）；
 * - 'correct'：没有失败规则。
 */
export function questionVerdict(detail: GradingDetailLike): QuestionVerdict {
  const failedRules = (detail.ruleResults ?? []).filter(r => !r.passed);
  if (failedRules.some(r => r.needsReview)) return 'needs_review';
  if (failedRules.length > 0) return 'incorrect';
  // 没有失败规则（含无规则的兜底题：判分服务给 isCorrect=false、score=0）时以 isCorrect 为准
  return detail.isCorrect === false ? 'incorrect' : 'correct';
}
