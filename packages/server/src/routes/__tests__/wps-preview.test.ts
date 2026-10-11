/**
 * 考生 WPS 表格辅助接口测试
 *
 * 覆盖（两个接口都不参与判分，失败不得影响考试流程）：
 * - GET /api/my-exams/:id/wps-preview
 *   · 未分配表格 → 404
 *   · 正常读取 → 返回表名/字段/记录，并命中 4s 内存缓存（WPS 只调用一次）
 *   · WPS 读取失败 → 502 且带可读原因（不能抛 500 让前端无从提示）
 *   · ?sheetId= 指定非首张表
 * 通过 vi.mock 替换 authenticate / authorize（免 JWT）、config/prisma（免 DB）、
 * 适配器工厂（免真实调用 WPS）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'stu-1', userId: 'stu-1', username: '20252861', role: 'student' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    examTableAssignment: { findUnique: vi.fn() },
    // 系统当前 token（wps_config）——预览优先用它，缺失时回退分配快照 token
    wpsConfig: { findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

const { mockCreateAdapter } = vi.hoisted(() => ({ mockCreateAdapter: vi.fn() }));
vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  createAdapterFromSpaceId: mockCreateAdapter,
  KingsoftAdapter: class {},
}));

import { myExamRouter } from '../my-exams';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/my-exams', myExamRouter);
  return app;
}

/** 构造一个可用的适配器桩：第一张表「订单表」，两条记录 */
function stubAdapter(overrides: any = {}) {
  return {
    getSchema: vi.fn().mockResolvedValue({
      result: 0,
      detail: {
        sheets: [
          {
            id: 1,
            name: '订单表',
            primaryFieldId: 'f1',
            fields: [{ id: 'f1', name: '订单号', type: 'MultiLineText' }],
            views: [],
          },
          {
            id: 2,
            name: '客户表',
            primaryFieldId: 'f2',
            fields: [{ id: 'f2', name: '客户名', type: 'MultiLineText' }],
            views: [],
          },
        ],
      },
    }),
    getRecords: vi.fn().mockResolvedValue({
      result: 0,
      detail: {
        fieldsSchema: [
          { id: 'f1', name: '订单号', type: 'MultiLineText' },
          { id: 'f3', name: '金额', type: 'Number' },
        ],
        offset: '',
        records: [
          { id: 'r1', fields: { f1: 'A-001', f3: 120 } },
          { id: 'r2', fields: { f1: 'A-002', f3: 80 } },
        ],
      },
    }),
    ...overrides,
  };
}

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.examTableAssignment.findUnique.mockResolvedValue({
    fileId: 'file-abc',
    accessToken: 'token-xyz',
    shareUrl: 'https://www.kdocs.cn/l/cuqJOJ0WNPQd',
  });
  mockPrisma.wpsConfig.findUnique.mockResolvedValue(null);
  mockCreateAdapter.mockReturnValue(stubAdapter());
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('GET /api/my-exams/:id/wps-preview', () => {
  it('未分配表格时返回 404 与可读提示', async () => {
    mockPrisma.examTableAssignment.findUnique.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/my-exams/exam-none/wps-preview');
    expect(res.status).toBe(404);
    expect(res.body.message).toContain('尚未分配');
  });

  it('正常读取首张表：返回表名、字段、记录，并附全表名列表', async () => {
    const res = await request(makeApp()).get('/api/my-exams/exam-ok/wps-preview');
    expect(res.status).toBe(200);
    expect(res.body.sheetName).toBe('订单表');
    expect(res.body.sheets).toEqual([
      { id: 1, name: '订单表' },
      { id: 2, name: '客户表' },
    ]);
    expect(res.body.fields.map((f: any) => f.name)).toEqual(['订单号', '金额']);
    expect(res.body.records).toHaveLength(2);
    expect(res.body.truncated).toBe(false);
    expect(res.body.syncedAt).toBeTruthy();
  });

  it('4 秒内重复请求命中缓存，不重复调用 WPS', async () => {
    const app = makeApp();
    await request(app).get('/api/my-exams/exam-cache/wps-preview');
    await request(app).get('/api/my-exams/exam-cache/wps-preview');
    expect(mockCreateAdapter).toHaveBeenCalledTimes(1);
  });

  it('可用 sheetId 指定非首张表', async () => {
    const res = await request(makeApp()).get('/api/my-exams/exam-sheet/wps-preview?sheetId=2');
    expect(res.status).toBe(200);
    expect(res.body.sheetId).toBe(2);
    expect(res.body.sheetName).toBe('客户表');
  });

  it('WPS 读取失败返回 502 与原因，而不是 500', async () => {
    mockCreateAdapter.mockReturnValue(
      stubAdapter({ getSchema: vi.fn().mockRejectedValue(new Error('token 已过期')) }),
    );
    const res = await request(makeApp()).get('/api/my-exams/exam-err/wps-preview');
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('token 已过期');
  });

  it('凭据缺失（无 accessToken 且环境变量未配置）返回 503', async () => {
    mockCreateAdapter.mockReturnValue(null);
    const res = await request(makeApp()).get('/api/my-exams/exam-notoken/wps-preview');
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('凭据');
  });

  it('系统当前 token 失效时回退到分配快照 token', async () => {
    mockPrisma.wpsConfig.findUnique.mockResolvedValue({ accessToken: 'stale-config-token' });
    mockCreateAdapter
      .mockReturnValueOnce(
        stubAdapter({ getSchema: vi.fn().mockRejectedValue(new Error('invalid_token')) }),
      )
      .mockReturnValueOnce(stubAdapter());

    const res = await request(makeApp()).get('/api/my-exams/exam-fallback/wps-preview');
    expect(res.status).toBe(200);
    expect(res.body.sheetName).toBe('订单表');
    expect(mockCreateAdapter).toHaveBeenCalledTimes(2);
  });
});
