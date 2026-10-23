/**
 * 批次级联发布 → 补调度组卷预生成。
 *
 * 集中统一考试的发布主路径是「激活批次」（子考试状态从 draft 级联成 published），
 * 不补调度的话这些考试的预生成永远不跑，质量卡片会一直显示"暂无记录"。
 * 单场调度失败不能把整批激活拖成 500（与发布接口的 fail-safe 同口径）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});

const { rescheduleMock, batchFindUnique, batchUpdate, examUpdateMany, examFindMany } = vi.hoisted(() => ({
  rescheduleMock: vi.fn(),
  batchFindUnique: vi.fn(),
  batchUpdate: vi.fn(),
  examUpdateMany: vi.fn(),
  examFindMany: vi.fn(),
}));

// 该路由只用到 reschedulePaperGeneration，整模块替换即可（其余导出不被 batches.ts 引用）
vi.mock('../../services/paper-generation-lifecycle', () => ({
  reschedulePaperGeneration: rescheduleMock,
}));
vi.mock('../../utils/exam-utils', () => ({
  autoEndExpiredExams: vi.fn(),
  finalizeExamSubmissions: vi.fn(),
}));
vi.mock('../../config/prisma', () => ({
  prisma: {
    examBatch: { findUnique: batchFindUnique, update: batchUpdate },
    exam: { updateMany: examUpdateMany, findMany: examFindMany },
  },
}));
vi.mock('../../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { batchRouter } from '../batches';

const app = express();
app.use(express.json());
app.use('/api/batches', batchRouter);

const batchRow = {
  id: 'b-1',
  name: '期末批次',
  status: 'draft',
  createdBy: 't-1',
  startTime: new Date('2026-11-01T09:00:00Z'),
  endTime: new Date('2026-11-01T11:00:00Z'),
  exams: [
    { id: 'e-1', status: 'draft', _count: { examQuestions: 2 }, paper: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  batchFindUnique.mockResolvedValue(batchRow);
  batchUpdate.mockImplementation(async (args: any) => ({ ...batchRow, ...args.data }));
  examUpdateMany.mockResolvedValue({ count: 1 });
  examFindMany.mockResolvedValue([]);
  rescheduleMock.mockResolvedValue('queued');
});

describe('PUT /api/batches/:id/status —— 激活时的预生成调度', () => {
  it('draft → active 级联发布一场就绪考试 → 逐场调度预生成', async () => {
    const res = await request(app)
      .put('/api/batches/b-1/status')
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.cascadePublished).toBe(1);
    expect(examUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e-1'] } },
      data: { status: 'published' },
    });
    expect(rescheduleMock).toHaveBeenCalledWith('e-1');
  });

  it('单场调度失败 → 整批激活仍 200（发布已生效，组卷欠账可后续补）', async () => {
    rescheduleMock.mockRejectedValue(new Error('queue down'));

    const res = await request(app)
      .put('/api/batches/b-1/status')
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.cascadePublished).toBe(1);
    expect(rescheduleMock).toHaveBeenCalledWith('e-1');
  });

  it('没有就绪考试（无题目）→ 不发布也不调度', async () => {
    batchFindUnique.mockResolvedValue({
      ...batchRow,
      exams: [{ id: 'e-2', status: 'draft', _count: { examQuestions: 0 }, paper: null }],
    });

    const res = await request(app)
      .put('/api/batches/b-1/status')
      .send({ status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.cascadePublished).toBe(0);
    expect(examUpdateMany).not.toHaveBeenCalled();
    expect(rescheduleMock).not.toHaveBeenCalled();
  });
});
