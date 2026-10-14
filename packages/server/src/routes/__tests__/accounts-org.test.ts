/**
 * 账号管理组织字段（院系）回归测试（P2 Task 9 + Task 10）。
 * Task 9：POST/PUT /api/accounts 接受 departmentId（uuid 可空）；
 * 非空时写库前先校验院系存在；update 允许传 null 清空、不传则不碰该字段。
 * Task 10：导入模板第 6 列为「院系编码」（可选），导入按 Department.code 一次预加载匹配，
 * 编码不存在的行只标记该行错误，不整份失败。
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

const { mockPrisma, mockSheet, excelMock, mockWorkbooks } = vi.hoisted(() => ({
  mockPrisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    systemRole: { findUnique: vi.fn(), findMany: vi.fn() },
    department: { findUnique: vi.fn(), findMany: vi.fn() },
    importTask: { create: vi.fn(), update: vi.fn() },
  } as any,
  // 伪 sheet 数据：rows 为数据行（不含表头），列序与导入模板一致
  // （1 用户名、2 密码、3 姓名、4 邮箱、5 角色编码、6 院系编码）
  mockSheet: { rows: [] as string[][], errorRows: [] as any[] },
  excelMock: {
    readFile: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    write: vi.fn(async () => {}),
  },
  // 模板下载接口会把列定义挂在 worksheet 上：登记每次 new Workbook，供列头断言取回
  mockWorkbooks: [] as any[],
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

// 导入接口直接读/写 xlsx：readFile 吃 mockSheet.rows，writeFile 只记录不落盘（参照 students-scope.test.ts）
vi.mock('exceljs', () => {
  class MockRow {
    constructor(private readonly values: any[]) {}
    getCell(col: number) {
      return { value: this.values[col - 1] };
    }
  }
  class MockWorksheet {
    columns: any[] = [];
    rowCount: number;
    private rows = new Map<number, any>();
    constructor(dataRows: string[][]) {
      this.rowCount = dataRows.length + 1; // 首行表头
      this.rows.set(1, { font: null, commit: () => {} });
      dataRows.forEach((values, i) => this.rows.set(i + 2, new MockRow(values)));
    }
    getRow(n: number) {
      return this.rows.get(n);
    }
    addRow(row: any) {
      mockSheet.errorRows.push(row);
      return row;
    }
  }
  class MockWorkbook {
    worksheets: MockWorksheet[];
    xlsx = { readFile: excelMock.readFile, writeFile: excelMock.writeFile, write: excelMock.write };
    constructor() {
      this.worksheets = [new MockWorksheet(mockSheet.rows)];
      mockWorkbooks.push(this);
    }
    addWorksheet() {
      const ws = new MockWorksheet([]);
      this.worksheets.push(ws);
      return ws;
    }
  }
  const ExcelJS = { Workbook: MockWorkbook };
  return { __esModule: true, default: ExcelJS, Workbook: MockWorkbook };
});

// 导入接口用 multer 收文件：测试直接注入 req.file（不落盘），文件内容由上面的 exceljs mock 提供
vi.mock('multer', () => {
  const multerFn: any = () => ({
    single: () => (req: any, _res: any, next: any) => {
      req.file = { path: '/tmp/account-import-mock.xlsx', originalname: '账户导入.xlsx' };
      next();
    },
  });
  return { __esModule: true, default: multerFn };
});

import { accountRouter } from '../accounts';

const DEPT_ID = '11111111-1111-4111-8111-111111111111';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/accounts', accountRouter);
  return app;
}

// 无需真实 admin 账号：authenticate 被 mock，authorizePermission 对 admin 角色直接放行
function asAdmin(req: request.Test) {
  return req.set('x-test-role', 'admin');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue(null); // 用户名查重默认不存在
  mockPrisma.systemRole.findUnique.mockResolvedValue({ id: 'sr-teacher' });
  mockPrisma.department.findUnique.mockResolvedValue(null);
  mockPrisma.user.create.mockResolvedValue({ id: 'u-new' });
  mockPrisma.user.update.mockResolvedValue({ id: 'u-1' });
});

describe('POST /api/accounts 组织字段', () => {
  it('带 departmentId → 先校验院系存在，写入 departmentId 且 select 返回', async () => {
    mockPrisma.department.findUnique.mockResolvedValue({ id: DEPT_ID });

    const res = await asAdmin(
      request(makeApp()).post('/api/accounts'),
    ).send({ username: 't-new', password: 'secret123', departmentId: DEPT_ID });

    expect(res.status).toBe(201);
    expect(mockPrisma.department.findUnique.mock.calls[0][0].where.id).toBe(DEPT_ID);
    const arg = mockPrisma.user.create.mock.calls[0][0];
    expect(arg.data.departmentId).toBe(DEPT_ID);
    expect(arg.select.departmentId).toBe(true);
  });

  it('departmentId 指向不存在的院系 → 400 且不写库', async () => {
    const res = await asAdmin(
      request(makeApp()).post('/api/accounts'),
    ).send({ username: 't-new', password: 'secret123', departmentId: DEPT_ID });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('院系不存在');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('不传 departmentId → 落库为 null（不依赖数据库默认值）', async () => {
    const res = await asAdmin(
      request(makeApp()).post('/api/accounts'),
    ).send({ username: 't-new', password: 'secret123' });

    expect(res.status).toBe(201);
    expect(mockPrisma.department.findUnique).not.toHaveBeenCalled();
    const arg = mockPrisma.user.create.mock.calls[0][0];
    expect(arg.data.departmentId).toBeNull();
  });
});

describe('PUT /api/accounts/:id 组织字段', () => {
  it('传 null → 清空 departmentId（update data 含 null）', async () => {
    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ departmentId: null });

    expect(res.status).toBe(200);
    // null 表示清空，不需要校验院系存在
    expect(mockPrisma.department.findUnique).not.toHaveBeenCalled();
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect(arg.data.departmentId).toBeNull();
    expect(arg.select.departmentId).toBe(true);
  });

  it('不传 departmentId → update data 不含该字段（不动现有归属）', async () => {
    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ realName: '张三' });

    expect(res.status).toBe(200);
    const arg = mockPrisma.user.update.mock.calls[0][0];
    expect('departmentId' in arg.data).toBe(false);
  });

  it('传合法 departmentId → 校验院系存在后写入', async () => {
    mockPrisma.department.findUnique.mockResolvedValue({ id: DEPT_ID });

    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ departmentId: DEPT_ID });

    expect(res.status).toBe(200);
    expect(mockPrisma.department.findUnique.mock.calls[0][0].where.id).toBe(DEPT_ID);
    expect(mockPrisma.user.update.mock.calls[0][0].data.departmentId).toBe(DEPT_ID);
  });

  it('传不存在的院系 → 400 且不写库', async () => {
    const res = await asAdmin(
      request(makeApp()).put('/api/accounts/u-1'),
    ).send({ departmentId: DEPT_ID });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('院系不存在');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

// ============================================================
// P2 Task 10：导入模板 / 批量导入的院系编码（可选列）
// ============================================================
describe('GET /api/accounts/import-template 模板列', () => {
  it('第 6 列是「院系编码」（与导入解析的 getCell(6) 一致）', async () => {
    const res = await asAdmin(request(makeApp()).get('/api/accounts/import-template'));

    expect(res.status).toBe(200);
    const workbook = mockWorkbooks[mockWorkbooks.length - 1];
    const templateSheet = workbook.worksheets[workbook.worksheets.length - 1];
    const headers = templateSheet.columns.map((c: any) => c.header);
    // 导入解析按 getCell(6) 读院系编码：表头顺序必须与列号一一对应，改列序会在这里炸出来
    expect(headers).toEqual([
      '用户名(必填)',
      '密码(必填)',
      '姓名',
      '邮箱',
      '角色编码(如TEACHER)',
      '院系编码',
    ]);
  });
});

describe('POST /api/accounts/import 院系编码', () => {
  beforeEach(() => {
    mockSheet.rows = [];
    mockSheet.errorRows = [];
    excelMock.readFile.mockClear();
    excelMock.writeFile.mockClear();
    mockPrisma.importTask.create.mockResolvedValue({ id: 'task-1' });
    mockPrisma.importTask.update.mockResolvedValue({});
    mockPrisma.systemRole.findMany.mockResolvedValue([
      { id: 'sr-teacher', roleCode: 'TEACHER' },
      { id: 'sr-admin', roleCode: 'ADMIN' },
    ]);
    mockPrisma.department.findMany.mockResolvedValue([{ id: DEPT_ID, code: 'CS' }]);
  });

  it('带院系编码的行 → 一次预加载匹配后写入 departmentId', async () => {
    mockSheet.rows = [['t-new', 'secret123', '张三', '', 'TEACHER', 'CS']];

    const res = await asAdmin(request(makeApp()).post('/api/accounts/import'));

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(1);
    expect(res.body.successRows).toBe(1);
    expect(res.body.failedRows).toBe(0);
    // 映射一次预加载（按文件里出现的编码 in 查询），不是逐行查库
    expect(mockPrisma.department.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.department.findMany.mock.calls[0][0].where.code.in).toEqual(['CS']);
    expect(mockPrisma.user.create.mock.calls[0][0].data.departmentId).toBe(DEPT_ID);
  });

  it('编码不存在的行 → 该行报「院系编码不存在」，其余行照常成功', async () => {
    // 第 2 行编码 CS 命中，第 3 行编码 NOPE 不存在
    mockSheet.rows = [
      ['t-ok', 'secret123', '', '', 'TEACHER', 'CS'],
      ['t-bad', 'secret123', '', '', 'TEACHER', 'NOPE'],
    ];

    const res = await asAdmin(request(makeApp()).post('/api/accounts/import'));

    // 不整份失败：接口仍 200，逐行报告
    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.successRows).toBe(1);
    expect(res.body.failedRows).toBe(1);
    // 预加载查的是文件里出现的全部编码（含未知编码，好让未知行也能定位错误），仍是一次查询
    expect(mockPrisma.department.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.department.findMany.mock.calls[0][0].where.code.in).toEqual(
      expect.arrayContaining(['CS', 'NOPE']),
    );
    // 错误明细：行号 = 表头 1 + 数据行序
    expect(mockSheet.errorRows).toEqual([{ row: 3, username: 't-bad', error: '院系编码不存在' }]);
    // 有效行照常创建，未知编码行不写库
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.create.mock.calls[0][0].data.username).toBe('t-ok');
    expect(mockPrisma.user.create.mock.calls[0][0].data.departmentId).toBe(DEPT_ID);
  });

  it('旧模板（无院系编码列）→ 不查院系，departmentId 落 null', async () => {
    mockSheet.rows = [['t-new', 'secret123', '张三', '', 'TEACHER']];

    const res = await asAdmin(request(makeApp()).post('/api/accounts/import'));

    expect(res.status).toBe(200);
    expect(res.body.successRows).toBe(1);
    // 没有任何院系编码 → 连预加载都不该发生
    expect(mockPrisma.department.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.user.create.mock.calls[0][0].data.departmentId).toBeNull();
  });
});
