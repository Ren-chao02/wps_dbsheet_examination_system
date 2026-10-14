/**
 * 判分规则的 errorMessage → 学生能懂的话。
 * 「未找到表「员工信息表」」对系统是准确的，对学生是黑话——他需要的是"去建这张表"。
 */

/**
 * 缺表类措辞两种形态（与 engine/rule-engine.ts 的 errorMessage 保持一致）：
 *   - check_table_exists：「未找到表「X」」
 *   - 其余处理器查不到宿主表：「表「X」不存在（，无法验证字段/视图）」
 * Task 15 的归因复用同一个正则；引擎改文案时这里必须同步。
 */
export const MISSING_TABLE_RE = /未找到表「(.+?)」|表「(.+?)」不存在/;

/** 提取缺失的表名；不是缺表类的 message 返回 null */
export function extractMissingTable(errorMessage?: string | null): string | null {
  const m = MISSING_TABLE_RE.exec(errorMessage ?? '');
  return m?.[1] ?? m?.[2] ?? null;
}

export function friendlyRuleMessage(errorMessage?: string | null): string | undefined {
  const table = extractMissingTable(errorMessage);
  if (table) return `你的表格里没有「${table}」这张表 —— 本题要求在这张表上操作，请先把它建出来`;
  return errorMessage || undefined;
}
