/**
 * 难度分布修复（generate-and-repair 的 repair 段，纯函数）。
 *
 * 生成器先按题位抽出卷子（硬约束已全部满足），这里只做一件事：
 * 在不破坏硬约束的前提下，用"换一道本卷还没用过的候选"逐步逼近难度目标。
 *
 * 为什么不在抽取阶段一次算好：题位之间会争抢候选题，而且"能否达到目标"取决于
 * 整卷当前分布；先生成再修复，每一步都可以解释、可以回放，也不会改动已过审的抽取语义。
 */
import { schemaRefsSignature, type SlotCandidate } from './paper-generator';

export interface DifficultyTarget { easy?: number; medium?: number; hard?: number }
export interface RepairSlotInput {
  slotIndex: number;
  slotScore: number;
  currentQuestionId: string;
  currentDifficulty: string | null;
  wantedSignature?: string;
  /** 已由调用方按该题位硬约束列出（分值/题型/签名/池范围），函数内只再排除"本卷已用" */
  candidates: SlotCandidate[];
}
export interface RepairChange {
  slotIndex: number;
  from: string;
  to: string;
  candidates: number;
  wantedSignature: string;
  actualSignature: string;
}
export interface RepairResult {
  changes: RepairChange[];
  before: Record<string, number>;
  after: Record<string, number>;
  targetCounts: Record<string, number> | null;
}

const LEVELS = ['easy', 'medium', 'hard'] as const;
type Level = typeof LEVELS[number];

/** 最大余数法：把比例换算成道数，保证 Σtarget = n（与 spec 第七节口径一致） */
export function computeTargetCounts(target: DifficultyTarget, n: number): Record<Level, number> {
  const raw = LEVELS.map(l => (target[l] ?? 0) * n);
  const base = raw.map(Math.floor) as number[];
  let remaining = n - base.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remaining <= 0) break;
    base[i] += 1;
    remaining -= 1;
  }
  return { easy: base[0], medium: base[1], hard: base[2] };
}

function distribution(slots: RepairSlotInput[]): Record<string, number> {
  const d: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const s of slots) if (s.currentDifficulty && s.currentDifficulty in d) d[s.currentDifficulty] += 1;
  return d;
}

function costOf(dist: Record<string, number>, target: Record<Level, number>): number {
  return LEVELS.reduce((sum, l) => sum + Math.abs((dist[l] ?? 0) - target[l]), 0);
}

export function repairDifficultyDistribution(
  slots: RepairSlotInput[],
  target: DifficultyTarget | null | undefined,
  maxIterations = Math.min(slots.length * 2, 20),
): RepairResult {
  // 纯函数：不改调用方的数组与对象——「同输入两次调用结果一致」是契约的一部分。
  // 顺带按 slotIndex 升序固定迭代顺序，结果不依赖调用方传参顺序。
  const state = slots.map(s => ({ ...s })).sort((a, b) => a.slotIndex - b.slotIndex);
  const before = distribution(state);
  if (!target) return { changes: [], before, after: { ...before }, targetCounts: null };

  const targetCnt = computeTargetCounts(target, state.length);
  const used = new Set(state.map(s => s.currentQuestionId));
  const dist = { ...before };
  const changes: RepairChange[] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    let best: { slotIndex: number; cand: SlotCandidate; delta: number } | null = null;

    for (const s of state) {
      for (const c of s.candidates) {
        if (used.has(c.id) || !c.difficulty || !(c.difficulty in dist)) continue;
        const oldLevel = s.currentDifficulty;
        if (!oldLevel || !(oldLevel in dist)) continue;
        if (c.difficulty === oldLevel) continue;

        // 模拟这次替换对 cost 的影响（只动两个桶）
        const next = { ...dist };
        next[oldLevel] -= 1;
        next[c.difficulty] += 1;
        const delta = costOf(dist, targetCnt) - costOf(next, targetCnt);
        if (delta <= 0) continue;
        if (!best || delta > best.delta || (delta === best.delta && (s.slotIndex < best.slotIndex || (s.slotIndex === best.slotIndex && c.id < best.cand.id)))) {
          best = { slotIndex: s.slotIndex, cand: c, delta };
        }
      }
    }

    if (!best) break;

    const s = state.find(x => x.slotIndex === best!.slotIndex)!;
    const oldId = s.currentQuestionId;
    const oldLevel = s.currentDifficulty!;
    dist[oldLevel] -= 1;
    dist[best.cand.difficulty!] += 1;
    used.delete(oldId);
    used.add(best.cand.id);
    changes.push({
      slotIndex: s.slotIndex,
      from: oldId,
      to: best.cand.id,
      candidates: s.candidates.length,
      wantedSignature: s.wantedSignature ?? '',
      actualSignature: schemaRefsSignature(best.cand.schemaRefs),
    });
    s.currentQuestionId = best.cand.id;
    s.currentDifficulty = best.cand.difficulty;
  }

  return { changes, before, after: dist, targetCounts: { easy: targetCnt.easy, medium: targetCnt.medium, hard: targetCnt.hard } };
}
