/**
 * 按场景开练：取整个场景、按 scenarioOrder 排序、不随机；上限 50，超过直接拒绝。
 * 同时锁定「与 questionIds / 分类参数互斥」的 400。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 's-1', userId: 's-1', username: 's-1', role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

// vi.mock 的 factory 会被提升到文件顶部执行，引用顶层 const 会踩 TDZ
// （Cannot access 'findMany' before initialization），故用 vi.hoisted 建桩
// ——与 practice-scenarios.test.ts 同款（简报原文的顶层 const 写法在 vitest 4 下直接炸套件）
const { findMany, create } = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn().mockResolvedValue({ id: 'rec-1' }),
}));
vi.mock('../../config/prisma', () => ({
  prisma: {
    practiceTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'u', accessToken: 't' }) },
    question: { findMany, count: vi.fn().mockResolvedValue(0) },
    practiceRecord: { create, deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));
vi.mock('../../services/wps-config-service', () => ({
  wpsConfigService: { getValidAccessToken: vi.fn().mockResolvedValue('token') },
}));
vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  KingsoftAdapter: class { async resetFile() { return true; } },
}));

import { practiceRouter } from '../practice';

const app = express();
app.use(express.json());
app.use('/api/practice', practiceRouter);

const q = (id: string, order: number | null) => ({
  id, title: `题${order ?? '无序号'}`, description: null, type: 'comprehensive', difficulty: 'medium',
  score: 10, answerRules: [], analysis: null, hints: null, scenario: '员工信息表', scenarioOrder: order,
});

describe('POST /api/practice/start 按场景开练', () => {
  beforeEach(() => { findMany.mockReset(); create.mockClear(); });

  it('按 scenarioOrder 出题，快照带 scenarioKey', async () => {
    // 夹具故意乱序塞入：排序必须由服务端做（若靠 SQL 返回序/输入序，这条立刻红）
    findMany.mockResolvedValue([q('q2', 2), q('q1', 1)]);
    const res = await request(app).post('/api/practice/start').send({ scenarioKey: '员工信息表' });
    expect(res.status).toBe(200);
    expect(res.body.questions.map((x: any) => x.questionId)).toEqual(['q1', 'q2']);
    const snapshot = create.mock.calls[0][0].data.questions;
    expect(snapshot[0].scenarioKey).toBe('员工信息表');
    // 契约是「每道题都带」：/scenarios 读侧只取首元素，但 Task 14 的续做标注要逐题用
    expect(snapshot.every((x: any) => x.scenarioKey === '员工信息表')).toBe(true);
  });

  // 没填序号的题不能插队（回填脚本理论上不该留空，但接口不能因此乱序）
  it('scenarioOrder 为 null 的题排在最后', async () => {
    findMany.mockResolvedValue([q('q-null', null), q('q2', 2), q('q1', 1)]);
    const res = await request(app).post('/api/practice/start').send({ scenarioKey: '员工信息表' });
    expect(res.status).toBe(200);
    expect(res.body.questions.map((x: any) => x.questionId)).toEqual(['q1', 'q2', 'q-null']);
  });

  it('场景题数超过 50 → 400 且不重置文件', async () => {
    findMany.mockResolvedValue(Array.from({ length: 51 }, (_, i) => q(`q${i}`, i + 1)));
    const res = await request(app).post('/api/practice/start').send({ scenarioKey: '员工信息表' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('50');
    expect(create).not.toHaveBeenCalled();
  });

  it('与 questionIds 同时传 → 400', async () => {
    const res = await request(app).post('/api/practice/start')
      .send({ scenarioKey: '员工信息表', questionIds: ['11111111-1111-1111-1111-111111111111'] });
    expect(res.status).toBe(400);
  });
});
