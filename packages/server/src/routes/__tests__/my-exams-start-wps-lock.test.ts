/**
 * POST /api/my-exams/:id/start-wps 的考试锁路由级测试
 *
 * 钉住两条不变式（改 my-exams.ts 的开考分支前先看这里）：
 *
 * 1. **新建答卷**：必须在 $transaction 内先取 `pg_advisory_xact_lock_shared`，
 *    再读/写试卷快照与 submission。共享锁允许学生之间并发开考，但与
 *    「重新组卷 / 换卷 / 改题」的排他锁互斥——锁一旦挪到事务外或被删掉，
 *    预生成快照就可能被并发的重试事务删改，学生拿到"一半旧一半新"的卷子。
 * 2. **断点续考**：只做条件 updateMany（保留原 startedAt），不取锁、不新建答卷——
 *    续考不写快照，取锁纯属给编辑事务添堵。
 *
 * 用无实操题的考试（examQuestions: []）绕开 WPS 表格校验与抽题候选池：
 * generateStudentPaper 在 examQuestion.findMany 返回空时直接早退，
 * 测试只关心事务边界与锁，不关心组卷细节。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 's-1', userId: 's-1', username: 'stu1', role: 'student', permissions: [] };
      next();
    },
  };
});

const {
  examFindUnique, submissionFindUnique, submissionUpdateMany, roomStudentFindFirst,
  tableAssignmentFindUnique, paperQuestionFindMany, sessionFindFirst, txState, tx, transactionSpy,
} = vi.hoisted(() => {
  const txState = { inTx: false };
  const tx = {
    // 锁必须发生在事务内：事务外调用 $executeRaw 直接抛错，用例会失败。
    // 参数显式声明成 tagged template 形状，才能从 mock.calls 里取出 SQL 与插值。
    executeRaw: vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => {
      if (!txState.inTx) throw new Error('lock must be inside transaction');
      return 1;
    }),
    examFindUnique: vi.fn(),
    examQuestionFindMany: vi.fn(),
    studentExamQuestionCount: vi.fn(),
    studentExamQuestionFindMany: vi.fn(),
    submissionCreate: vi.fn(),
    sessionCreate: vi.fn(),
  };
  // $transaction 的 spy 必须提升到这里：只有从测试里拿到同一个引用，
  // 才能断言「断点续考根本不进事务」。实现仍是原来的 txState 包一层。
  const transactionSpy = vi.fn(async (fn: any) => {
    txState.inTx = true;
    try {
      const txClient: any = {
        exam: { findUnique: tx.examFindUnique },
        examQuestion: { findMany: tx.examQuestionFindMany },
        studentExamQuestion: { count: tx.studentExamQuestionCount, findMany: tx.studentExamQuestionFindMany },
        studentSubmission: { create: tx.submissionCreate },
        examSession: { create: tx.sessionCreate },
        $executeRaw: tx.executeRaw,
      };
      return await fn(txClient);
    } finally { txState.inTx = false; }
  });
  return {
    examFindUnique: vi.fn(), submissionFindUnique: vi.fn(), submissionUpdateMany: vi.fn(),
    roomStudentFindFirst: vi.fn(), tableAssignmentFindUnique: vi.fn(), paperQuestionFindMany: vi.fn(),
    sessionFindFirst: vi.fn(), txState, tx, transactionSpy,
  };
});

vi.mock('../../config/prisma', () => {
  const prismaMock: any = {
    exam: { findUnique: examFindUnique },
    studentSubmission: { findUnique: submissionFindUnique, updateMany: submissionUpdateMany },
    examRoomStudent: { findFirst: roomStudentFindFirst },
    examTableAssignment: { findUnique: tableAssignmentFindUnique },
    studentExamQuestion: { findMany: paperQuestionFindMany },
    examSession: { findFirst: sessionFindFirst },
    $transaction: transactionSpy,
  };
  return { prisma: prismaMock };
});

import { myExamRouter } from '../my-exams';

const app = express();
app.use(express.json());
app.use('/api/my-exams', myExamRouter);

const EXAM = {
  id: 'e-1', title: '测试考试', status: 'published',
  startTime: null, endTime: null, durationMinutes: 60, totalScore: 100, passScore: 60,
  batch: null, examQuestions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  examFindUnique.mockResolvedValue(EXAM);
  submissionFindUnique.mockResolvedValue(null);
  submissionUpdateMany.mockResolvedValue({ count: 0 });
  roomStudentFindFirst.mockResolvedValue({ id: 'es-1' });
  tableAssignmentFindUnique.mockResolvedValue(null);
  paperQuestionFindMany.mockResolvedValue([]);
  sessionFindFirst.mockResolvedValue({ id: 'sess-1' });
  tx.examFindUnique.mockResolvedValue({ status: 'published' });
  tx.examQuestionFindMany.mockResolvedValue([]);
  tx.studentExamQuestionCount.mockResolvedValue(0);
  tx.studentExamQuestionFindMany.mockResolvedValue([]);
  tx.submissionCreate.mockImplementation(async ({ data }: any) => ({ id: 'sub-1', ...data }));
  tx.sessionCreate.mockResolvedValue({});
});

describe('POST /api/my-exams/:id/start-wps 的考试锁', () => {
  it('新建答卷：事务内先取共享 advisory lock，再建 submission', async () => {
    const res = await request(app).post('/api/my-exams/e-1/start-wps');
    expect(res.status).toBe(200);
    expect(tx.executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = tx.executeRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(sql).toContain('pg_advisory_xact_lock_shared');
    expect(sql).toContain('hashtextextended');
    expect(values).toContain('e-1');
    expect(txState.inTx).toBe(false);           // 事务已结束
    // 「先取锁，再建 submission」的顺序本身就是不变式：建卷用了快照，
    // 锁必须已经罩住快照，否则并发重试事务能在这两步之间把快照删改掉。
    expect(tx.executeRaw.mock.invocationCallOrder[0])
      .toBeLessThan(tx.submissionCreate.mock.invocationCallOrder[0]);
    expect(tx.submissionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ examId: 'e-1', studentId: 's-1', status: 'in_progress' }),
    }));
  });

  it('断点续考：不新建答卷、不取锁', async () => {
    submissionFindUnique
      .mockResolvedValueOnce({ id: 'sub-1', status: 'in_progress', startedAt: new Date() })
      .mockResolvedValueOnce({ id: 'sub-1', status: 'in_progress', startedAt: new Date() });
    submissionUpdateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post('/api/my-exams/e-1/start-wps');
    expect(res.status).toBe(200);
    expect(transactionSpy).not.toHaveBeenCalled();   // 续考走 updateMany，根本不进事务
    expect(tx.executeRaw).not.toHaveBeenCalled();
    expect(tx.submissionCreate).not.toHaveBeenCalled();
  });
});
