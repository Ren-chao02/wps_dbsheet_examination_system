/**
 * examDisplay 纯函数测试 — 考试展示与编辑守卫
 */
import { describe, it, expect } from 'vitest';
import { examEditGuard, countAssignedStudents, modeLabels } from '../examDisplay';
import type { Exam } from '../../types';

describe('examEditGuard', () => {
  it('ended（已结束）考试即使归属本人也不可编辑', () => {
    const result = examEditGuard('ended', true);
    expect(result.disabled).toBe(true);
    expect(result.tip).toContain('已结束');
  });

  it('in_progress（进行中）考试不可编辑', () => {
    expect(examEditGuard('in_progress', true).disabled).toBe(true);
  });

  it('非创建者一律不可编辑', () => {
    expect(examEditGuard('draft', false).disabled).toBe(true);
    expect(examEditGuard('ended', false).disabled).toBe(true);
  });

  it('草稿/已发布等非结束状态、归属本人时可编辑', () => {
    expect(examEditGuard('draft', true).disabled).toBe(false);
    expect(examEditGuard('published', true).disabled).toBe(false);
    expect(examEditGuard('scheduled', true).disabled).toBe(false);
  });
});

describe('countAssignedStudents', () => {
  it('汇总各考场考生数量', () => {
    const exam = {
      assignments: [
        { _count: { students: 3 } },
        { _count: { students: 5 } },
      ],
    } as unknown as Exam;
    expect(countAssignedStudents(exam)).toBe(8);
  });

  it('无分配时返回 0', () => {
    expect(countAssignedStudents({ assignments: [] } as unknown as Exam)).toBe(0);
    expect(countAssignedStudents({} as unknown as Exam)).toBe(0);
  });
});

describe('modeLabels', () => {
  it('包含三种考试模式文案', () => {
    expect(modeLabels.practice).toBe('练习');
    expect(modeLabels.quiz).toBe('测验');
    expect(modeLabels.exam).toBe('正式考试');
  });
});
