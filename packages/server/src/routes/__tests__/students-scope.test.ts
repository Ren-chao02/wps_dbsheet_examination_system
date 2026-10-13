/**
 * 学生名册/创建/导入的数据范围回归测试（P1）。
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

const { mockPrisma, mockSheet, excelMock } = vi.hoisted(() => ({
  mockPrisma: {
    teacherClass: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    classRoom: { findUnique: vi.fn(), findMany: vi.fn() },
    importTask: { update: vi.fn() },
    $transaction: vi.fn(),
  } as any,
  // 伪 sheet 数据：rows 为数据行（不含表头），列序与导入模板一致（1 学号、2 姓名、3 性别、4 手机、5 邮箱、6 班级编码）
  mockSheet: { rows: [] as string[][], errorRows: [] as any[] },
  excelMock: { readFile: vi.fn(async () => {}), writeFile: vi.fn(async () => {}) },
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

// processImport 直接读/写 xlsx：readFile 吃 mockSheet.rows，writeFile 只记录不落盘
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
    xlsx = { readFile: excelMock.readFile, writeFile: excelMock.writeFile };
    constructor() {
      this.worksheets = [new MockWorksheet(mockSheet.rows)];
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

// 初始密码哈希与数据范围判定无关，mock 掉省去真实 bcrypt 开销
vi.mock('bcryptjs', () => {
  const bcrypt = { hash: vi.fn(async () => 'hashed-password'), compare: vi.fn(async () => true) };
  return { __esModule: true, default: bcrypt, ...bcrypt };
});

import { studentRouter, processImport } from '../students';

// zod 的 uuid 校验要求请求体里是合法 UUID —— 测试数据与 mock 返回值共用这组常量
const C1 = '00000000-0000-4000-8000-000000000001';
const C9 = '00000000-0000-4000-8000-000000000009';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: C1 }]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.count.mockResolvedValue(0);
  mockPrisma.user.findUnique.mockResolvedValue(null);
});

describe('GET /api/students 列表', () => {
  it('教师 → where 限定任教班级（含未分班收紧）', async () => {
    const res = await request(makeApp())
      .get('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1');
    expect(res.status).toBe(200);
    const where = mockPrisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ role: 'student', classRoomId: { in: [C1] } });
  });
});

describe('POST /api/students 创建', () => {
  it('教师往他人班级建学生 → 403', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValue({ id: C9, departmentId: 'd-1', majorId: 'm-1' });
    const res = await request(makeApp())
      .post('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ username: 'stu1', realName: '张三', studentId: '2026001', classRoomId: C9 });
    expect(res.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('教师往未分班（无班级）建学生 → 403', async () => {
    const res = await request(makeApp())
      .post('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ username: 'stu1', realName: '张三', studentId: '2026001' });
    expect(res.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('教师往本班建学生 → 201', async () => {
    mockPrisma.classRoom.findUnique.mockResolvedValue({ id: C1, departmentId: 'd-1', majorId: 'm-1' });
    mockPrisma.user.create.mockResolvedValue({ id: 's-new', username: 'stu1', realName: '张三', studentId: '2026001', classRoomId: C1, role: 'student' });
    const res = await request(makeApp())
      .post('/api/students')
      .set('x-test-role', 'teacher')
      .set('x-test-user', 't-1')
      .send({ username: 'stu1', realName: '张三', studentId: '2026001', classRoomId: C1 });
    expect(res.status).toBe(201);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  });
});

describe('processImport 导入行级班级范围', () => {
  const TASK_ID = 'task-1';
  const FILE_PATH = '/tmp/fake-import.xlsx';

  beforeEach(() => {
    // xlsx 里只有 1 行：学号 2026001 / 姓名 张三 / 班级编码 CLS9（属于 C9，不属于教师的 C1）
    mockSheet.rows = [['2026001', '张三', '', '', '', 'CLS9']];
    mockSheet.errorRows = [];
    excelMock.readFile.mockClear();
    excelMock.writeFile.mockClear();
    mockPrisma.importTask.update.mockResolvedValue({});
    mockPrisma.classRoom.findMany.mockResolvedValue([
      { id: C9, code: 'CLS9', departmentId: 'd-1', majorId: 'm-1' },
    ]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.$transaction.mockResolvedValue([]);
    mockPrisma.user.create.mockImplementation(async (args: any) => ({ id: 's-new', ...args.data }));
  });

  it('教师导入到非任教班级 → 该行报错、不创建', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'teacher' });
    mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: C1 }]);

    const result = await processImport(TASK_ID, FILE_PATH, 't-1');

    expect(result.totalRows).toBe(1);
    expect(result.failedRows).toBe(1);
    expect(result.successRows).toBe(0);
    expect(result.errorFile).toBe('import_errors_task-1.xlsx');
    // 范围拒绝必须发生在落库之前：事务与建号都不应被触发
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    // 错误文件是内存 mock 写出的，未落盘
    expect(excelMock.writeFile).toHaveBeenCalledTimes(1);
    // 错误明细是范围性拒绝，而非格式类错误
    expect(mockSheet.errorRows).toHaveLength(1);
    expect(mockSheet.errorRows[0].classRoomCode).toBe('CLS9');
    expect(mockSheet.errorRows[0].error).toContain('该班级不在你任教的班级内');
  });

  it('管理员导入同一行 → 不因范围被拒，正常创建', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ role: 'admin' });

    const result = await processImport(TASK_ID, FILE_PATH, 'a-1');

    expect(result.totalRows).toBe(1);
    expect(result.failedRows).toBe(0);
    expect(result.successRows).toBe(1);
    expect(result.errorFile).toBeNull();
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.create.mock.calls[0][0].data).toMatchObject({
      studentId: '2026001',
      classRoomId: C9,
      departmentId: 'd-1',
      majorId: 'm-1',
      role: 'student',
    });
    expect(excelMock.writeFile).not.toHaveBeenCalled();
    expect(mockPrisma.importTask.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FINISHED', successRows: 1, failedRows: 0 }),
      }),
    );
  });
});
