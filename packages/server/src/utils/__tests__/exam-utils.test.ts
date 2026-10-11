/**
 * 考试时间口径单元测试
 *
 * `computeStudentDeadline` 是「剩余时间显示」与「到点自动收卷」的唯一服务端口径，
 * 随到随考做错会直接导致学生被提前收卷或超时作答，因此用纯函数测试锁死行为。
 */
import { describe, it, expect } from 'vitest';
import { computeStudentDeadline } from '../exam-utils';

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
