/**
 * 考试链路安全与状态机回归测试
 *
 * 覆盖 2026-10-11 安全修复中「最容易被改回去」的几条：
 * - 学生不能读到判分规则（answerRules）—— 题目下发必须走 toStudentQuestion 裁剪
 * - 学生不能访问未被分配的考试（/my-exams/:id 的可见性校验）
 * - 交卷状态机：grading 视为已交卷、条件更新防止覆盖、重复提交 400
 * - 题库接口对学生关闭
 * - 行为报告接口需要鉴权
 *
 * authenticate/authorize 被替换为「按 x-test-role 注入用户」，authorize 用真实实现。
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
      req.user = { id: 'stu-1', userId: 'stu-1', username: 'stu-1', role, permissions: [] };
      next();
    },
  };
});

vi.mock('../../services/wps-config-service', () => ({
  wpsConfigService: { get: vi.fn().mockResolvedValue(null), getValidAccessToken: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../services/wps-table-service', () => ({
  loadTablePreview: vi.fn(),
}));

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    exam: { findUnique: vi.fn(), findFirst: vi.fn() },
    studentSubmission: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    examQuestion: { findMany: vi.fn() },
    examTableAssignment: { findUnique: vi.fn() },
    examRoomStudent: { findFirst: vi.fn() },
    examSession: { findFirst: vi.fn(), create: vi.fn() },
    studentBehaviorLog: { create: vi.fn() },
    behaviorAnalysisReport: { update: vi.fn(), findMany: vi.fn() },
    question: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockPrisma: prisma };
});
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { myExamRouter } from '../my-exams';
import { questionRouter } from '../questions';
import { behaviorRouter } from '../behaviors';

function makeApp(router: express.Router, base: string) {
  const app = express();
  app.use(express.json());
  app.use(base, router);
  return app;
}

const EXAM = {
  id: 'exam-1',
  title: '测试考试',
  mode: 'exam',
  durationMinutes: 60,
  startTime: null,
  endTime: null,
  totalScore: 100,
  passScore: 60,
  status: 'published',
  settings: {},
  creator: { realName: '张老师' },
  batch: { name: '批次', examMode: 'unified', startTime: null, endTime: null },
};

/** 判分规则是「标准答案」，绝不能出现在学生可见的题目里 */
const QUESTION_WITH_RULES = {
  id: 'q-1',
  title: '创建员工信息表',
  description: '在左侧创建数据表',
  type: 'create_table',
  difficulty: 'easy',
  score: 10,
  hints: null,
  tags: [],
  answerRules: [{ id: 'r1', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 100 }],
  analysis: '本题考察建表操作',
  primaryCategoryId: null,
  secondaryCategoryId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.exam.findUnique.mockResolvedValue(EXAM);
  mockPrisma.exam.findFirst.mockResolvedValue({ id: 'exam-1' });
  mockPrisma.studentSubmission.findUnique.mockResolvedValue(null);
  mockPrisma.examQuestion.findMany.mockResolvedValue([
    { question: QUESTION_WITH_RULES, scoreOverride: null, sortOrder: 0 },
  ]);
  mockPrisma.examTableAssignment.findUnique.mockResolvedValue({ shareUrl: null, fileId: 'f1' });
});

describe('学生视角的题目下发（答案防泄露）', () => {
  it('GET /my-exams/:id 不下发 answerRules 与 analysis', async () => {
    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .get('/api/my-exams/exam-1')
      .set('x-test-role', 'student');

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    const q = res.body.questions[0];
    expect(q.title).toBe('创建员工信息表');
    expect(q.answerRules).toBeUndefined();
    expect(q.analysis).toBeUndefined();
  });

  it('未被分配到该考试的学生 → 403（防止用考试 ID 越权读题）', async () => {
    mockPrisma.exam.findFirst.mockResolvedValue(null); // 可见性校验不通过
    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .get('/api/my-exams/exam-1')
      .set('x-test-role', 'student');
    expect(res.status).toBe(403);
  });

  it('随到随考按每人 startedAt 计算截止时间并下发 deadline', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({
      ...EXAM,
      batch: { name: '批次', examMode: 'flexible', startTime: null, endTime: new Date(Date.now() + 3 * 3600_000), examDuration: 60 },
    });
    // 10 分钟前开考：个人截止时间 = 开考 + 60 分钟，且仍在批次窗口（3 小时后结束）之内
    const startedAt = new Date(Date.now() - 10 * 60 * 1000);
    mockPrisma.studentSubmission.findUnique.mockResolvedValue({
      id: 'sub-1', status: 'in_progress', startedAt, submittedAt: null, details: [],
    });

    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .get('/api/my-exams/exam-1')
      .set('x-test-role', 'student');

    expect(res.status).toBe(200);
    expect(res.body.deadline).toBe(startedAt.getTime() + 60 * 60 * 1000);
  });

  it('随到随考：个人截止时间不越过批次结束时刻', async () => {
    // 批次 5 分钟后结束，但学生已开考 10 分钟（个人到点还有 50 分钟）→ 取批次结束
    const batchEnd = new Date(Date.now() + 5 * 60 * 1000);
    mockPrisma.exam.findUnique.mockResolvedValue({
      ...EXAM,
      batch: { name: '批次', examMode: 'flexible', startTime: null, endTime: batchEnd, examDuration: 60 },
    });
    mockPrisma.studentSubmission.findUnique.mockResolvedValue({
      id: 'sub-1',
      status: 'in_progress',
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      submittedAt: null,
      details: [],
    });

    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .get('/api/my-exams/exam-1')
      .set('x-test-role', 'student');

    expect(res.status).toBe(200);
    expect(res.body.deadline).toBe(batchEnd.getTime());
  });
});

describe('交卷状态机', () => {
  it('grading（教师复核中）视为已交卷，不允许再提交', async () => {
    mockPrisma.studentSubmission.findUnique.mockResolvedValue({ id: 'sub-1', status: 'grading' });
    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .post('/api/my-exams/exam-1/submit')
      .set('x-test-role', 'student');
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('已提交');
    expect(mockPrisma.studentSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('条件更新未命中（并发下已被收卷）时返回已提交，而不是覆盖状态', async () => {
    mockPrisma.studentSubmission.findUnique.mockResolvedValue({ id: 'sub-1', status: 'in_progress' });
    mockPrisma.studentSubmission.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .post('/api/my-exams/exam-1/submit')
      .set('x-test-role', 'student');

    expect(res.status).toBe(400);
    // 关键：用带 status 谓词的条件更新，而不是无条件 update
    expect(mockPrisma.studentSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'in_progress' }) }),
    );
  });

  it('正常交卷走条件更新并返回最新答卷', async () => {
    mockPrisma.studentSubmission.findUnique
      .mockResolvedValueOnce({ id: 'sub-1', status: 'in_progress' })
      .mockResolvedValueOnce({ id: 'sub-1', status: 'submitted' });
    mockPrisma.studentSubmission.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(makeApp(myExamRouter, '/api/my-exams'))
      .post('/api/my-exams/exam-1/submit')
      .set('x-test-role', 'student');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
  });
});

describe('题库与行为报告的访问控制', () => {
  it('学生访问题库接口 → 403', async () => {
    const res = await request(makeApp(questionRouter, '/api/questions'))
      .get('/api/questions')
      .set('x-test-role', 'student');
    expect(res.status).toBe(403);
    expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
  });

  it('教师访问题库接口 → 放行', async () => {
    mockPrisma.question.findMany.mockResolvedValue([]);
    const app = express();
    app.use(express.json());
    app.use('/api/questions', questionRouter);
    const res = await request(app).get('/api/questions').set('x-test-role', 'teacher');
    // 该接口自身还依赖 count 等查询，这里只断言「不是 401/403」
    expect([200, 500]).toContain(res.status);
  });

  it('行为报告接口：匿名 → 401，学生 → 403', async () => {
    const app = makeApp(behaviorRouter, '/api/behaviors');
    expect((await request(app).get('/api/behaviors/reports/exam-1')).status).toBe(401);
    expect((await request(app).get('/api/behaviors/reports/exam-1').set('x-test-role', 'student')).status).toBe(403);
  });
});
