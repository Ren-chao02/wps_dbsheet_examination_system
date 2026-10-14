/**
 * 前置提示条文案生成器（纯函数）。
 *
 * 为什么单独抽出来：同一段文案要在三个地方出现 —— 学生考试页、教师出题页的预览、
 * 以及将来的移动端；文案散落各处一定会漂移。判分不读它，改文案零风险。
 */

export interface FieldRef { table: string; field: string }
export interface ViewRef { table: string; view: string }

/** 学生端下发的 requires（服务端已剥掉 creates，避免泄露预期产物） */
export interface StudentRequires {
  tables?: string[];
  fields?: FieldRef[];
  views?: ViewRef[];
}

export function buildRequirementHint(requires?: StudentRequires | null): string | null {
  const tables = requires?.tables ?? [];
  const fields = requires?.fields ?? [];
  const views = requires?.views ?? [];
  if (tables.length === 0 && fields.length === 0 && views.length === 0) return null;

  const quoted = tables.map(t => `「${t}」`).join('');
  const multi = tables.length > 1;

  // 字段按表分组展示：同一张表的字段跟上表名
  const fieldGroups = new Map<string, string[]>();
  for (const f of fields) {
    if (!fieldGroups.has(f.table)) fieldGroups.set(f.table, []);
    fieldGroups.get(f.table)!.push(f.field);
  }
  const fieldText = fieldGroups.size > 0
    ? `（${[...fieldGroups.entries()].map(([t, fs]) => (multi ? `${t}含字段：` : '含字段：') + fs.join('、')).join('；')}）`
    : '';

  const viewText = views.length > 0
    ? `；另需要视图${views.map(v => `「${v.view}」`).join('')}`
    : '';

  const createHint = multi
    ? '若你的表格里还没有它们，请先在左侧新建这些表并建好对应字段，再完成题目要求。'
    : '若你的表格里还没有它，请先在左侧新建这张表' + (fieldGroups.size > 0 ? '并建好这些字段' : '') + '，再完成题目要求。';

  return `${tables.length > 0 ? `本题需要${quoted}` : '本题需要以下结构'}${fieldText}${viewText}。${createHint}`;
}
