/**
 * 前置契约推导器：从题目的判分规则（answerRules）反推「这题需要什么 / 会产出什么」。
 *
 * 为什么能推：规则处理器的语义是稳定的 —— check_field_* 的考点是"字段配对了"（creates 字段），
 * 它引用的表必须已存在（requires）；check_view_* 同理。
 * 唯一有歧义的是 check_table_exists：它既可能是"把这张表建出来"（真建表），
 * 也可能是"表得在，我才配得上字段"（前置检查）—— 所以要用题面语义来判（见 hasCreationIntent）。
 * 推导结果只用于提示 / 归链 / 组卷签名，**判分一行都不看它**；推错最多多显示一条提示。
 */
import type { AnswerRule } from './rule-engine';

// 用 type 而非 interface：TS 只对匿名对象类型推导隐式索引签名，interface 不满足
// dedupeRefs 的 Record<string, string> 约束（会报 "Index signature ... is missing"）。
export type FieldRef = { table: string; field: string };
export type ViewRef = { table: string; view: string };

export interface RefGroup {
  tables: string[];
  fields: FieldRef[];
  views: ViewRef[];
}

export interface SchemaRefs {
  requires: RefGroup;
  creates: RefGroup;
  /** 组卷等值签名用：requires.tables ∪ creates.tables（去重、排序） */
  tables: string[];
  /** 兼容旧字段：涉及的字段名（去重、排序） */
  fields: string[];
}

export interface DeriveResult {
  refs: SchemaRefs;
  /** 推不出来的 action（引擎未实现 / 缺关键参数）——这类题大概率也判不了分，交人工 */
  unresolved: string[];
}

/** 考点 = "这张表建出来/建对了" → 但**要过题面语义门槛**（见 hasCreationIntent） */
const CREATES_TABLE = new Set([
  'check_table_exists', 'check_table_name', 'check_table_count', 'check_table_fields',
]);

/** 题面上下文：判断"这题是在建这张表吗"要用 */
export interface QuestionContext {
  title?: string | null;
  description?: string | null;
}

/** 题面里的创建语义 */
const CREATION_VERBS = /创建|新建|搭建|构建|导入/;

/**
 * 这道题是在"建"这张表，还是只是"用了"这张表？
 *
 * 实证：题库里 15 道题带 check_table_exists，其中只有一两道是真建表，其余都是前置检查——
 * 一律当 creates 会把「设置关联字段允许多条记录关联」（检查 任务表+员工信息表 存在）
 * 判成"创建了这两张表"，把两条本不相干的链焊成一条 25 题大链。
 * 判定：题面（标题+描述）点名了这张表，且带创建语义 ⇒ 建；否则 ⇒ 只是前提。
 * 没有题面时保守判"不创建"（宁可该表暂时没有创建者，也不要错误合并链）。
 */
function hasCreationIntent(table: string, question?: QuestionContext | null): boolean {
  const text = `${question?.title ?? ''}\n${question?.description ?? ''}`;
  if (!text.trim()) return false;
  if (!text.includes(table)) return false;
  return CREATION_VERBS.test(text);
}

/** 考点 = "字段配对了" → creates 字段；所在表属 requires */
const FIELD_ACTIONS = new Set([
  'check_field', 'check_field_count', 'check_field_default', 'check_field_format', 'check_field_formula',
  'check_field_link_multiple', 'check_field_options', 'check_field_required', 'check_field_unique',
]);
/** 考点 = "关联指向对了" → 额外 requires 目标表 */
const LINK_ACTIONS = new Set(['check_field_link_target', 'check_linked_record']);
/** 考点 = "视图在不在" → creates 视图 */
const CREATES_VIEW = new Set(['check_view_exists']);
/** 考点 = "视图配对了" → requires 视图（视图是前序题的产物） */
const VIEW_CONFIG_ACTIONS = new Set([
  'check_view_filter', 'check_view_sort', 'check_view_group', 'check_view_field_hidden', 'check_view_type',
]);
/** 考点 = "记录做对了" → requires 表（且表里要有记录） */
const RECORD_ACTIONS = new Set([
  'check_record_exists', 'check_record_value', 'check_record_count', 'check_record_value_exact',
]);
/** 表单类 → requires 表 + creates 表单 */
const FORM_ACTIONS = new Set([
  'check_form_exists', 'check_form_fields', 'check_form_field_required', 'check_form_settings',
]);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();
const refKey = (r: { table: string } & Record<string, string>) => `${r.table}\u0000${Object.values(r).join('\u0000')}`;
// 排序用码点比较（与 uniqSorted 一致），**不用 localeCompare**：这些 refs 会落库成
// schemaRefs JSON，locale 一变排序就变，同一份规则在不同机器上写出不同的库内容
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dedupeRefs = <T extends { table: string } & Record<string, string>>(xs: T[]): T[] =>
  [...new Map(xs.map(x => [refKey(x), x])).values()].sort((a, b) => cmp(refKey(a), refKey(b)));

export function derivePrerequisites(
  rules: AnswerRule[],
  // 题面（标题+描述）：判 check_table_exists 是"真建表"还是"前置检查"的唯一依据。
  // 两个真实调用方（回填构建器、出题页推导按钮）都必须传；省略时保守判"不创建"。
  question?: QuestionContext | null,
): DeriveResult {
  const requires: RefGroup = { tables: [], fields: [], views: [] };
  const creates: RefGroup = { tables: [], fields: [], views: [] };
  const unresolved: string[] = [];

  for (const rule of rules ?? []) {
    const action = str(rule?.action);
    const params = (rule?.params ?? {}) as Record<string, unknown>;
    const table = str(params.tableName);
    const field = str(params.fieldName);
    const view = str(params.viewName);

    if (CREATES_TABLE.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      // check_table_exists 有两种含义：真建表（"创建一个数据表，命名为 X"）与前置检查
      // （"表得在，我才配得上关联字段"）。只有题面带创建语义且点名了这张表，才算本题产物。
      // 误判代价不对称：错判成 creates 会把两条链焊死（实测出现过 25 题大链），
      // 错判成 requires 只是该表暂时没有创建者、题目自成链根——后者人工一改就好。
      if (hasCreationIntent(table, question)) creates.tables.push(table);
      else requires.tables.push(table);
    } else if (FIELD_ACTIONS.has(action)) {
      if (!table || !field) { unresolved.push(action); continue; }
      requires.tables.push(table);
      creates.fields.push({ table, field });
    } else if (LINK_ACTIONS.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      requires.tables.push(table);
      // 规则表的 `check_field*`（含 link_*）一行要求 creates 该字段：
      // check_field_link_target(T,F,target) 的考点就是这个字段配对了。
      // check_linked_record 没有 fieldName（它校验"表里有指向 target 的关联字段"），
      // 所以只在 fieldName 存在时才记 creates，不因此把它打成 unresolved。
      if (field) creates.fields.push({ table, field });
      // targetTable 是引擎处理器的参数名；linkTarget 只是同义兜底（生产库暂无使用），
      // 保留它是因为出题辅助链路可能生成不同拼写
      const target = str(params.targetTable) || str(params.linkTarget);
      if (target) requires.tables.push(target); else unresolved.push(action);
    } else if (CREATES_VIEW.has(action)) {
      if (!table || !view) { unresolved.push(action); continue; }
      requires.tables.push(table);
      creates.views.push({ table, view });
    } else if (VIEW_CONFIG_ACTIONS.has(action)) {
      if (!table || !view) { unresolved.push(action); continue; }
      requires.tables.push(table);
      requires.views.push({ table, view });
    } else if (RECORD_ACTIONS.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      requires.tables.push(table);
    } else if (FORM_ACTIONS.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      requires.tables.push(table);
      const form = str(params.formName);
      if (form) creates.views.push({ table, view: form });
    } else {
      // 引擎未实现的 action（verify_* 系列）或空 action：不猜，交人工
      unresolved.push(action || '(空 action)');
    }
  }

  // 本题自己创建的表/字段/视图，不该再算"需要"——先建表再建字段是同一道题的常态
  const createdTables = new Set(creates.tables);
  const createdFields = new Set(creates.fields.map(f => refKey(f)));
  const createdViews = new Set(creates.views.map(v => refKey(v)));

  return {
    refs: {
      requires: {
        tables: uniqSorted(requires.tables.filter(t => !createdTables.has(t))),
        fields: dedupeRefs(requires.fields.filter(f => !createdFields.has(refKey(f)))),
        views: dedupeRefs(requires.views.filter(v => !createdViews.has(refKey(v)))),
      },
      creates: {
        tables: uniqSorted(creates.tables),
        fields: dedupeRefs(creates.fields),
        views: dedupeRefs(creates.views),
      },
      tables: uniqSorted([...requires.tables, ...creates.tables]),
      fields: uniqSorted([...requires.fields, ...creates.fields].map(f => f.field)),
    },
    unresolved: uniqSorted(unresolved),
  };
}
