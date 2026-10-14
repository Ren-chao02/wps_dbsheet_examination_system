/**
 * 安全边界回归：学生下发里可以有 requires（前置提示用），
 * 但 answerRules（判分规则）、analysis（解析）、creates（预期产物）一律不得出现 —— 那是答案。
 *
 * 若这条测试红了：先怀疑 toStudentQuestion 里有人把整个 schemaRefs（而不是仅 requires）
 * spread 到了下发对象上。
 */
import { describe, it, expect, vi } from 'vitest';
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

// 外部服务一律 mock：单测不连 DB、不发网络（手法与 objective-exam.test.ts 一致）
vi.mock('../../services/wps-config-service', () => ({
  wpsConfigService: { get: vi.fn().mockResolvedValue(null), getValidAccessToken: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../../services/wps-table-service', () => ({ loadTablePreview: vi.fn() }));
vi.mock('../../services/paper-generator', () => ({ generateStudentPaper: vi.fn() }));

const { mockPrisma, questionRow } = vi.hoisted(() => {
  // 注意 description 里**不出现**「打卡时间」：它是答案侧（creates/answerRules）独有的字段名，
  // 当泄露金丝雀用 —— 下发里只要出现这个词，就说明答案侧的信息被带出去了。
  const questionRow = {
    id: 'q-1',
    title: '创建时间字段',
    description: '在「员工信息表」中新建一个时间字段',
    type: 'comprehensive',
    difficulty: 'medium',
    score: 10,
    hints: null,
    tags: [],
    primaryCategoryId: null,
    secondaryCategoryId: null,
    objectiveAnswer: null,
    answerRules: [{ id: 'r1', action: 'check_field', params: { tableName: '员工信息表', fieldName: '打卡时间' }, score: 100 }],
    analysis: '标准答案是……',
    schemaRefs: {
      requires: { tables: ['员工信息表'], fields: [{ table: '员工信息表', field: '姓名' }], views: [] },
      creates: { tables: ['统计表'], fields: [{ table: '员工信息表', field: '打卡时间' }], views: [] },
      // 生产里 tables = requires ∪ creates（推导器去重并集）：夹具必须复现这个形状，
      // 否则「toStudentQuestion 误读 schemaRefs.tables」的回归测不出来 —— 那会把
      // 应当由学生创建的表名当提示发出去，等于漏答案。
      tables: ['员工信息表', '统计表'],
      fields: ['姓名', '打卡时间'],
    },
    sortOrder: 0,
  };
  const prisma: any = {
    exam: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'e-1', title: '实操考试', mode: 'unified', durationMinutes: 60,
        startTime: null, endTime: null, status: 'in_progress',
        settings: {}, batch: null,
      }),
      // 可见性校验（studentExamVisibilityOR）：本考试对该生可见
      findFirst: vi.fn().mockResolvedValue({ id: 'e-1' }),
    },
    studentSubmission: {
      findUnique: vi.fn().mockResolvedValue({ id: 'sub-1', status: 'in_progress', startedAt: null, details: [] }),
    },
    studentExamQuestion: {
      findMany: vi.fn().mockResolvedValue([{ questionId: 'q-1', sortOrder: 0, score: 10, question: questionRow }]),
    },
    examQuestion: { findMany: vi.fn().mockResolvedValue([]) },
    examTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'https://x', accessToken: null }) },
  };
  return { mockPrisma: prisma, questionRow };
});

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { myExamRouter } from '../my-exams';

const app = express();
app.use(express.json());
app.use('/api/my-exams', myExamRouter);

describe('学生题目下发的前置契约', () => {
  it('下发 requires（题目需要什么），且绝不泄露 answerRules / analysis / creates（答案）', async () => {
    const res = await request(app).get('/api/my-exams/e-1');
    expect(res.status).toBe(200);

    // 取法贴合 /api/my-exams/:id 的真实返回：题目在 body.questions 上
    const q = res.body.questions?.[0];
    expect(q).toBeTruthy();
    // 只含 requires：统计表只存在于 creates，出现在这里 = 误读 schemaRefs.tables（漏答案）
    expect(q.requires.tables).toEqual(['员工信息表']);
    expect(q.requires).toEqual({
      tables: ['员工信息表'],
      fields: [{ table: '员工信息表', field: '姓名' }],
      views: [],
    });

    // ── 三条安全断言（改这条测试时不许删） ──────────────────────────────
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('answerRules');   // 判分规则
    expect(body).not.toContain('标准答案是');     // analysis 解析
    expect(body).not.toContain('打卡时间');       // creates / answerRules 独有的字段名（泄露金丝雀）
    expect(body).not.toContain('统计表');         // 只存在于 creates 的表名（同金丝雀）
    expect(q.creates).toBeUndefined();
    expect(q.answerRules).toBeUndefined();
    expect(q.analysis).toBeUndefined();
  });

  it('无前置要求时不下发 requires 字段（哪怕 schemaRefs.tables 非空——那是 creates 侧）', async () => {
    // 场景：本题只"创建"统计表、不需要任何已存在的结构。若实现误读 schemaRefs.tables，
    // 就会给学生发出一条"先建「统计表」"的错误指令——这里必须保持不发。
    mockPrisma.studentExamQuestion.findMany.mockResolvedValueOnce([
      {
        questionId: 'q-1', sortOrder: 0, score: 10,
        question: {
          ...questionRow,
          schemaRefs: {
            requires: { tables: [], fields: [], views: [] },
            creates: { tables: ['统计表'], fields: [], views: [] },
            tables: ['统计表'],
            fields: [],
          },
        },
      },
    ]);
    const res = await request(app).get('/api/my-exams/e-1');
    expect(res.status).toBe(200);
    expect(res.body.questions[0].requires).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('统计表');
  });
});
