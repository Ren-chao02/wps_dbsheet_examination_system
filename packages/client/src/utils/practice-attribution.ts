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
