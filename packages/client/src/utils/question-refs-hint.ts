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
  const fields = requires?.fields ?? [];
  const views = requires?.views ?? [];
  // tables 可能为空而 fields/views 非空：视图的宿主表若恰好由本题自己创建，会被服务端
  // 从 requires.tables 里剔除。这时从 fields/views 反推表名，避免文案出现"以下结构"
  // 这种没有指代对象的说法——这段话是在告诉学生该建什么，不能含糊。
  const tables = requires?.tables?.length
    ? requires.tables
    : [...new Set([...fields.map(f => f.table), ...views.map(v => v.table)])];
  if (tables.length === 0 && fields.length === 0 && views.length === 0) return null;

  const quoted = tables.map(t => `「${t}」`).join('');
  const multi = tables.length > 1;

  // 字段按表分组展示：同一张表的字段跟上表名。
  // 前提不变式：字段的 table 必在 tables 里（服务端推导器每条字段规则都同步推表），
  // 否则这里会把字段挂到一张没被列出的表名下，文案自相矛盾。
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

  return `本题需要${quoted}${fieldText}${viewText}。${createHint}`;
}
