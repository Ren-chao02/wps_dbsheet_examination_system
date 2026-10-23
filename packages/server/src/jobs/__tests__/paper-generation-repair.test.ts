import { describe, it, expect, vi } from 'vitest';
import { repairStudentPaper, buildGenerationSummary, processPaperGeneration } from '../paper-generation-queue';

// 失败分支会打结构化日志：挡掉，避免测试往 stdout 刷日志
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const dbStub = (target: any, over: any = {}) => ({
  exam: { findUnique: vi.fn().mockResolvedValue({ difficultyTarget: target }) },
  examQuestion: { findMany: vi.fn().mockResolvedValue([
    { slotIndex: 0, rule: { type: 'comprehensive' } },
    { slotIndex: 1, rule: { type: 'comprehensive' } },
  ]) },
  studentExamQuestion: {
    findMany: vi.fn().mockResolvedValue([
      { slotIndex: 0, questionId: 'a', score: 10 },
      { slotIndex: 1, questionId: 'b', score: 10 },
    ]),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  question: { findUnique: vi.fn().mockResolvedValue({ difficulty: 'easy' }) },
  ...over,
});

const candidatesStub = () => vi.fn().mockResolvedValue([
  { id: 'm-1', score: 10, difficulty: 'medium', schemaRefs: null, answerRules: [] },
  { id: 'h-1', score: 10, difficulty: 'hard', schemaRefs: null, answerRules: [] },
]);

describe('repairStudentPaper', () => {
  it('有目标时换题并写回 pickMeta=repair（含池大小与签名）', async () => {
    const db = dbStub({ easy: 0, medium: 1, hard: 0 });   // 2 个题位、目标 2 道 medium
    const listCandidates = candidatesStub();
    const changed = await repairStudentPaper('e-1', 's-1', { db, listCandidates });
    expect(changed).toBe(true);
    expect(db.studentExamQuestion.updateMany).toHaveBeenCalledWith({
      where: {
        examId: 'e-1', studentId: 's-1', slotIndex: 0,
        // 原子守卫：该生有开考提交时 updateMany 命中 0 行
        student: { submissions: { none: { examId: 'e-1', status: { in: ['in_progress', 'submitted', 'grading', 'graded'] } } } },
      },
      data: expect.objectContaining({
        questionId: 'm-1',
        pickMeta: expect.objectContaining({
          level: 'repair', repairedFrom: 'a', candidates: 2,
          wantedSignature: '', actualSignature: '',
        }),
      }),
    });
    // 修复只换题、不改分值：data 里出现 score 会让卷面总分与题位分脱节
    expect(db.studentExamQuestion.updateMany.mock.calls[0][0].data).not.toHaveProperty('score');
  });

  it('没有难度目标 → 不做任何替换', async () => {
    const db = dbStub(null);
    const changed = await repairStudentPaper('e-1', 's-1', { db, listCandidates: candidatesStub() });
    expect(changed).toBe(false);
    expect(db.studentExamQuestion.updateMany).not.toHaveBeenCalled();
  });

  it('学生已开考（守卫使 updateMany 命中 0 行）→ 视为未修复', async () => {
    const db = dbStub({ easy: 0, medium: 1, hard: 0 });
    db.studentExamQuestion.updateMany.mockResolvedValue({ count: 0 });
    const changed = await repairStudentPaper('e-1', 's-1', { db, listCandidates: candidatesStub() });
    expect(changed).toBe(false);
  });

  it('修复候选同样受试卷归属 poolWhere 约束', async () => {
    const db = dbStub({ easy: 0, medium: 1, hard: 0 }, {
      exam: { findUnique: vi.fn().mockResolvedValue({ difficultyTarget: { easy: 0, medium: 1, hard: 0 }, paperId: 'p-1' }) },
      paper: { findUnique: vi.fn().mockResolvedValue({ createdBy: 't-1', departmentId: null }) },
    });
    const listCandidates = candidatesStub();
    await repairStudentPaper('e-1', 's-1', { db, listCandidates });
    expect(listCandidates).toHaveBeenCalledWith(expect.objectContaining({
      poolWhere: expect.anything(),
      level: 'strict',
    }));
  });
});

describe('buildGenerationSummary', () => {
  it('分布按每卷平均道数；降级按卷取最差档位', () => {
    const out = buildGenerationSummary({
      snapshots: [
        { studentId: 's-1', source: 'rule', pickMeta: { level: 'strict' }, difficulty: 'easy' },
        { studentId: 's-1', source: 'rule', pickMeta: { level: 'strict' }, difficulty: 'easy' },
        { studentId: 's-2', source: 'rule', pickMeta: { level: 'relax-difficulty' }, difficulty: 'easy' },
        { studentId: 's-2', source: 'rule', pickMeta: { level: 'strict' }, difficulty: 'hard' },
        { studentId: 's-2', source: 'fixed', pickMeta: null, difficulty: 'medium' },
      ],
      ruleSlotCount: 2,
      target: { easy: 0.5, medium: 0, hard: 0.5 },
    });
    expect(out.papers).toBe(2);
    expect(out.distribution.actual).toMatchObject({ easy: 1.5, hard: 0.5 });
    expect(out.distribution.wholePaper).toMatchObject({ easy: 1.5, medium: 0.5, hard: 0.5 });
    expect(out.distribution.target).toEqual({ easy: 1, medium: 0, hard: 1 });
    expect(out.degradation).toEqual({ strict: 1, relaxSchemaRefs: 0, relaxDifficulty: 1, repaired: 0 });
  });

  it('无 pickMeta 的历史快照不计入降级', () => {
    const out = buildGenerationSummary({
      snapshots: [{ studentId: 's-1', source: 'rule', pickMeta: null, difficulty: 'easy' }],
      ruleSlotCount: 1,
      target: null,
    });
    expect(out.degradation).toEqual({ strict: 0, relaxSchemaRefs: 0, relaxDifficulty: 0, repaired: 0 });
    expect(out.distribution.target).toBeNull();
  });
});

describe('processPaperGeneration 接入', () => {
  it('按学生调用 repair，并在 summary 写入分布/降级', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-1' }, { studentId: 's-2' }]),
      generate: vi.fn().mockResolvedValue({ created: 2, total: 2, unfilledSlots: [] }),
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
      repair: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      loadSummaryInput: vi.fn().mockResolvedValue({
        snapshots: [
          { studentId: 's-1', source: 'rule', pickMeta: { level: 'repair' }, difficulty: 'medium' },
          { studentId: 's-2', source: 'rule', pickMeta: { level: 'strict' }, difficulty: 'easy' },
        ],
        ruleSlotCount: 1,
        target: { easy: 0.5, medium: 0.5, hard: 0 },
      }),
    };
    const out = await processPaperGeneration('e-1', deps as any);
    expect(deps.repair).toHaveBeenCalledTimes(2);
    expect(out.generated).toBe(2);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({
      status: 'done',
      summary: expect.objectContaining({
        repaired: 1,
        degradation: { strict: 1, relaxSchemaRefs: 0, relaxDifficulty: 0, repaired: 1 },
      }),
    }));
  });

  it('已有快照（created=0）不修复——已开考/历史卷子绝不动', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-1' }]),
      generate: vi.fn().mockResolvedValue({ created: 0, total: 2, unfilledSlots: [] }),
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
      repair: vi.fn().mockResolvedValue(true),
    };
    await processPaperGeneration('e-1', deps as any);
    expect(deps.repair).not.toHaveBeenCalled();
  });

  it('单卷修复抛错 → 整场生成仍标 done', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-1' }]),
      generate: vi.fn().mockResolvedValue({ created: 1, total: 1, unfilledSlots: [] }),
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
      repair: vi.fn().mockRejectedValue(new Error('repair boom')),
    };
    const out = await processPaperGeneration('e-1', deps as any);
    expect(out.generated).toBe(1);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({ status: 'done' }));
  });

  it('汇总统计抛错 → 生成仍标 done（只写基础进度）', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-1' }]),
      generate: vi.fn().mockResolvedValue({ created: 1, total: 1, unfilledSlots: [] }),
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
      loadSummaryInput: vi.fn().mockRejectedValue(new Error('summary boom')),
    };
    await processPaperGeneration('e-1', deps as any);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({
      status: 'done',
      summary: expect.objectContaining({ generated: 1, missing: 0 }),
    }));
  });
});
