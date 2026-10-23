/**
 * 候选枚举唯一入口的测试。
 * 预检/生成/修复三处共用它，所以这里锁死的是"三档各放宽什么、共同过滤什么"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
vi.mock('../../config/prisma', () => ({ prisma: {} }));

// 每个用例只看自己这一次的查询参数：不清空的话 mock.calls[0] 会指向前一个用例
beforeEach(() => {
  findMany.mockClear();
});

import { listSlotCandidates, type SlotRule } from '../paper-generator';

const q = (id: string, over: Partial<{ score: number; difficulty: string; schemaRefs: any; answerRules: any }> = {}) => ({
  id, score: 10, difficulty: 'easy',
  schemaRefs: { tables: ['员工信息表'], fields: [] },
  answerRules: [{ action: 'check_field', params: {} }],
  ...over,
});

const rule = (over: Partial<SlotRule> = {}): SlotRule => ({ type: 'comprehensive', ...over });
const tx = { question: { findMany } } as any;

describe('listSlotCandidates', () => {
  it('strict：过滤分值不符、已用、引擎判不了、结构签名不一致', async () => {
    findMany.mockResolvedValue([
      q('a'),
      q('b', { score: 20 }),
      q('c', { schemaRefs: { tables: ['别的表'], fields: [] } }),
      q('d', { answerRules: [{ action: 'verify_dashboard_chart', params: {} }] }),
      q('e'),
    ]);
    const out = await listSlotCandidates({
      rule: rule({ difficulty: 'easy', schemaRefs: { tables: ['员工信息表'], fields: [] } }),
      slotScore: 10, level: 'strict', usedQuestionIds: new Set(['e']), tx,
    });
    expect(out.map(c => c.id)).toEqual(['a']);
    expect(findMany.mock.calls[0][0].where.difficulty).toBe('easy');
  });

  it('relax-schemaRefs：同样带难度条件，但不再比较结构签名', async () => {
    findMany.mockResolvedValue([
      q('a'), q('c', { schemaRefs: { tables: ['别的表'], fields: [] } }),
    ]);
    const out = await listSlotCandidates({
      rule: rule({ difficulty: 'easy', schemaRefs: { tables: ['员工信息表'], fields: [] } }),
      slotScore: 10, level: 'relax-schemaRefs', tx,
    });
    expect(out.map(c => c.id)).toEqual(['a', 'c']);
    expect(findMany.mock.calls[0][0].where.difficulty).toBe('easy');
  });

  it('relax-difficulty：去掉难度条件，其余过滤保留', async () => {
    findMany.mockResolvedValue([q('a', { difficulty: 'hard' }), q('b', { score: 5 })]);
    const out = await listSlotCandidates({
      rule: rule({ difficulty: 'easy' }), slotScore: 10, level: 'relax-difficulty', tx,
    });
    expect(out.map(c => c.id)).toEqual(['a']);
    expect(findMany.mock.calls[0][0].where.difficulty).toBeUndefined();
  });

  it('三档都排除引擎判不了的题', async () => {
    findMany.mockResolvedValue([q('bad', { answerRules: [{ action: 'verify_ocr_functionality' }] })]);
    for (const level of ['strict', 'relax-schemaRefs', 'relax-difficulty'] as const) {
      expect(await listSlotCandidates({ rule: rule(), slotScore: 10, level, tx })).toEqual([]);
    }
  });

  it('poolWhere 挂到 AND 上，不覆盖 status/type', async () => {
    findMany.mockResolvedValue([]);
    await listSlotCandidates({
      rule: rule(), slotScore: 10, level: 'strict',
      poolWhere: { OR: [{ departmentId: 'd-1' }, { departmentId: null }] }, tx,
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toBe('published');
    expect(where.type).toBe('comprehensive');
    expect(where.AND).toEqual([{ OR: [{ departmentId: 'd-1' }, { departmentId: null }] }]);
  });
});
