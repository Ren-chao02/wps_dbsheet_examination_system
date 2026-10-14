/**
 * 前置契约推导器：从题目的判分规则（answerRules）反推「这题需要什么 / 会产出什么」。
 *
 * 为什么能推：规则处理器的语义是稳定的 —— check_table_exists 的考点就是"把表建出来"（creates），
 * check_field_* 的考点是"字段配对了"（creates 字段），而它引用的表必须已存在（requires）。
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

/** 考点 = "这张表建出来/建对了" → creates */
const CREATES_TABLE = new Set([
  'check_table_exists', 'check_table_name', 'check_table_count', 'check_table_fields',
]);
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
const dedupeRefs = <T extends { table: string } & Record<string, string>>(xs: T[]): T[] =>
  [...new Map(xs.map(x => [refKey(x), x])).values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));

export function derivePrerequisites(rules: AnswerRule[]): DeriveResult {
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
      creates.tables.push(table);
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
