/**
 * 考试时间口径单元测试
 *
 * `computeStudentDeadline` 是「剩余时间显示」与「到点自动收卷」的唯一服务端口径，
 * 随到随考做错会直接导致学生被提前收卷或超时作答，因此用纯函数测试锁死行为。
 */
import { describe, it, expect } from 'vitest';
import { computeStudentDeadline, computeEarliestSubmitAt } from '../exam-utils';

const at = (iso: string) => new Date(iso);

describe('computeStudentDeadline — 集中统一（unified）', () => {
  it('按考试 endTime 截止（与全体一致，不看个人开考时刻）', () => {
    const exam = { startTime: at('2026-10-11T01:00:00Z'), endTime: at('2026-10-11T03:00:00Z'), durationMinutes: 60 };
    const deadline = computeStudentDeadline(exam, { startedAt: at('2026-10-11T02:30:00Z') });
    expect(deadline).toBe(at('2026-10-11T03:00:00Z').getTime());
  });

  it('无 endTime 时退化为 startTime + 时长', () => {
    const exam = { startTime: at('2026-10-11T01:00:00Z'), endTime: null, durationMinutes: 90 };
    expect(computeStudentDeadline(exam, null)).toBe(at('2026-10-11T02:30:00Z').getTime());
  });

  it('无任何时间信息时返回 null（调用方视为不自动收卷）', () => {
    expect(computeStudentDeadline({ startTime: null, endTime: null, durationMinutes: 60 }, null)).toBeNull();
  });
});

describe('computeStudentDeadline — 随到随考（flexible）', () => {
  const batchBase = {
    examMode: 'flexible',
    startTime: at('2026-10-11T00:00:00Z'),
    endTime: at('2026-10-11T06:00:00Z'),
    examDuration: 60,
  };

  it('每人 = 自己开考时刻 + 考试时长（这才是说明书承诺的口径）', () => {
    const exam = { startTime: null, endTime: null, durationMinutes: 60, batch: batchBase };
    // 甲 01:00 开考 → 02:00 截止
    expect(computeStudentDeadline(exam, { startedAt: at('2026-10-11T01:00:00Z') }))
      .toBe(at('2026-10-11T02:00:00Z').getTime());
    // 乙 01:30 开考 → 02:30 截止（晚进场不等于少做题，也不等于能超时）
    expect(computeStudentDeadline(exam, { startedAt: at('2026-10-11T01:30:00Z') }))
      .toBe(at('2026-10-11T02:30:00Z').getTime());
  });

  it('不越过批次结束时刻（最后 10 分钟入场只能做到批次结束）', () => {
    const exam = { startTime: null, endTime: null, durationMinutes: 60, batch: batchBase };
    expect(computeStudentDeadline(exam, { startedAt: at('2026-10-11T05:50:00Z') }))
      .toBe(at('2026-10-11T06:00:00Z').getTime());
  });

  it('尚未开考（无 startedAt）时退化为批次结束时刻', () => {
    const exam = { startTime: null, endTime: null, durationMinutes: 60, batch: batchBase };
    expect(computeStudentDeadline(exam, null)).toBe(at('2026-10-11T06:00:00Z').getTime());
  });

  it('批次未设置结束时间时只按个人时长', () => {
    const exam = {
      startTime: null, endTime: null, durationMinutes: 60,
      batch: { ...batchBase, endTime: null },
    };
    expect(computeStudentDeadline(exam, { startedAt: at('2026-10-11T01:00:00Z') }))
      .toBe(at('2026-10-11T02:00:00Z').getTime());
  });

  it('批次时长优先于考试自身时长（批次内统一时长）', () => {
    const exam = {
      startTime: null, endTime: null, durationMinutes: 30,
      batch: { ...batchBase, examDuration: 120 },
    };
    expect(computeStudentDeadline(exam, { startedAt: at('2026-10-11T01:00:00Z') }))
      .toBe(at('2026-10-11T03:00:00Z').getTime());
  });
});

/**
 * 最早交卷时刻：下发（学生端按钮禁用）与校验（交卷接口）共用同一函数，
 * 配置异常时的行为（未配置/无基准）必须返回 null 而不是错误时刻。
 */
describe('computeEarliestSubmitAt — 最早交卷', () => {
  it('集中统一：基准为考试开始时间（startTime + N 分钟）', () => {
    const exam = {
      settings: { earliestSubmitMinutes: 30 },
      startTime: at('2026-10-11T01:00:00Z'),
      batch: { examMode: 'unified' },
    };
    expect(computeEarliestSubmitAt(exam, { startedAt: at('2026-10-11T01:05:00Z') }))
      .toBe(at('2026-10-11T01:30:00Z').getTime());
  });

  it('随到随考：基准为本人作答开始时间（每人自己的时钟）', () => {
    const exam = {
      settings: { earliestSubmitMinutes: 15 },
      startTime: at('2026-10-11T01:00:00Z'),
      batch: { examMode: 'flexible' },
    };
    expect(computeEarliestSubmitAt(exam, { startedAt: at('2026-10-11T02:10:00Z') }))
      .toBe(at('2026-10-11T02:25:00Z').getTime());
  });

  it('未配置 / 配置为 0 / 负数 → null（不限）', () => {
    const base = { startTime: at('2026-10-11T01:00:00Z'), batch: { examMode: 'unified' } };
    expect(computeEarliestSubmitAt({ ...base, settings: {} }, null)).toBeNull();
    expect(computeEarliestSubmitAt({ ...base, settings: { earliestSubmitMinutes: 0 } }, null)).toBeNull();
    expect(computeEarliestSubmitAt({ ...base, settings: { earliestSubmitMinutes: -5 } }, null)).toBeNull();
  });

  it('算不出基准（无 startTime 且无 startedAt）→ null，不生成错误时刻', () => {
    const exam = { settings: { earliestSubmitMinutes: 30 }, startTime: null, batch: { examMode: 'unified' } };
    expect(computeEarliestSubmitAt(exam, null)).toBeNull();
  });

  it('统一模式缺 startTime 时退化用本人 startedAt', () => {
    const exam = { settings: { earliestSubmitMinutes: 20 }, startTime: null, batch: { examMode: 'unified' } };
    expect(computeEarliestSubmitAt(exam, { startedAt: at('2026-10-11T01:40:00Z') }))
      .toBe(at('2026-10-11T02:00:00Z').getTime());
  });
});
