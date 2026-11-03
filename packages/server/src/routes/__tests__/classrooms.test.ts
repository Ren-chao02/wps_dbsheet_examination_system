/**
 * 班级管理：列表范围、搜索、建班、删除守卫、批量分配教师。
 * 通过 vi.mock 替换 auth/prisma，不碰数据库。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    classRoom: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    teacherClass: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    department: { findUnique: vi.fn() },
    major: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
  return { mockPrisma: prisma };
});

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const role = req.headers['x-test-role'] || 'teacher';
    const userId = (req.headers['x-test-user'] as string) || 'u-teacher-1';
    req.user = { id: userId, userId, username: userId, role, permissions: [] };
    next();
  },
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: '权限不足' });
    }
    next();
  },
}));

import { classroomRouter } from '../classrooms';

const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '22222222-2222-4222-8222-222222222222';
const DEPT_ID = '33333333-3333-4333-8333-333333333333';
const MAJOR_ID = '44444444-4444-4444-8444-444444444444';

function classRow(overrides: Record<string, any> = {}) {
  return {
    id: CLASS_ID,
    name: '2026级计算机1班',
    code: 'C20260001',
    academicYear: '2026-2027',
    gradeLevel: 1,
    departmentId: null,
    majorId: null,
    source: 'MANUAL',
    createdAt: new Date('2026-10-23T10:00:00Z'),
    department: null,
    major: null,
    creator: { id: 'admin-1', username: 'admin', realName: '系统管理员' },
    teacherClasses: [{ teacher: { id: TEACHER_ID, username: 'T2026001', realName: '张老师' } }],
    _count: { students: 0, invitations: 0 },
    ...overrides,
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/classrooms', classroomRouter);
  return app;
}

function asAdmin(req: request.Test) {
  return req.set('x-test-role', 'admin').set('x-test-user', 'admin-1');
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  mockPrisma.classRoom.findMany.mockResolvedValue([]);
  mockPrisma.classRoom.count.mockResolvedValue(0);
  mockPrisma.user.count.mockResolvedValue(0);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.teacherClass.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.teacherClass.deleteMany.mockResolvedValue({ count: 0 });
});

describe('GET /api/classrooms', () => {
  it('teacher 列表带任教班级范围', async () => {
    mockPrisma.classRoom.findMany.mockResolvedValue([classRow()]);
    mockPrisma.classRoom.count.mockResolvedValue(1);

    const res = await request(makeApp())
      .get('/api/classrooms')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 'T2026001');

    expect(res.status).toBe(200);
    const where = mockPrisma.classRoom.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({
      teacherClasses: { some: { teacherId: 'T2026001' } },
    });
    expect(res.body.data[0]).toMatchObject({
      name: '2026级计算机1班',
      studentCount: 0,
      teachers: [{ id: TEACHER_ID }],
    });
  });

  it('admin 列表不带范围限制', async () => {
    mockPrisma.classRoom.findMany.mockResolvedValue([]);
    const res = await request(makeApp())
      .get('/api/classrooms')
      .set('x-test-role', 'admin')
      .set('x-test-user', 'admin-1');
    expect(res.status).toBe(200);
    expect(mockPrisma.classRoom.findMany.mock.calls[0][0].where.AND[0]).toEqual({});
  });

  it('搜索同时覆盖班级名称/编码/教师姓名', async () => {
    await request(makeApp())
      .get('/api/classrooms?search=张')
      .set('x-test-role', 'admin');
    const where = mockPrisma.classRoom.findMany.mock.calls[0][0].where;
    const search = where.AND[1].OR;
    expect(search).toEqual(
      expect.arrayContaining([
        { name: { contains: '张', mode: 'insensitive' } },
        { code: { contains: '张', mode: 'insensitive' } },
      ]),
    );
    expect(JSON.stringify(search)).toContain('teacherClasses');
  });

  it('排序白名单生效', async () => {
    await request(makeApp())
      .get('/api/classrooms?sort=name_asc')
      .set('x-test-role', 'admin');
    expect(mockPrisma.classRoom.findMany.mock.calls[0][0].orderBy).toEqual({ name: 'asc' });
  });
});

describe('GET /api/classrooms/options', () => {
  it('返回扁平班级选项并按名称排序', async () => {
    mockPrisma.classRoom.findMany.mockResolvedValue([
      { id: CLASS_ID, name: '2026级计算机1班', code: 'C20260001' },
    ]);
    const res = await request(makeApp())
      .get('/api/classrooms/options')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 'T2026001');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: CLASS_ID, name: '2026级计算机1班', code: 'C20260001' },
    ]);
    expect(mockPrisma.classRoom.findMany.mock.calls[0][0].orderBy).toEqual({ name: 'asc' });
  });
});

describe('POST /api/classrooms', () => {
  it('teacher 建班 403', async () => {
    const res = await request(makeApp())
      .post('/api/classrooms')
      .set('x-test-role', 'teacher')
      .send({ name: '新班', academicYear: '2026-2027' });
    expect(res.status).toBe(403);
    expect(mockPrisma.classRoom.create).not.toHaveBeenCalled();
  });

  it('admin 建班：source=MANUAL、可挂管理教师', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValueOnce(null); // 编码查重
    mockPrisma.classRoom.create.mockResolvedValue({ id: CLASS_ID });
    mockPrisma.user.count.mockResolvedValue(1); // 教师存在
    mockPrisma.classRoom.findUnique.mockResolvedValueOnce(classRow()); // 返回行

    const res = await asAdmin(request(makeApp()).post('/api/classrooms')).send({
      name: '2026级计算机1班',
      code: 'C20260001',
      academicYear: '2026-2027',
      gradeLevel: 1,
      teacherIds: [TEACHER_ID],
    });

    expect(res.status).toBe(201);
    const created = mockPrisma.classRoom.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ source: 'MANUAL', createdBy: 'admin-1' });
    expect(mockPrisma.teacherClass.createMany).toHaveBeenCalled();
  });

  it('不传编码时自动生成', async () => {
    mockPrisma.classRoom.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(classRow({ code: 'C20261023ABCD' }));
    mockPrisma.classRoom.create.mockResolvedValue({ id: CLASS_ID });

    const res = await asAdmin(request(makeApp()).post('/api/classrooms')).send({
      name: '自动编码班',
      academicYear: '2026-2027',
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.classRoom.create.mock.calls[0][0].data.code).toMatch(
      /^C\d{8}[0-9A-F]{4}$/,
    );
  });

  it('编码重复返回 409', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValueOnce({ id: 'other' });
    const res = await asAdmin(request(makeApp()).post('/api/classrooms')).send({
      name: '新班',
      code: 'DUP',
      academicYear: '2026-2027',
    });
    expect(res.status).toBe(409);
  });

  it('院系不存在返回 400', async () => {
    mockPrisma.department.findUnique.mockResolvedValue(null);
    const res = await asAdmin(request(makeApp()).post('/api/classrooms')).send({
      name: '新班',
      academicYear: '2026-2027',
      departmentId: DEPT_ID,
    });
    expect(res.status).toBe(400);
    expect(mockPrisma.classRoom.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/classrooms/:id', () => {
  it('编辑班级名称并返回最新行', async () => {
    mockPrisma.classRoom.findUnique
      .mockResolvedValueOnce({
        id: CLASS_ID,
        code: 'C20260001',
        departmentId: null,
        majorId: null,
      })
      .mockResolvedValueOnce(classRow({ name: '新班级名' }));
    mockPrisma.classRoom.update.mockResolvedValue({});

    const res = await asAdmin(
      request(makeApp()).put(`/api/classrooms/${CLASS_ID}`),
    ).send({ name: '新班级名' });

    expect(res.status).toBe(200);
    expect(mockPrisma.classRoom.update.mock.calls[0][0].data.name).toBe('新班级名');
    expect(res.body.name).toBe('新班级名');
  });
});

describe('POST /api/classrooms/batch-delete', () => {
  it('空班级删除、有学生的班级跳过', async () => {
    const emptyId = '00000000-0000-4000-8000-000000000001';
    const usedId = '00000000-0000-4000-8000-000000000002';
    mockPrisma.classRoom.findUnique
      .mockResolvedValueOnce({
        id: emptyId,
        name: '空班',
        _count: { students: 0, invitations: 0 },
      })
      .mockResolvedValueOnce({
        id: usedId,
        name: '有学生',
        _count: { students: 2, invitations: 0 },
      });
    mockPrisma.classRoom.delete.mockResolvedValue({});

    const res = await asAdmin(
      request(makeApp()).post('/api/classrooms/batch-delete'),
    ).send({ ids: [emptyId, usedId] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual([emptyId]);
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ id: usedId, studentCount: 2 }),
    ]);
  });
});

describe('GET /api/classrooms/teacher-options', () => {
  it('admin 可读取启用教师；teacher 403', async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: TEACHER_ID, username: 'T2026001', realName: '张老师' },
    ]);
    const adminRes = await asAdmin(request(makeApp()).get('/api/classrooms/teacher-options'));
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data).toHaveLength(1);

    const teacherRes = await request(makeApp())
      .get('/api/classrooms/teacher-options')
      .set('x-test-role', 'teacher');
    expect(teacherRes.status).toBe(403);
  });
});

describe('DELETE /api/classrooms/:id', () => {
  it('有学生时拒绝删除', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValue({
      id: CLASS_ID,
      name: '有学生',
      _count: { students: 2, invitations: 0 },
    });
    const res = await asAdmin(request(makeApp()).delete(`/api/classrooms/${CLASS_ID}`));
    expect(res.status).toBe(409);
    expect(mockPrisma.classRoom.delete).not.toHaveBeenCalled();
  });

  it('空班级可删除', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValue({
      id: CLASS_ID,
      name: '空班',
      _count: { students: 0, invitations: 0 },
    });
    mockPrisma.classRoom.delete.mockResolvedValue({});
    const res = await asAdmin(request(makeApp()).delete(`/api/classrooms/${CLASS_ID}`));
    expect(res.status).toBe(200);
    expect(mockPrisma.classRoom.delete).toHaveBeenCalledWith({ where: { id: CLASS_ID } });
  });
});

describe('POST /api/classrooms/batch-teachers', () => {
  it('add 模式保留原有教师', async () => {
    mockPrisma.classRoom.count.mockResolvedValue(1);
    mockPrisma.user.count.mockResolvedValue(1);
    const res = await asAdmin(
      request(makeApp()).post('/api/classrooms/batch-teachers'),
    ).send({ classIds: [CLASS_ID], teacherIds: [TEACHER_ID], mode: 'add' });

    expect(res.status).toBe(200);
    expect(mockPrisma.teacherClass.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.teacherClass.createMany).toHaveBeenCalled();
  });

  it('replace 模式先清空再写入', async () => {
    mockPrisma.classRoom.count.mockResolvedValue(1);
    mockPrisma.user.count.mockResolvedValue(1);
    const res = await asAdmin(
      request(makeApp()).post('/api/classrooms/batch-teachers'),
    ).send({ classIds: [CLASS_ID], teacherIds: [TEACHER_ID], mode: 'replace' });

    expect(res.status).toBe(200);
    expect(mockPrisma.teacherClass.deleteMany).toHaveBeenCalledWith({
      where: { classId: { in: [CLASS_ID] } },
    });
    expect(mockPrisma.teacherClass.createMany).toHaveBeenCalled();
  });

  it('teacher 调用 403', async () => {
    const res = await request(makeApp())
      .post('/api/classrooms/batch-teachers')
      .set('x-test-role', 'teacher')
      .send({ classIds: [CLASS_ID], teacherIds: [TEACHER_ID] });
    expect(res.status).toBe(403);
  });
});
