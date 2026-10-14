/**
 * 题目保存链路的往返回归：schemaRefs 的 requires/creates 必须原样落库。
 *
 * 背景（实测踩过）：questionSchema.schemaRefs 原来只声明 `{tables, fields}`，
 * zod 对未声明的键默认 strip —— 推导/回填得来的 requires/creates 在 POST/PUT 时被静默丢弃。
 * 后果不只是"新卡片存不进去"：教师任何一次编辑保存，都会把回填进库的前置契约抹掉
 * （学生提示条、练习成链、组卷的 fixed 题位继承会一起失效，且没有任何报错）。
 *
 * 这条用例钉住"三组俱在"：将来谁把 requires/creates 从 zod 里删掉，它必须变红。
 * PUT 走的是同一个 questionSchema（无独立 schema），所以这里只测 POST 一条即可覆盖两者。
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
  const prisma: any = { question: { create: vi.fn() } };
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
