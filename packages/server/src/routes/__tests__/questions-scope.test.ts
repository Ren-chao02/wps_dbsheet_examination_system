/**
 * 题库读路径的数据范围回归测试（P2）。
 * 锁定：教师可读池 = 自己创建 ∪ 本院系 ∪ 校级(departmentId 为空) ∪ 校级池(sharedToSchool)；
 * 池外题目详情一律 403；创建时默认归属创建者院系（无院系 = 校级 null）。
 *
 * 注：scopeCtxOf 从 req.user 取 departmentId（authenticate 的数据库权威值），
 * 因此下面的 authenticate mock 必须在 req.user 上带 departmentId —— 这是 scope 层的一部分。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ message: '未认证' });
      const userId = (req.headers['x-test-user'] as string) || 'u-1';
      // 默认注入院系 d-1；需要「无院系（校级）」场景时传 x-test-dept: none
      const dept = req.headers['x-test-dept'] as string | undefined;
      req.user = {
        id: userId,
        userId,
        username: userId,
        role,
        permissions: [],
        departmentId: dept === 'none' ? null : (dept ?? 'd-1'),
      };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    question: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { questionRouter } from '../questions';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/questions', questionRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.question.findMany.mockResolvedValue([]);
  mockPrisma.question.count.mockResolvedValue(0);
  mockPrisma.question.findUnique.mockResolvedValue(null);
  mockPrisma.question.create.mockImplementation(async (args: any) => ({ id: 'q-new', ...args.data }));
});

describe('GET /api/questions 列表范围（P2 院系池）', () => {
  it('教师 → AND[0] 为「自己 ∪ 本院系 ∪ 校级 ∪ 校级池」范围条件；count 用同一 where', async () => {
    const res = await request(makeApp())
      .get('/api/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const arg = mockPrisma.question.findMany.mock.calls[0][0];
    expect(arg.where.AND[0]).toEqual({
      OR: [
        { createdBy: 't-1' },
        { departmentId: 'd-1' },
        { departmentId: null },
        { sharedToSchool: true },
      ],
    });
    // count 必须用同一 where，否则分页总数会泄露范围外数量
    expect(mockPrisma.question.count).toHaveBeenCalledWith({ where: arg.where });
  });

  it('search 与范围条件在 AND 里并列（互不覆盖）', async () => {
    const res = await request(makeApp())
      .get('/api/questions?search=员工')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
    const arg = mockPrisma.question.findMany.mock.calls[0][0];
    // 范围条件仍在（AND 而非对象展开，search 占用的 OR 字段不会把范围覆盖掉）
    expect(arg.where.AND[0]).toEqual({
      OR: [
        { createdBy: 't-1' },
        { departmentId: 'd-1' },
        { departmentId: null },
        { sharedToSchool: true },
      ],
    });
    expect(arg.where.AND).toContainEqual({
      OR: [
        { title: { contains: '员工', mode: 'insensitive' } },
        { description: { contains: '员工', mode: 'insensitive' } },
      ],
    });
    expect(mockPrisma.question.count).toHaveBeenCalledWith({ where: arg.where });
  });

  it('无院系教师 → 范围条件不含 departmentId 项（只有自己 ∪ 校级）', async () => {
    const res = await request(makeApp())
      .get('/api/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .set('x-test-dept', 'none');

    expect(res.status).toBe(200);
    const arg = mockPrisma.question.findMany.mock.calls[0][0];
    expect(arg.where.AND[0]).toEqual({
      OR: [{ createdBy: 't-1' }, { departmentId: null }, { sharedToSchool: true }],
    });
  });
});

describe('GET /api/questions/:id 详情范围', () => {
  it('他人院系题目 → 403，文案指明可见范围', async () => {
    mockPrisma.question.findUnique.mockResolvedValue({
      createdBy: 't-9',
      departmentId: 'd-9',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .get('/api/questions/q-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('该题目不在你可见的题库范围内（本院系 / 校级 / 本人）');
  });

  it('校级题目（departmentId 为空）→ 200', async () => {
    mockPrisma.question.findUnique.mockResolvedValue({
      id: 'q-2',
      title: '校级题',
      createdBy: 't-9',
      departmentId: null,
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .get('/api/questions/q-2')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
  });

  it('本院系题目（非本人创建）→ 200', async () => {
    mockPrisma.question.findUnique.mockResolvedValue({
      id: 'q-3',
      title: '院系题',
      createdBy: 't-9',
      departmentId: 'd-1',
      sharedToSchool: false,
    });

    const res = await request(makeApp())
      .get('/api/questions/q-3')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');

    expect(res.status).toBe(200);
  });
});

describe('POST /api/questions 创建默认归属', () => {
  it('默认写入创建者院系', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ title: '新题' });

    expect(res.status).toBe(201);
    const data = mockPrisma.question.create.mock.calls[0][0].data;
    expect(data.departmentId).toBe('d-1');
  });

  it('创建者无院系 → 写 null（校级）', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .set('x-test-dept', 'none')
      .send({ title: '新题' });

    expect(res.status).toBe(201);
    const data = mockPrisma.question.create.mock.calls[0][0].data;
    expect(data.departmentId).toBeNull();
  });
});
