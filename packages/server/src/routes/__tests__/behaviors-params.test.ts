/**
 * behaviors 端点硬化回归测试（P2 Task 11）：
 * - 报告/审核端点 :examId / :studentId 非 UUID → 干净 400（不再漏到 Prisma 报 500）
 * - POST /record：学生的 examId 必须对该生可见（studentExamVisibilityOR 口径），否则 403
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
      req.user = { id: userId, userId, username: userId, role, permissions: [] };
      next();
    },
  };
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    studentBehaviorLog: { create: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    behaviorAnalysisReport: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    exam: { findUnique: vi.fn(), findFirst: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { behaviorRouter } from '../behaviors';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviors', behaviorRouter);
  return app;
}

const EXAM_ID = '11111111-1111-4111-8111-111111111111';
const STUDENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_STUDENT_ID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.studentBehaviorLog.findMany.mockResolvedValue([]);
  mockPrisma.studentBehaviorLog.count.mockResolvedValue(0);
  mockPrisma.studentBehaviorLog.groupBy.mockResolvedValue([]);
  mockPrisma.behaviorAnalysisReport.findMany.mockResolvedValue([]);
  mockPrisma.behaviorAnalysisReport.upsert.mockResolvedValue({});
  mockPrisma.studentBehaviorLog.create.mockResolvedValue({ id: 'log-1' });
});

describe('报告/审核端点路径参数 UUID 校验', () => {
  it('GET /reports/:examId 非 UUID → 400 且不触库', async () => {
    const res = await request(makeApp())
      .get('/api/behaviors/reports/exam-1')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('参数格式错误');
    expect(mockPrisma.exam.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.behaviorAnalysisReport.findMany).not.toHaveBeenCalled();
  });

  it('GET /reports/:examId/:studentId studentId 非 UUID → 400 且不触库', async () => {
    const res = await request(makeApp())
      .get(`/api/behaviors/reports/${EXAM_ID}/s-1`)
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('参数格式错误');
    expect(mockPrisma.exam.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.behaviorAnalysisReport.findUnique).not.toHaveBeenCalled();
  });

  it('PUT /reports/:examId/:studentId/review 非 UUID → 400 且不改库', async () => {
    const res = await request(makeApp())
      .put('/api/behaviors/reports/exam-1/s-1/review')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ conclusion: '正常' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('参数格式错误');
    expect(mockPrisma.behaviorAnalysisReport.update).not.toHaveBeenCalled();
  });

  it('合法 UUID 不被误伤：归属通过后照常返回', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
    const res = await request(makeApp())
      .get(`/api/behaviors/reports/${EXAM_ID}`)
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    expect(mockPrisma.behaviorAnalysisReport.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/behaviors/record 归属校验', () => {
  const BODY = {
    examId: EXAM_ID,
    studentId: STUDENT_ID,
    behaviorType: 'TAB_SWITCH',
    metadata: { tabSwitch: { count: 1 } },
  };

  it('学生写自己可见的考试 → 201，且可见性用 studentExamVisibilityOR 口径', async () => {
    mockPrisma.exam.findFirst.mockResolvedValue({ id: EXAM_ID });
    const res = await request(makeApp())
      .post('/api/behaviors/record')
      .set('x-test-role', 'student')
      .set('x-test-user', STUDENT_ID)
      .send(BODY);
    expect(res.status).toBe(201);

    const where = mockPrisma.exam.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe(EXAM_ID);
    expect(where.OR).toEqual([
      { assignments: { some: { students: { some: { studentId: STUDENT_ID } } } } },
      { tableAssignments: { some: { studentId: STUDENT_ID } } },
      { submissions: { some: { studentId: STUDENT_ID } } },
    ]);
    expect(mockPrisma.studentBehaviorLog.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.studentBehaviorLog.create.mock.calls[0][0].data.examId).toBe(EXAM_ID);
  });

  it('学生写未分配给自己的考试 → 403 且不落库', async () => {
    mockPrisma.exam.findFirst.mockResolvedValue(null);
    const res = await request(makeApp())
      .post('/api/behaviors/record')
      .set('x-test-role', 'student')
      .set('x-test-user', STUDENT_ID)
      .send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('该考试不在你的作答范围内');
    expect(mockPrisma.studentBehaviorLog.create).not.toHaveBeenCalled();
  });

  it('学生冒名上报（studentId 非本人）→ 403（既有防伪造校验保持不动）', async () => {
    const res = await request(makeApp())
      .post('/api/behaviors/record')
      .set('x-test-role', 'student')
      .set('x-test-user', OTHER_STUDENT_ID)
      .send(BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('只能上报本人的行为记录');
    // 本人校验先于归属校验，不应触发可见性查询
    expect(mockPrisma.exam.findFirst).not.toHaveBeenCalled();
  });

  it('教师代报不查可见性（保留监考补录能力）→ 201', async () => {
    const res = await request(makeApp())
      .post('/api/behaviors/record')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send(BODY);
    expect(res.status).toBe(201);
    expect(mockPrisma.exam.findFirst).not.toHaveBeenCalled();
  });
});
