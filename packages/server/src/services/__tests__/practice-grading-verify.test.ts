/**
 * 练习判分分数口径回归测试
 *
 * 背景（已修复的真实缺陷）：规则分是**百分制权重**（种子题库里是 25/30/70/100），
 * 而题目分值是 5/10 分。练习判分曾直接累加规则原始分，导致：
 *   - 单题「100/10 分」、总分虚高约 10 倍
 *   - 及格线用 maxScore（点分制）判定 → `passed` 恒为真
 * 本测试锁死修复后的口径：与考试判分一致
 *   `单题得分 = round(规则原始分 / 规则满分 × 题目分值)`
 * 一旦有人把换算改回去，这里会立刻失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    practiceRecord: { findUnique: vi.fn(), update: vi.fn() },
    question: { findMany: vi.fn() },
    practiceTableAssignment: { findUnique: vi.fn() },
    wrongQuestion: { upsert: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

vi.mock('../wps-config-service', () => ({
  wpsConfigService: { getValidAccessToken: vi.fn().mockResolvedValue('token-1') },
}));

const { mockAdapter } = vi.hoisted(() => ({ mockAdapter: { getSchema: vi.fn(), getRecords: vi.fn() } }));
vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  createAdapterFromSpaceId: () => mockAdapter,
  KingsoftAdapter: class {},
}));

import { gradePracticeRecord } from '../practice-grading-service';

/** 一张包含「员工信息表」的 Schema：规则 check_table_exists 会命中 */
const SCHEMA = {
  result: 0,
  detail: {
    sheets: [
      { id: 1, name: '员工信息表', primaryFieldId: 'f1', fields: [], views: [] },
    ],
  },
};

const RECORD = {
  id: 'rec-1',
  studentId: 'stu-1',
  tableSpaceId: 'file-1:token-old',
  status: 'in_progress',
  questions: [{ questionId: 'q-1', score: 10, sortOrder: 0 }],
};

const QUESTION = {
  id: 'q-1',
  title: '创建员工信息表',
  type: 'create_table',
  difficulty: 'easy',
  score: 10,
  analysis: null,
  // 两条规则，权重合计 100（百分制）—— 与种子题库一致
  answerRules: [
    { id: 'r1', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 60 },
    { id: 'r2', action: 'check_table_exists', params: { tableName: '工资表' }, score: 40 },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter.getSchema.mockResolvedValue(SCHEMA);
  mockAdapter.getRecords.mockResolvedValue({ result: 0, detail: { fieldsSchema: [], offset: '', records: [] } });
  mockPrisma.practiceRecord.findUnique.mockResolvedValue(RECORD);
  mockPrisma.question.findMany.mockResolvedValue([QUESTION]);
  mockPrisma.practiceTableAssignment.findUnique.mockResolvedValue(null);
  mockPrisma.wrongQuestion.upsert.mockResolvedValue({});
  // $transaction(cb) → 直接执行回调，传入 prisma 自身作为 tx
  mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
});

describe('练习判分：规则百分制 → 题目分值换算', () => {
  it('部分正确：60/100 权重 × 10 分 = 6 分（而不是记为 60 分）', async () => {
    const result = await gradePracticeRecord('rec-1');

    expect(result.maxScore).toBe(10);          // 满分是题目分值，不是规则权重和
    expect(result.score).toBe(6);              // 命中 60 权重 → 6 分
    expect(result.details[0].score).toBe(6);
    expect(result.details[0].maxScore).toBe(10);
    expect(result.score).toBeLessThanOrEqual(result.maxScore);
  });

  it('全部通过：单题满分 10，且 passed=true', async () => {
    mockAdapter.getSchema.mockResolvedValue({
      ...SCHEMA,
      detail: {
        sheets: [
          { id: 1, name: '员工信息表', primaryFieldId: 'f1', fields: [], views: [] },
          { id: 2, name: '工资表', primaryFieldId: 'f2', fields: [], views: [] },
        ],
      },
    });

    const result = await gradePracticeRecord('rec-1');
    expect(result.score).toBe(10);
    expect(result.maxScore).toBe(10);
    expect(result.passed).toBe(true);
    expect(result.details[0].isCorrect).toBe(true);
  });

  it('全部失败：0 分且 passed=false（修复前因分母口径错误会恒为真）', async () => {
    mockAdapter.getSchema.mockResolvedValue({
      result: 0,
      detail: { sheets: [{ id: 9, name: '无关表', primaryFieldId: 'x', fields: [], views: [] }] },
    });

    const result = await gradePracticeRecord('rec-1');
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(10);
    expect(result.passed).toBe(false);
  });

  it('分数写回与错题本在同一事务内（原子性）', async () => {
    await gradePracticeRecord('rec-1');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
