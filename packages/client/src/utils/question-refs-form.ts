/**
 * 出题页「前置契约」卡片的纯函数：标签 ↔ 引用数组的映射、保存前归一化。
 *
 * 为什么单独抽出来：这里的逻辑写错了都是**静默丢数据** —— 归一化没保住 requires/creates，
 * 学生提示条和练习成链就一起失效；标签改动没保住宿主表，跨表字段会被搬到同一张表下。
 * 抽成纯函数才能在测试里把这几条不变式钉住。
 */
import type { SchemaFieldRef, SchemaRefGroup, SchemaRefs, SchemaViewRef } from '../types';

/**
 * 码点比较（与 server 推导器 uniqSorted 同口径）。
 * 不用 localeCompare：它随语言环境变，同一份数据在不同机器上会排出不同顺序，
 * 落库成 schemaRefs JSON 后签名（逐字比对）就会对不上。
 */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** {table, name} → 显示串（只用于只读摘要；编辑用的 tags 只存名字，不带表前缀） */
export function formatRefChip(table: string, name: string): string {
  const t = table.trim();
  const n = name.trim();
  return t ? `${t}.${n}` : n;
}

/** 一组引用的只读摘要（creates 展示用）：表：A、B；字段：A.x；视图：A.v */
export function summarizeRefGroup(g?: SchemaRefGroup | null): string {
  if (!g) return '';
  const parts: string[] = [];
  if (g.tables?.length) parts.push(`表：${g.tables.join('、')}`);
  if (g.fields?.length) parts.push(`字段：${g.fields.map(f => formatRefChip(f.table, f.field)).join('、')}`);
  if (g.views?.length) parts.push(`视图：${g.views.map(v => formatRefChip(v.table, v.view)).join('、')}`);
  return parts.join('；');
}

/**
 * tags 标签变化 → 引用数组。三条不变式：
 * 1. 旧标签按**名字**保住原宿主表：一道题可能跨两张表挂字段/视图，删除或重排其余标签时，
 *    不能把它们统一搬到第一张表下（那会让学生提示条指向错的表）。
 * 2. 新标签挂到 fallbackTable（第一张「需要」表）：教师手输字段名时不会带表名。
 * 3. fallbackTable 为空时**拒绝**新增并在 rejected 里点名：挂到空表名会让提示条渲染出
 *    没有归属的「含字段：x」（文案自相矛盾），宁可不收、由调用方提示先填表名。
 */
export function applyRefChipChange(
  oldRefs: Array<{ table: string; name: string }>,
  nextChips: string[],
  fallbackTable: string,
): { next: Array<{ table: string; name: string }>; rejected: string[] } {
  const byName = new Map<string, { table: string; name: string }>();
  for (const r of oldRefs) if (!byName.has(r.name)) byName.set(r.name, r);

  const next: Array<{ table: string; name: string }> = [];
  const rejected: string[] = [];
  for (const chip of nextChips) {
    const name = String(chip ?? '').trim();
    if (!name) continue;
    const kept = byName.get(name);
    if (kept) {
      next.push(kept);
      continue;
    }
    if (!fallbackTable) {
      rejected.push(name);
      continue;
    }
    next.push({ table: fallbackTable, name });
  }
  return { next, rejected };
}

type CleanGroup = { tables: string[]; fields: SchemaFieldRef[]; views: SchemaViewRef[] };

/**
 * 保存前归一化：trim + 去重 + 按码点排序，**完整保留 requires/creates**（服务端提示条读 requires）。
 *
 * 实际口径（与下面 cleanGroup 的行为一一对应，别按更严的版本理解）：
 * - **整体全空**（四组怎么摆都空）→ null：题库里不留空对象，顺带与客观题的 NULL 语义对齐。
 *   留空的陷阱在顶层两串上：`{tables:[],fields:[]}` 是「真值」，抽题签名会把空数组当已声明
 *   （签名 `"T:#F:"` 非空），候选题一道都匹配不上 —— 顶层留空与"不校验"必须同一语义
 *   （同 paperAssembly.normalizeSchemaRefs，但那个只保留顶层签名用的两串，这里是题目契约、必须保形状）。
 * - requires/creates **里有内容的组**原样保留（含组内允许存在的空数组，如 `fields: []`）；
 *   全空的组裁掉，不在库里留空壳。
 * - 顶层 tables/fields 为空时整键省略（不写空数组，理由同上一条的签名陷阱）。
 */
export function normalizeQuestionRefs(refs?: SchemaRefs | null): SchemaRefs | null {
  if (!refs || typeof refs !== 'object') return null;

  const cleanStrings = (v?: string[] | null): string[] =>
    Array.from(new Set((v ?? []).map(s => String(s ?? '').trim()).filter(Boolean))).sort(cmp);

  const cleanFields = (v?: SchemaFieldRef[] | null): SchemaFieldRef[] => {
    const out = new Map<string, SchemaFieldRef>();
    for (const f of v ?? []) {
      const table = String(f?.table ?? '').trim();
      const field = String(f?.field ?? '').trim();
      // 没有宿主表的字段引用是脏数据：提示条把它挂在空表名下，文案会出现没有归属的「含字段：x」
      if (!table || !field) continue;
      out.set(`${table}\u0000${field}`, { table, field });
    }
    return [...out.values()].sort((a, b) => cmp(`${a.table}\u0000${a.field}`, `${b.table}\u0000${b.field}`));
  };

  const cleanViews = (v?: SchemaViewRef[] | null): SchemaViewRef[] => {
    const out = new Map<string, SchemaViewRef>();
    for (const item of v ?? []) {
      const table = String(item?.table ?? '').trim();
      const view = String(item?.view ?? '').trim();
      if (!table || !view) continue;
      out.set(`${table}\u0000${view}`, { table, view });
    }
    return [...out.values()].sort((a, b) => cmp(`${a.table}\u0000${a.view}`, `${b.table}\u0000${b.view}`));
  };

  const cleanGroup = (g?: SchemaRefGroup | null): CleanGroup => ({
    tables: cleanStrings(g?.tables),
    fields: cleanFields(g?.fields),
    views: cleanViews(g?.views),
  });
  const hasAny = (g: CleanGroup) => g.tables.length + g.fields.length + g.views.length > 0;

  const requires = cleanGroup(refs.requires);
  const creates = cleanGroup(refs.creates);
  const tables = cleanStrings(refs.tables);
  const fields = cleanStrings(refs.fields);
  if (!hasAny(requires) && !hasAny(creates) && tables.length === 0 && fields.length === 0) return null;

  return {
    ...(hasAny(requires) ? { requires } : {}),
    ...(hasAny(creates) ? { creates } : {}),
    ...(tables.length > 0 ? { tables } : {}),
    ...(fields.length > 0 ? { fields } : {}),
  };
}
