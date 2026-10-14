/**
 * 组卷编辑器纯逻辑：题位（DB 模型）⇄ 编辑行（UI 模型）的双向转换 + 试卷分析。
 *
 * 为什么要有这层：编辑行的粒度比题位更聚合。
 * - fixed 行 = 一道固定题；
 * - rule 行 = **一条抽题规则**，承载「简单/中等/困难各抽几道」（参考产品组卷方案的形态）——
 *   保存时展开成 N 个题位，每个题位固定一个难度，开考时 paper-generator 按题位抽题
 *   并在同一份卷子内自动去重（同规则题位不会抽到同一道题两次）。
 *
 * 转换必须可往返：打开已保存的试卷 → itemsFromSlots → slotsFromItems 与原题位等价
 * （顺序、分值、条件、schemaRefs 都不变）。这是"编辑旧卷不损坏数据"的底线，
 * 因此分组只合并**相邻**的同组规则题位，跨段的同名规则不合并。
 */
import type {
  Difficulty, PaperQuestion, Question, QuestionType, SchemaRefs, SlotRule, SlotType,
} from '../types';
import { QUESTION_TYPE_LABELS, questionTypeLabel } from './questionLabels';

const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];
export const DIFFICULTY_LABELS: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' };

export interface FixedEditorItem {
  kind: 'fixed';
  key: string;
  questionId: string;
  /** 列表展示用；编辑旧卷加载时由 /papers/:id 一并带回 */
  question: Question | null;
  score: number;
}

export interface RuleEditorItem {
  kind: 'rule';
  key: string;
  /** 题型；undefined = 旧规则未限题型（不在 UI 中新建，仅兼容往返） */
  ruleType?: QuestionType;
  capabilityIds: string[];
  /** 每题分值（该规则展开出的每个题位取同一分值） */
  score: number;
  /** 各难度抽题数量 */
  counts: Record<Difficulty, number>;
  /** 旧版规则：未指定难度的题位数量（原样保留往返，UI 只读展示） */
  noDifficultyCount: number;
  /** 引用结构声明：抽题等值校验依据；教师可在组卷页编辑（留空 = 不校验） */
  schemaRefs?: SchemaRefs | null;
  /** 各难度可用题数（slot-preview 填充，仅用于显示 /N 与校验） */
  availability?: Record<Difficulty, number> | null;
}

export type EditorItem = FixedEditorItem | RuleEditorItem;

/** 编辑行 key：仅作 React key 与本地定位，不落库 */
let keySeq = 0;
export function nextEditorKey(prefix: string): string {
  keySeq += 1;
  return `${prefix}-${Date.now()}-${keySeq}`;
}

/** 知识点签名（顺序无关）：分组比较用 */
function capsSignature(caps?: string[]): string {
  return [...(caps ?? [])].sort().join('|');
}

/**
 * 归一化「引用结构声明」——承重不变式，别在这里"简化"。
 *
 * 1. 空（两串都空 / 全空标签 / 未声明）必须归一成 `null` 而不是 `{ tables: [], fields: [] }`：
 *    空对象是「真值」，会被 slotsFromItems 原样发出，服务端 schemaRefsSignature 会把它算成
 *    `"T:#F:"`（非空签名）——于是候选题一个都匹配不上，教师看到的是"声明了但抽不出题"。
 *    留空与不校验必须是同一个语义。
 * 2. 标签 trim + 去重：表名/字段名在服务端是逐字比对，多一个空格或重复项就让等值校验落空。
 * 3. 返回值里的 tables/fields 一律是 string[]（输入可能带 undefined 或空数组）。
 */
export function normalizeSchemaRefs(refs?: SchemaRefs | null): SchemaRefs | null {
  const clean = (v?: string[]) => Array.from(new Set((v ?? []).map(s => String(s).trim()).filter(Boolean)));
  const tables = clean(refs?.tables);
  const fields = clean(refs?.fields);
  return tables.length || fields.length ? { tables, fields } : null;
}

/** 规则的主体条件是否同组（不含难度）：题型 + 知识点 + 每题分值 + 引用声明 */
function sameRuleGroup(a: RuleEditorItem, rule: SlotRule, score: number): boolean {
  return (
    (a.ruleType ?? null) === (rule.type ?? null)
    && capsSignature(a.capabilityIds) === capsSignature(rule.capabilityIds)
    && a.score === score
    && JSON.stringify(a.schemaRefs ?? null) === JSON.stringify(rule.schemaRefs ?? null)
  );
}

function emptyCounts(): Record<Difficulty, number> {
  return { easy: 0, medium: 0, hard: 0 };
}

/** 一条规则行展开出的题位数 */
export function ruleItemTotal(item: RuleEditorItem): number {
  return DIFFICULTY_ORDER.reduce((sum, d) => sum + (item.counts[d] || 0), 0) + item.noDifficultyCount;
}

export function isRuleItemEmpty(item: RuleEditorItem): boolean {
  return ruleItemTotal(item) === 0;
}

/** 题位列表 → 编辑行列表（相邻同组规则题位合并为一条规则行） */
export function itemsFromSlots(slots: PaperQuestion[]): EditorItem[] {
  const items: EditorItem[] = [];
  for (const slot of slots) {
    if (slot.slotType !== 'rule') {
      items.push({
        kind: 'fixed',
        key: nextEditorKey('fixed'),
        questionId: slot.questionId ?? '',
        question: slot.question ?? null,
        score: slot.score,
      });
      continue;
    }
    const rule = (slot.rule ?? {}) as SlotRule;
    const prev = items[items.length - 1];
    // 相邻 + 同组 → 并入上一条规则行（难度计数 +1；无难度旧规则进 noDifficultyCount）
    if (prev && prev.kind === 'rule' && sameRuleGroup(prev, rule, slot.score)) {
      if (rule.difficulty) prev.counts[rule.difficulty] += 1;
      else prev.noDifficultyCount += 1;
      continue;
    }
    items.push({
      kind: 'rule',
      key: nextEditorKey('rule'),
      ruleType: rule.type,
      capabilityIds: rule.capabilityIds ?? [],
      score: slot.score,
      counts: { ...emptyCounts(), ...(rule.difficulty ? { [rule.difficulty]: 1 } : {}) },
      noDifficultyCount: rule.difficulty ? 0 : 1,
      schemaRefs: rule.schemaRefs ?? null,
    });
  }
  return items;
}

export interface SlotPayload {
  questionId: string | null;
  sortOrder: number;
  score: number;
  slotType: SlotType;
  rule?: SlotRule | null;
}

/** 编辑行列表 → 题位提交载荷（规则行按 简单→中等→困难→旧规则 顺序展开） */
export function slotsFromItems(items: EditorItem[]): SlotPayload[] {
  const slots: SlotPayload[] = [];
  let order = 0;
  for (const item of items) {
    if (item.kind === 'fixed') {
      slots.push({
        questionId: item.questionId,
        sortOrder: order++,
        score: item.score,
        slotType: 'fixed',
      });
      continue;
    }
    const ruleItem = item; // 收窄为 RuleEditorItem，闭包里也要拿到收窄类型
    const pushRule = (difficulty?: Difficulty) => {
      slots.push({
        questionId: null,
        sortOrder: order++,
        score: ruleItem.score,
        slotType: 'rule',
        rule: {
          capabilityIds: ruleItem.capabilityIds ?? [],
          ...(ruleItem.ruleType ? { type: ruleItem.ruleType } : {}),
          ...(difficulty ? { difficulty } : {}),
          ...(ruleItem.schemaRefs ? { schemaRefs: ruleItem.schemaRefs } : {}),
        },
      });
    };
    for (const d of DIFFICULTY_ORDER) {
      for (let i = 0; i < (item.counts[d] || 0); i++) pushRule(d);
    }
    for (let i = 0; i < item.noDifficultyCount; i++) pushRule();
  }
  return slots;
}

/** 保存前校验：返回人类可读的错误列表（空数组 = 通过） */
export function validateEditorItems(items: EditorItem[]): string[] {
  const errors: string[] = [];
  items.forEach((item, index) => {
    if (item.kind === 'fixed') {
      if (!item.questionId) errors.push(`第 ${index + 1} 项：固定题尚未指定题目`);
      return;
    }
    if (isRuleItemEmpty(item)) {
      errors.push(`第 ${index + 1} 项抽题规则：还没有设置抽题数量`);
      return;
    }
    if (item.availability) {
      for (const d of DIFFICULTY_ORDER) {
        const want = item.counts[d] || 0;
        const have = item.availability[d] ?? 0;
        if (want > have) {
          errors.push(
            `第 ${index + 1} 项抽题规则：${DIFFICULTY_LABELS[d]}题要抽 ${want} 道，但题库里只有 ${have} 道可用`,
          );
        }
      }
    }
  });
  return errors;
}

// ── 试卷分析（对齐参考产品的「试卷分析」弹窗口径）──────────────

export interface PaperAnalysisRow {
  key: string;
  label: string;
  /** 题位数 */
  count: number;
  countPct: number;
  /** 分值合计 */
  score: number;
  scorePct: number;
  /** 题号（展开后题位的 1 基序号，与开考时的 slotIndex 一致） */
  indexes: number[];
}

export interface PaperAnalysis {
  totalQuestions: number;
  totalScore: number;
  rows: PaperAnalysisRow[];
}

/**
 * 试卷分析：按题型统计题目数/分值及占比，并给出每个题位的题号。
 * 抽题规则行按其「题型」归并成 抽题·XX 组（开考前不知道具体题目，用规则题型代替）。
 * 固定题但没有题目信息的按「未指定」分组，避免静默丢数。
 */
export function analyzeItems(items: EditorItem[]): PaperAnalysis {
  const map = new Map<string, PaperAnalysisRow>();
  let slotIndex = 0;
  let totalScore = 0;

  const push = (key: string, label: string, score: number) => {
    slotIndex += 1;
    totalScore += score;
    let row = map.get(key);
    if (!row) {
      row = { key, label, count: 0, countPct: 0, score: 0, scorePct: 0, indexes: [] };
      map.set(key, row);
    }
    row.count += 1;
    row.score += score;
    row.indexes.push(slotIndex);
  };

  for (const item of items) {
    if (item.kind === 'fixed') {
      const type = item.question?.type ?? 'unset';
      push(`fixed:${type}`, item.question ? questionTypeLabel(type) : '未指定题型', item.score);
      continue;
    }
    const label = `抽题·${item.ruleType ? QUESTION_TYPE_LABELS[item.ruleType] : '不限题型'}`;
    const key = `rule:${item.ruleType ?? 'any'}`;
    const total = ruleItemTotal(item);
    for (let i = 0; i < total; i++) push(key, label, item.score);
  }

  const totalQuestions = slotIndex;
  const rows = Array.from(map.values()).map((row) => ({
    ...row,
    countPct: totalQuestions > 0 ? Math.round((row.count / totalQuestions) * 100) : 0,
    scorePct: totalScore > 0 ? Math.round((row.score / totalScore) * 100) : 0,
  }));
  return { totalQuestions, totalScore, rows };
}

/** 已选清单浮层的难度分布：固定题按题目难度；抽题行按各难度抽题数量（旧规则无难度不计入） */
export function difficultyBreakdown(items: EditorItem[]): Record<Difficulty, number> {
  const result = emptyCounts();
  for (const item of items) {
    if (item.kind === 'fixed') {
      const d = item.question?.difficulty;
      if (d) result[d] += 1;
      continue;
    }
    for (const d of DIFFICULTY_ORDER) result[d] += item.counts[d] || 0;
  }
  return result;
}
