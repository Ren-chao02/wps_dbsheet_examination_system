/**
 * 断点续做：刷新/换设备后能按 recordId 恢复题目快照。
 * 安全边界：别人的记录一律 404（不泄露存在性）——快照含题面与分值。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      const uid = (req.headers['x-test-user'] as string) || 's-1';
      req.user = { id: uid, userId: uid, username: uid, role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

// vi.mock 的 factory 会被提升到文件顶部执行，引用顶层 const 会踩 TDZ
// （Cannot access 'findFirst' before initialization），故用 vi.hoisted 建桩
// ——与 practice-scenarios.test.ts / practice-start-scenario.test.ts 同款
const { findFirst, questionFindMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  questionFindMany: vi.fn(),
}));
vi.mock('../../config/prisma', () => ({
  prisma: {
    practiceRecord: { findFirst },
    question: { findMany: questionFindMany },
    practiceTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'https://share' }) },
  },
}));

import { practiceRouter } from '../practice';

const app = express();
app.use(express.json());
app.use('/api/practice', practiceRouter);

// 夹具与真实落库形状一致：PracticeRecord.questions 只存开练时冻结的元数据
// （见 /start 的 questionsSnapshot），题面（title/description/type/difficulty/hints）不在快照里，
// 必须回查题库补齐；场景链记录的快照里还冻结着 requires/creates（前置契约与预期产物）
const row = {
  id: 'rec-1', studentId: 's-1', status: 'in_progress', maxScore: 20, startedAt: new Date('2026-10-14T01:00:00Z'),
  submittedAt: null, score: null, passed: null, details: null,
  questions: [
    {
      questionId: 'q1', score: 10, sortOrder: 0, scenarioKey: '员工信息表',
      // requires/creates 属内部快照数据：creates 是答案信息（本题该产出哪些表/字段/视图），
      // 绝不能回发学生。金丝雀表名只写在 creates 里，响应整包 JSON 都不得出现它
      requires: { tables: ['员工信息表'], fields: [], views: [] },
      creates: {
        tables: ['答案考勤表_金丝雀'],
        fields: [{ table: '答案考勤表_金丝雀', field: '打卡时间' }],
        views: [],
      },
    },
  ],
};
const q1Display = {
  id: 'q1', title: '创建员工信息表', description: 'd1', type: 'comprehensive', difficulty: 'easy', hints: null,
};

describe('GET /api/practice/records/:id', () => {
  beforeEach(() => {
    findFirst.mockReset();
    questionFindMany.mockReset();
    questionFindMany.mockResolvedValue([q1Display]);
  });

  it('本人的进行中记录：返回快照 + 题面 + shareUrl', async () => {
    findFirst.mockResolvedValue(row);
    const res = await request(app).get('/api/practice/records/rec-1').set('x-test-user', 's-1');
    expect(res.status).toBe(200);
    expect(res.body.questions[0].questionId).toBe('q1');
    // 题面必须回查题库补齐：快照里没有 title，直接回发快照 = 恢复出一张空白题卡
    expect(res.body.questions[0].title).toBe('创建员工信息表');
    expect(res.body.questions[0].scenarioKey).toBe('员工信息表');
    expect(res.body.shareUrl).toBe('https://share');
    // 查询必须带 studentId 条件（不是拿回来再比）
    expect(findFirst.mock.calls[0][0].where.studentId).toBe('s-1');
  });

  it('别人的记录 → 404（不泄露存在性）', async () => {
    findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/practice/records/rec-1').set('x-test-user', 's-2');
    expect(res.status).toBe(404);
    // 别人的记录连题面回查都不该发生
    expect(questionFindMany).not.toHaveBeenCalled();
  });

  // 安全不变量：题面回查的 select 必须是正向白名单（只给展示字段）。
  // 加回 answerRules/analysis（判分规则 = 答案）时这条必须红
  it('回查题库的字段白名单不含 answerRules/analysis（学生端不能带回答案）', async () => {
    findFirst.mockResolvedValue(row);
    const res = await request(app).get('/api/practice/records/rec-1');
    expect(res.status).toBe(200);
    const select = questionFindMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('answerRules');
    expect(select).not.toHaveProperty('analysis');
  });

  // 安全不变量（与考试侧 toStudentQuestion 同一口径）：快照里冻结着 requires/creates，
  // creates 属答案信息——恢复接口必须逐字段挑拣回发，绝不能把整个快照 `...s` 甩出去。
  // 把 hydrateQuestionSnapshots 的挑拣改回 `...s` 时这条必须变红
  it('回发题面时裁掉 requires/creates（金丝雀表名不得出现在响应里）', async () => {
    findFirst.mockResolvedValue(row);
    const res = await request(app).get('/api/practice/records/rec-1');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // ① 场景链续做标注要留着（同场景多题时前端据此提示"接着做"）
    expect(res.body.questions[0].scenarioKey).toBe('员工信息表');
    // ② 契约字段名整包不得出现
    expect(body).not.toContain('creates');
    expect(body).not.toContain('requires');
    // ③ 金丝雀（只写在 creates 里的表名）也不得出现
    expect(body).not.toContain('答案考勤表_金丝雀');
  });

  // 简报只覆盖 in_progress；判分结果的回发分支（前端"直接进结果态"依赖）单独钉住
  it('已判分的记录：带 score/passed/details，前端可直接进结果态', async () => {
    findFirst.mockResolvedValue({
      ...row,
      status: 'graded',
      score: 10,
      passed: true,
      details: [{ questionId: 'q1', questionTitle: '创建员工信息表', score: 10, maxScore: 10, isCorrect: true }],
    });
    const res = await request(app).get('/api/practice/records/rec-1');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('graded');
    expect(res.body.score).toBe(10);
    expect(res.body.passed).toBe(true);
    expect(res.body.details[0].questionId).toBe('q1');
  });

  // 题目可被硬删除（questions.ts 的 DELETE 不查练习记录）：恢复接口不能因此整条失败
  it('题目已被从题库删除：不 500，回发快照并标注已下线', async () => {
    findFirst.mockResolvedValue(row);
    questionFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/practice/records/rec-1');
    expect(res.status).toBe(200);
    expect(res.body.questions[0].questionId).toBe('q1');
    expect(res.body.questions[0].score).toBe(10);
    expect(res.body.questions[0].title).toContain('已从题库删除');
  });
});
