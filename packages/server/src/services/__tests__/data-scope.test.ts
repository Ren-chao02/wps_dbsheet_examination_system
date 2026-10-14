/**
 * 数据范围层单元测试 —— 「角色 × 资源」矩阵的可执行版本。
 * 设计依据：docs/superpowers/specs/2026-10-11-org-structure-data-scope-design.md §3。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    teacherClass: { findMany: vi.fn() },
    exam: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    examBatch: { findUnique: vi.fn() },
    studentSubmission: { findUnique: vi.fn() },
  } as any,
}));
vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));

import {
  makeScopeCtx, scopeCtxOf, myClassIds, studentWhere, examWhere, behaviorWhere,
  assertExamAccess, assertBatchAccess, assertStudentAccess, assertSubmissionAccess,
} from '../data-scope';

// 注意：每个用例用新的 ctx 对象（请求级缓存挂在 ctx 上，避免用例间串味）
const ADMIN = () => makeScopeCtx('admin-1', 'admin');
const TEACHER = () => makeScopeCtx('t-1', 'teacher');
const OTHER = () => makeScopeCtx('t-2', 'teacher');

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.teacherClass.findMany.mockResolvedValue([{ classId: 'c-1' }, { classId: 'c-2' }]);
});

describe('myClassIds 请求级缓存', () => {
  it('同一 ctx 多次调用只查一次库', async () => {
    const ctx = TEACHER();
    await myClassIds(ctx);
    await myClassIds(ctx);
    expect(mockPrisma.teacherClass.findMany).toHaveBeenCalledTimes(1);
  });

  it('admin 不查库，返回空数组', async () => {
    expect(await myClassIds(ADMIN())).toEqual([]);
    expect(mockPrisma.teacherClass.findMany).not.toHaveBeenCalled();
  });
});

describe('studentWhere', () => {
  it('admin → 全校学生', async () => {
    expect(await studentWhere(ADMIN())).toEqual({ role: 'student' });
  });

  it('教师 → 仅任教班级', async () => {
    expect(await studentWhere(TEACHER())).toEqual({ role: 'student', classRoomId: { in: ['c-1', 'c-2'] } });
  });

  it('教师没有任何班级 → in 空数组（缺省永不放行）', async () => {
    mockPrisma.teacherClass.findMany.mockResolvedValue([]);
    expect(await studentWhere(makeScopeCtx('t-9', 'teacher'))).toEqual({ role: 'student', classRoomId: { in: [] } });
  });
});

describe('examWhere', () => {
  it('admin → 无过滤', async () => {
    expect(await examWhere(ADMIN())).toEqual({});
  });

  it('教师 → 创建者或被监考', async () => {
    expect(await examWhere(TEACHER())).toEqual({
      OR: [
        { createdBy: 't-1' },
        { assignments: { some: { invigilators: { some: { id: 't-1' } } } } },
      ],
    });
  });
});

describe('behaviorWhere', () => {
  it('admin → 无过滤', async () => {
    expect(await behaviorWhere(ADMIN())).toEqual({});
  });

  it('教师 → 仅其可见考试的行为数据', async () => {
    mockPrisma.exam.findMany.mockResolvedValue([{ id: 'e-1' }, { id: 'e-2' }]);
    expect(await behaviorWhere(TEACHER())).toEqual({ examId: { in: ['e-1', 'e-2'] } });
  });
});

describe('assertExamAccess', () => {
  it('admin 且考试存在 → ok；不存在 → not-found', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({ id: 'e-1' });
    expect(await assertExamAccess(ADMIN(), 'e-1')).toBe('ok');
    mockPrisma.exam.findUnique.mockResolvedValue(null);
    expect(await assertExamAccess(ADMIN(), 'e-9')).toBe('not-found');
  });

  it('创建者 → ok', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
    expect(await assertExamAccess(TEACHER(), 'e-1')).toBe('ok');
  });

  it('监考老师 → ok（协同监考刻意保留）', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({
      createdBy: 't-1',
      assignments: [{ invigilators: [{ id: 't-2' }] }],
    });
    expect(await assertExamAccess(OTHER(), 'e-1')).toBe('ok');
  });

  it('其他教师 → forbidden；考试不存在 → not-found', async () => {
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
    expect(await assertExamAccess(OTHER(), 'e-1')).toBe('forbidden');
    mockPrisma.exam.findUnique.mockResolvedValue(null);
    expect(await assertExamAccess(OTHER(), 'e-9')).toBe('not-found');
  });
});

describe('assertStudentAccess', () => {
  it('admin → ok', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 's-1', classRoomId: 'c-9' });
    expect(await assertStudentAccess(ADMIN(), 's-1')).toBe('ok');
  });

  it('本人 → ok', async () => {
    const self = makeScopeCtx('s-1', 'student');
    mockPrisma.user.findUnique.mockResolvedValue({ id: 's-1', classRoomId: 'c-9' });
    expect(await assertStudentAccess(self, 's-1')).toBe('ok');
  });

  it('教师-本班学生 → ok；他班学生 → forbidden', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 's-1', classRoomId: 'c-1' });
    expect(await assertStudentAccess(TEACHER(), 's-1')).toBe('ok');
    mockPrisma.user.findUnique.mockResolvedValue({ id: 's-2', classRoomId: 'c-9' });
    expect(await assertStudentAccess(TEACHER(), 's-2')).toBe('forbidden');
  });

  it('教师-未分班学生 → forbidden（2026-10-13 收紧：原实现对所有教师放行）', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 's-3', classRoomId: null });
    expect(await assertStudentAccess(TEACHER(), 's-3')).toBe('forbidden');
  });

  it('学生不存在 → not-found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect(await assertStudentAccess(TEACHER(), 's-9')).toBe('not-found');
  });
});

describe('assertBatchAccess / assertSubmissionAccess', () => {
  it('批次：创建者/admin 放行，他人禁止', async () => {
    mockPrisma.examBatch.findUnique.mockResolvedValue({ createdBy: 't-1' });
    expect(await assertBatchAccess(TEACHER(), 'b-1')).toBe('ok');
    expect(await assertBatchAccess(OTHER(), 'b-1')).toBe('forbidden');
    expect(await assertBatchAccess(ADMIN(), 'b-1')).toBe('ok');
  });

  it('答卷：归属跟随其考试', async () => {
    mockPrisma.studentSubmission.findUnique.mockResolvedValue({ examId: 'e-1' });
    mockPrisma.exam.findUnique.mockResolvedValue({ createdBy: 't-1', assignments: [] });
    expect(await assertSubmissionAccess(OTHER(), 'sub-1')).toBe('forbidden');
    expect(await assertSubmissionAccess(TEACHER(), 'sub-1')).toBe('ok');
  });
});

describe('ScopeCtx 院系字段（P2）', () => {
  it('makeScopeCtx 默认 departmentId 为 null；scopeCtxOf 透传 req.user.departmentId', async () => {
    expect(makeScopeCtx('t-1', 'teacher').departmentId).toBeNull();
    expect(makeScopeCtx('t-1', 'teacher', 'd-1').departmentId).toBe('d-1');
    const req: any = { user: { userId: 't-1', role: 'teacher', departmentId: 'd-2' } };
    expect(scopeCtxOf(req).departmentId).toBe('d-2');
    const req2: any = { user: { userId: 't-1', role: 'teacher' } };
    expect(scopeCtxOf(req2).departmentId).toBeNull();
  });
});
