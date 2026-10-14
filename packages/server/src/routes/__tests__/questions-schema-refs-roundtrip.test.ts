/**
 * 题目保存链路的往返回归：schemaRefs 的 requires/creates 必须原样落库，
 * 场景链字段（scenario/scenarioOrder）必须可写、且字段缺席时不被清空。
 *
 * 背景（实测踩过）：questionSchema 对未声明的键默认 strip ——
 * 1) schemaRefs 原来只声明 `{tables, fields}`，推导/回填得来的 requires/creates 被静默丢弃；
 *    后果不只是"新卡片存不进去"：教师任何一次编辑保存，都会把回填进库的前置契约抹掉。
 * 2) scenario/scenarioOrder 直到本次终审才补声明：唯一写者是回填脚本，教师改不了链名/序号，
 *    待人工确认的题永远进不了链、新题静默落在所有链外。
 *
 * 这些用例钉住"声明在 zod 里、映射带上它们"：谁把字段从 zod 里删掉，必须变红。
 * schemaRefs 只测 POST（PUT 走同一个 questionSchema）；scenario 额外单测 PUT，
 * 因为 PUT 有"缺席不清空"的独立语义（映射写错就会静默摘链）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'u-teacher-1', userId: 'u-teacher-1', username: 'teacher1', role: 'teacher', departmentId: 'd-1' };
    next();
  },
  authorize: () => (_req: any, _res: any, next: any) => next(),
}));

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    question: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    examQuestion: { findFirst: vi.fn() },
  };
  return { mockPrisma: prisma };
});

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { questionRouter } from '../questions';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/questions', questionRouter);
  return app;
}

/** 推导器 / 回填脚本的真实产物形状（engine/prerequisite-deriver.derivePrerequisites） */
const fullSchemaRefs = {
  requires: {
    tables: ['员工信息表'],
    fields: [],
    views: [{ table: '员工信息表', view: '员工总览' }],
  },
  creates: {
    tables: [],
    fields: [{ table: '员工信息表', field: '打卡时间' }],
    views: [],
  },
  tables: ['员工信息表'],
  fields: ['打卡时间'],
};

describe('POST /api/questions — schemaRefs 往返', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 回显落库数据，让响应体也带上 schemaRefs（断言只看 create 的入参）
    mockPrisma.question.create.mockImplementation(async (args: any) => ({ id: 'q-1', ...args.data }));
  });

  it('完整形状三组俱在：requires.views / creates.fields 的嵌套形状逐字段核对', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .send({
        title: '创建时间字段并区分与日期字段的差异',
        description: '在「员工信息表」中创建「打卡时间」字段。',
        type: 'add_field',
        schemaRefs: fullSchemaRefs,
      });

    expect(res.status).toBe(201);
    const { data } = mockPrisma.question.create.mock.calls[0][0];

    expect(data.schemaRefs).toEqual(fullSchemaRefs);
    // 再分开断言一遍嵌套形状：对"只声明了顶层 tables/fields"的漏声明，这两条会先红，
    // 报错信息也更直白（toEqual 整体比较时看不出是哪一组被 strip 了）
    expect(data.schemaRefs.requires).toEqual({
      tables: ['员工信息表'],
      fields: [],
      views: [{ table: '员工信息表', view: '员工总览' }],
    });
    expect(data.schemaRefs.creates.fields).toEqual([{ table: '员工信息表', field: '打卡时间' }]);
  });

  it('旧形状（只有顶层两串）按原样落库 —— 存量旧题重存不能丢或改形', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .send({ title: '旧题', schemaRefs: { tables: ['学生档案'], fields: ['姓名'] } });

    expect(res.status).toBe(201);
    expect(mockPrisma.question.create.mock.calls[0][0].data.schemaRefs)
      .toEqual({ tables: ['学生档案'], fields: ['姓名'] });
  });

  it('嵌套形状写错（requires.fields 传字符串）→ 400 且不落库，不静默吞', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .send({ title: '脏形状', schemaRefs: { requires: { fields: ['姓名'] } } });

    expect(res.status).toBe(400);
    expect(mockPrisma.question.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/questions — 场景链字段（scenario/scenarioOrder）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.question.create.mockImplementation(async (args: any) => ({ id: 'q-1', ...args.data }));
  });

  it('scenario/scenarioOrder 原样落库（zod 漏声明会被 strip，这条必须变红）', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .send({ title: '场景题', scenario: '员工信息表', scenarioOrder: 3 });

    expect(res.status).toBe(201);
    const { data } = mockPrisma.question.create.mock.calls[0][0];
    expect(data.scenario).toBe('员工信息表');
    expect(data.scenarioOrder).toBe(3);
  });

  it('未传场景字段：写 undefined（Prisma 视为不动，建新题走列默认 null），不是空串/0', async () => {
    const res = await request(makeApp()).post('/api/questions').send({ title: '普通题' });
    expect(res.status).toBe(201);
    const { data } = mockPrisma.question.create.mock.calls[0][0];
    expect(data.scenario).toBeUndefined();
    expect(data.scenarioOrder).toBeUndefined();
  });

  it('显式传 null：落库 null（拆链语义）', async () => {
    const res = await request(makeApp())
      .post('/api/questions')
      .send({ title: '拆链题', scenario: null, scenarioOrder: null });
    expect(res.status).toBe(201);
    const { data } = mockPrisma.question.create.mock.calls[0][0];
    expect(data.scenario).toBeNull();
    expect(data.scenarioOrder).toBeNull();
  });
});

describe('PUT /api/questions/:id — 场景链字段缺席不清空', () => {
  const existing = {
    id: 'q-1', createdBy: 'u-teacher-1', type: 'add_field',
    answerRules: [], objectiveAnswer: null, scenario: '员工信息表', scenarioOrder: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.examQuestion.findFirst.mockResolvedValue(null); // 无进行中考试锁定
    mockPrisma.question.findUnique.mockResolvedValue(existing);
    mockPrisma.question.update.mockImplementation(async (args: any) => ({ id: 'q-1', ...args.data }));
  });

  it('未回传场景字段：update 里是 undefined（不动原值），不是 null（清空）', async () => {
    const res = await request(makeApp()).put('/api/questions/q-1').send({ title: '只改标题' });
    expect(res.status).toBe(200);
    const { data } = mockPrisma.question.update.mock.calls[0][0];
    // 旧版编辑器不回传这两个字段：映射一旦写成 `?? null`，教师每次保存都会把题静默摘出场景链
    expect(data.scenario).toBeUndefined();
    expect(data.scenarioOrder).toBeUndefined();
  });

  it('显式回传：null 能清空（拆链），新值能改（教师真正的写入路径）', async () => {
    let res = await request(makeApp())
      .put('/api/questions/q-1')
      .send({ title: '拆链', scenario: null, scenarioOrder: null });
    expect(res.status).toBe(200);
    let data = mockPrisma.question.update.mock.calls[0][0].data;
    expect(data.scenario).toBeNull();
    expect(data.scenarioOrder).toBeNull();

    res = await request(makeApp())
      .put('/api/questions/q-1')
      .send({ title: '改链名与序号', scenario: '考勤管理', scenarioOrder: 7 });
    expect(res.status).toBe(200);
    data = mockPrisma.question.update.mock.calls[1][0].data;
    expect(data.scenario).toBe('考勤管理');
    expect(data.scenarioOrder).toBe(7);
  });
});
