/**
 * 前置契约推导接口的回归测试。
 *
 * 三条口径：
 * 1. 只做纯推导，不查库、不联网（教师点一次按钮就出结果）；
 * 2. 学生角色不可访问（路由挂 authorize('teacher','admin')）；
 * 3. 参数非法（空 rules / 缺 action）返回 400，不是 500。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ message: '未认证' });
      req.user = { id: 'u-1', userId: 'u-1', username: 'u-1', role, permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});
vi.mock('../../config/prisma', () => ({ prisma: {} }));

import { questionRouter } from '../questions';

const app = express();
app.use(express.json());
app.use('/api/questions', questionRouter);

describe('POST /api/questions/derive-refs', () => {
  it('从建表规则推出 creates，从字段规则推出 requires', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({
        rules: [
          { id: 'r1', action: 'check_field', params: { tableName: '员工信息表', fieldName: '打卡时间' }, score: 100 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.refs.requires.tables).toEqual(['员工信息表']);
    expect(res.body.refs.creates.fields).toEqual([{ table: '员工信息表', field: '打卡时间' }]);
    expect(res.body.unresolved).toEqual([]);
  });

  it('未实现的 action 在 unresolved 里点名，不报错', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({ rules: [{ action: 'verify_dashboard_chart', params: {} }] });
    expect(res.status).toBe(200);
    expect(res.body.unresolved).toEqual(['verify_dashboard_chart']);
  });

  it('学生角色 403', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'student')
      .send({ rules: [{ action: 'check_table_exists', params: { tableName: 'X' } }] });
    expect(res.status).toBe(403);
  });

  it('空 rules → 400', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({ rules: [] });
    expect(res.status).toBe(400);
  });

  it('题面带创建语义且点名了表 → check_table_exists 落 creates', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({
        // 表名只出现在 description 里：这条同时证明 description 被透传给了推导器
        title: '创建单向关联字段连接两个数据表',
        description: "创建两个数据表：'项目表'和'任务表'。",
        rules: [
          { id: 'r1', action: 'check_table_exists', params: { tableName: '项目表' }, score: 50 },
          { id: 'r2', action: 'check_table_exists', params: { tableName: '任务表' }, score: 50 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.refs.creates.tables).toEqual(['任务表', '项目表']);   // 码点序：任 U+4EFB < 项 U+9879
    expect(res.body.refs.requires.tables).toEqual([]);
  });

  it('题面没有创建语义（前置检查）→ check_table_exists 落 requires', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({
        title: '设置关联字段允许多条记录关联',
        rules: [
          { id: 'r1', action: 'check_table_exists', params: { tableName: '任务表' }, score: 50 },
          { id: 'r2', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 50 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.refs.creates.tables).toEqual([]);
    expect(res.body.refs.requires.tables).toEqual(['任务表', '员工信息表']);   // 码点序：任 U+4EFB < 员 U+5458
  });
});
