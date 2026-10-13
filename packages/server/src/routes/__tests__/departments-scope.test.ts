/**
 * 院系树按角色裁剪回归测试（P1）：教师只看到自己任教班级所在的院系/专业/班级。
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
    teacherClass: { findMany: vi.fn() },
    department: { findMany: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import { departmentRouter } from '../departments';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/departments', departmentRouter);
  return app;
}

const FULL_TREE = [
  {
    id: 'd-1', name: '计算机学院', majors: [
      { id: 'm-1', name: '软件', classRooms: [{ id: 'c-1', name: '软工1班', _count: { students: 30 } }, { id: 'c-9', name: '软工9班', _count: { students: 20 } }] },
    ],
    _count: { users: 100 },
  },
  {
    id: 'd-2', name: '经管学院', majors: [
      { id: 'm-2', name: '会计', classRooms: [{ id: 'c-2', name: '会计1班', _count: { students: 40 } }] },
    ],
    _count: { users: 80 },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: 'c-1' }]);
  mockPrisma.department.findMany.mockResolvedValue(FULL_TREE);
});

describe('GET /api/departments', () => {
  it('教师 → 只保留任教班级所在的院系/专业/班级', async () => {
    const res = await request(makeApp())
      .get('/api/departments')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('d-1');
    expect(data[0].majors).toHaveLength(1);
    expect(data[0].majors[0].classRooms.map((c: any) => c.id)).toEqual(['c-1']);
  });

  it('admin → 全量树不变', async () => {
    const res = await request(makeApp()).get('/api/departments').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  // 空节点剪枝必须只对教师生效：admin 新建的院系/专业若被剪掉，
  // 管理端「新建院系 → 右侧加专业」的下一步就选不中节点，流程断掉
  const TREE_WITH_EMPTY_NODES = [
    {
      id: 'd-1', name: '计算机学院', majors: [
        { id: 'm-1', name: '软件', classRooms: [{ id: 'c-1', name: '软工1班', _count: { students: 30 } }] },
        { id: 'm-3', name: '新专业', classRooms: [] },
      ],
      _count: { users: 100 },
    },
    {
      id: 'd-3', name: '新建院系', majors: [],
      _count: { users: 0 },
    },
  ];

  it('admin → 保留空节点（无专业的院系、无班级的专业）', async () => {
    mockPrisma.department.findMany.mockResolvedValue(TREE_WITH_EMPTY_NODES);
    const res = await request(makeApp()).get('/api/departments').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveLength(2);
    // 尚无专业的院系仍在树里
    const emptyDept = data.find((d: any) => d.id === 'd-3');
    expect(emptyDept).toBeDefined();
    expect(emptyDept.majors).toEqual([]);
    // 尚无班级的专业仍在树里
    const dept = data.find((d: any) => d.id === 'd-1');
    expect(dept.majors).toHaveLength(2);
    const emptyMajor = dept.majors.find((m: any) => m.id === 'm-3');
    expect(emptyMajor).toBeDefined();
    expect(emptyMajor.classRooms).toEqual([]);
    // 非空链路不受影响
    expect(dept.majors.find((m: any) => m.id === 'm-1').classRooms.map((c: any) => c.id)).toEqual(['c-1']);
  });

  it('教师 → 空节点仍被剪掉，任教班级链路完整', async () => {
    mockPrisma.department.findMany.mockResolvedValue(TREE_WITH_EMPTY_NODES);
    const res = await request(makeApp())
      .get('/api/departments')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const data = res.body.data;
    // 无专业的新建院系、无班级的新专业都不出现
    expect(data.map((d: any) => d.id)).toEqual(['d-1']);
    expect(data[0].majors.map((m: any) => m.id)).toEqual(['m-1']);
    expect(data[0].majors[0].classRooms.map((c: any) => c.id)).toEqual(['c-1']);
  });
});
