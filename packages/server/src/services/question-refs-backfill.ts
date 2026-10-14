/**
 * 回填计划：把「推导前置契约」与「场景归链」合成一份可直接落库的计划 + 待人工清单。
 * 抽成纯函数是为了可测——真正写库的薄脚本（scripts/backfill-question-refs.ts）不做任何判断。
 */
import { derivePrerequisites, type DeriveResult, type SchemaRefs } from '../engine/prerequisite-deriver';
import { clusterScenarios } from './scenario-cluster';
import type { AnswerRule } from '../engine/rule-engine';

export interface BackfillInput {
  id: string;
  title: string;
  /** 描述：推导器判"真建表 vs 前置检查"要用（见 prerequisite-deriver 的 hasCreationIntent） */
  description?: string | null;
  /** 直接来自 Prisma 的 Json 列，可能是任意脏数据 */
  answerRules: unknown;
}

export interface BackfillEntry {
  id: string;
  title: string;
  refs: SchemaRefs;
  unresolved: string[];
  scenario: string | null;
  scenarioOrder: number | null;
  /** 有值 = 进「待人工确认」清单（可能仍有参考用的 scenario） */
  pendingReason?: string;
}

export interface BackfillPlan {
  entries: BackfillEntry[];
  scenarios: { key: string; questionCount: number }[];
  autoCount: number;
  pendingCount: number;
}

const asRules = (raw: unknown): AnswerRule[] => (Array.isArray(raw) ? (raw as AnswerRule[]) : []);
const emptyRefs = (): SchemaRefs => ({
  requires: { tables: [], fields: [], views: [] },
  creates: { tables: [], fields: [], views: [] },
  tables: [],
  fields: [],
});

export function buildBackfillPlan(questions: BackfillInput[]): BackfillPlan {
  const derived = new Map<string, DeriveResult>();
  for (const q of questions) {
    try {
      // 题面一起传进去：check_table_exists 是不是"真建表"要看题面语义
      derived.set(q.id, derivePrerequisites(asRules(q.answerRules), { title: q.title, description: q.description }));
    } catch {
      // 脏规则（不是数组 / 结构异常）不该让整批回填失败
      derived.set(q.id, { refs: emptyRefs(), unresolved: ['(规则解析失败)'] });
    }
  }

  const cluster = clusterScenarios(
    questions.map(q => ({
      id: q.id,
      title: q.title,
      requires: derived.get(q.id)!.refs.requires.tables,
      creates: derived.get(q.id)!.refs.creates.tables,
    })),
  );

  const assignmentOf = new Map(cluster.assignments.map(a => [a.id, a]));
  const pendingOf = new Map(cluster.pending.map(p => [p.id, p]));

  const entries: BackfillEntry[] = questions.map(q => {
    const { refs, unresolved } = derived.get(q.id)!;
    const a = assignmentOf.get(q.id);
    const p = pendingOf.get(q.id);
    const reasons: string[] = [];
    if (p) reasons.push(p.reason);
    if (unresolved.length > 0) reasons.push(`规则 action 引擎未实现/缺参数：${unresolved.join('、')}`);
    return {
      id: q.id,
      title: q.title,
      refs,
      unresolved,
      scenario: a?.scenario ?? null,
      scenarioOrder: a?.scenarioOrder ?? null,
      ...(reasons.length > 0 ? { pendingReason: reasons.join('；') } : {}),
    };
  });

  // 链顺序沿用归链的输出顺序（首次出现 = 教学顺序），**不要按 key 重排**：
  // 中文 localeCompare 依赖语言环境，会让人工清单的顺序随机器漂移（Task 2 已定过这条口径）
  const counts = new Map<string, number>();
  for (const a of cluster.assignments) counts.set(a.scenario, (counts.get(a.scenario) ?? 0) + 1);

  return {
    entries,
    scenarios: [...counts.entries()].map(([key, questionCount]) => ({ key, questionCount })),
    autoCount: entries.filter(e => !e.pendingReason).length,
    pendingCount: entries.filter(e => e.pendingReason).length,
  };
}
