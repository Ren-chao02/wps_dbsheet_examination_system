/**
 * 每生卷子生成器（抽题组卷的执行端）
 *
 * 输入：考试的题位列表（ExamQuestion，含 fixed 固定题位与 rule 抽题题位）
 * 输出：该考生专属的卷子快照（StudentExamQuestion），落库后不再变化
 *
 * 三条设计要点：
 *
 * 1. **必须落库快照，不能每次按种子重算**
 *    题库是活的（教师改题、加题、下线题）。重算路径下，历史答卷对不上
 *    "他当时做的是哪道题"，学生申诉时无法复现。快照一旦生成即与题库变更解耦。
 *
 * 2. **等值替换，不是随机抽题**
 *    同一题位里，不同学生拿到的题目必须「同知识点 + 同难度 + 同题型 + 同分值」，
 *    这样卷子的总分、知识点覆盖、难度分布完全一致，成绩才可比较。
 *    再加上 `schemaRefs` 一致：实操题题面会写"在「员工信息表」中把「入职日期」
 *    改为日期格式"，若变体题引用了别的表/字段，学生打开自己的表格根本找不到
 *    那张表 —— 所以候选题必须引用同一份结构。
 *
 * 3. **幂等**
 *    靠 `@@unique([examId, studentId, slotIndex])` + skipDuplicates：开考瞬间的
 *    重试、双标签进入都不会生成两套卷子。
 */
import { createHash } from 'crypto';
import { prisma } from '../config/prisma';
import type { Prisma } from '@prisma/client';
import { questionPoolWhereForPaper } from './data-scope';
import { unsupportedRuleActions } from '../engine/rule-engine';

export interface SlotRule {
  /** 要求命中的能力点（知识点）：候选题必须**全部覆盖**这些能力点 */
  capabilityIds?: string[];
  /** 难度限定（easy/medium/hard），不填则不限 */
  difficulty?: string;
  /** 题型限定（academic 客观题与实操题可分别组卷），不填则不限 */
  type?: string;
  /**
   * 期望的题目引用结构：{ tables?: string[], fields?: string[] }
   * 候选题的 schemaRefs 必须与之完全一致 —— 保证变体题在学生各自表格里都做得出来。
   * 不填则不做该维度校验（兼容手工维护的题库）。
   */
  schemaRefs?: { tables?: string[]; fields?: string[] };
}

export interface GeneratePaperResult {
  /** 本次实际新写入的题位数（已存在则为 0，表示命中幂等） */
  created: number;
  /** 该生卷子总题位数 */
  total: number;
  /** 无法填满的题位（候选池为空），需要教师关注 */
  unfilledSlots: Array<{ slotIndex: number; reason: string }>;
}

/** 稳定哈希：同一个 (考试, 学生, 题位) 永远得到同一个选择，便于排查与复现 */
function seededPickIndex(seed: string, poolSize: number): number {
  if (poolSize <= 1) return 0;
  const hash = createHash('sha256').update(seed).digest();
  return hash.readUInt32BE(0) % poolSize;
}

/** 把 schemaRefs 归一化成可比较的签名（数组排序后拼接），空值统一为 '' */
function schemaRefsSignature(refs: unknown): string {
  if (!refs || typeof refs !== 'object') return '';
  const r = refs as { tables?: unknown; fields?: unknown };
  const norm = (v: unknown) =>
    Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(Boolean).sort().join('|') : '';
  return `T:${norm(r.tables)}#F:${norm(r.fields)}`;
}

/**
 * 为一名考生生成卷子快照（幂等）。
 *
 * @param tx 可选事务客户端：开考流程里与 submission 创建放在同一事务更安全
 */
export async function generateStudentPaper(
  examId: string,
  studentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<GeneratePaperResult> {
  const slots = await tx.examQuestion.findMany({
    where: { examId },
    orderBy: [{ slotIndex: 'asc' }, { sortOrder: 'asc' }],
    include: {
      question: {
        select: { id: true, type: true, difficulty: true, score: true, capabilityIds: true, schemaRefs: true, status: true },
      },
    },
  });

  if (slots.length === 0) {
    return { created: 0, total: 0, unfilledSlots: [] };
  }

  // 已经生成过 → 直接返回（幂等；也避免重复查候选池）
  const existing = await tx.studentExamQuestion.count({ where: { examId, studentId } });
  if (existing > 0) {
    return { created: 0, total: existing, unfilledSlots: [] };
  }

  // ── 数据范围 P2：抽题候选池跟随试卷归属 ──
  // 生成是系统行为（开考瞬间由考生触发，也可能被重试/脚本触发），不能按"当前请求者"
  // 收口；以试卷归属为准（本院系 / 校级 / 作者本人 / 上架），与组卷页预览同池 ——
  // 否则换个人触发开考，抽出来的题就"越界"了。
  // 一次生成只查一次、全题位共用；没有抽题题位则不查（固定题位不碰候选池）。
  const poolWhere = slots.some(s => s.slotType === 'rule')
    ? await loadQuestionPoolWhereForExamPaper(examId, tx)
    : undefined;

  const rows: Prisma.StudentExamQuestionCreateManyInput[] = [];
  const unfilledSlots: Array<{ slotIndex: number; reason: string }> = [];
  const usedQuestionIds = new Set<string>();

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const slotIndex = slot.slotIndex || i;
    const slotScore = slot.scoreOverride ?? slot.question?.score ?? 0;

    // ── 固定题位 ──
    // 注意：判断只看 slotType。rule 题位本来就没有 questionId，
    // 若把 `!slot.questionId` 也并进条件，rule 题位会被误当成"没绑题的固定题位"丢掉。
    if (slot.slotType !== 'rule') {
      if (!slot.questionId) {
        unfilledSlots.push({ slotIndex, reason: '固定题位未绑定题目' });
        continue;
      }
      rows.push({
        examId, studentId, slotIndex,
        questionId: slot.questionId,
        score: slotScore,
        sortOrder: slot.sortOrder,
        source: 'fixed',
      });
      usedQuestionIds.add(slot.questionId);
      continue;
    }

    // ── 抽题题位 ──
    const rule = (slot.rule || {}) as SlotRule;
    const picked = await pickQuestionForSlot({
      examId, slotIndex, rule, slotScore, usedQuestionIds, poolWhere,
      seed: `${examId}:${studentId}:${slotIndex}`, tx,
    });

    if (!picked) {
      unfilledSlots.push({ slotIndex, reason: '候选池为空（请到试卷编辑页检查该题位的能力点/难度/分值设置）' });
      continue;
    }

    rows.push({
      examId, studentId, slotIndex,
      questionId: picked.id,
      score: slotScore,
      sortOrder: slot.sortOrder,
      source: 'rule',
    });
    usedQuestionIds.add(picked.id);
  }

  if (rows.length > 0) {
    // skipDuplicates + 唯一约束 = 并发/重试安全的幂等写入
    await tx.studentExamQuestion.createMany({ data: rows, skipDuplicates: true });
  }

  return { created: rows.length, total: rows.length, unfilledSlots };
}

/**
 * 读取本场考试试卷归属决定的候选题池条件（数据范围 P2）。
 * 考试未绑试卷 / 试卷已删 → 返回 undefined：调用方不加池条件，行为与收口前一致
 * （不放宽也不收窄；不放宽是安全底线，收窄会让历史考试的补建有题抽不到）。
 */
export async function loadQuestionPoolWhereForExamPaper(
  examId: string,
  tx: Prisma.TransactionClient,
): Promise<Record<string, any> | undefined> {
  const exam = await tx.exam.findUnique({ where: { id: examId }, select: { paperId: true } });
  if (!exam?.paperId) return undefined;
  const paper = await tx.paper.findUnique({
    where: { id: exam.paperId },
    select: { createdBy: true, departmentId: true },
  });
  return paper ? questionPoolWhereForPaper(paper) : undefined;
}

export type CandidateLevel = 'strict' | 'relax-schemaRefs' | 'relax-difficulty';

export interface SlotCandidate {
  id: string;
  score: number | null;
  difficulty: string | null;
  schemaRefs: unknown;
  answerRules: unknown;
}

/**
 * 候选枚举的**唯一入口**：预检、生成、修复三处共用。
 *
 * 为什么必须唯一：如果预检和生成各写一套过滤，就会出现"预检说有候选、开考抽不出来"
 * ——这正是 `schemaRefs` 校验最初断链时的形态。三档放宽的语义也集中在这里：
 *   strict            —— 带难度条件 + 结构签名必须一致
 *   relax-schemaRefs  —— 带难度条件，结构签名不再比较
 *   relax-difficulty  —— 去掉难度条件，其余（分值/已用/可判分/池范围）仍生效
 *
 * tx 缺省用 prisma：若调用方已在事务内，**必须显式传入 tx**，否则会绕过事务读库。
 */
export async function listSlotCandidates(params: {
  rule: SlotRule;
  slotScore: number;
  level: CandidateLevel;
  usedQuestionIds?: ReadonlySet<string>;
  poolWhere?: Record<string, any>;
  tx?: Prisma.TransactionClient | { question: { findMany: (args: any) => Promise<any[]> } };
}): Promise<SlotCandidate[]> {
  const { rule, slotScore, level, usedQuestionIds, poolWhere, tx = prisma } = params;

  const where: Prisma.QuestionWhereInput = { status: 'published' };
  if (rule.capabilityIds?.length) where.capabilityIds = { hasEvery: rule.capabilityIds };
  if (rule.type) where.type = rule.type as any;
  if (poolWhere && Object.keys(poolWhere).length > 0) (where as any).AND = [poolWhere];
  // 只有 relax-difficulty 才去掉难度条件；strict 与 relax-schemaRefs 的 where 相同
  if (level !== 'relax-difficulty' && rule.difficulty) where.difficulty = rule.difficulty as any;

  const rows = (await (tx as any).question.findMany({
    where,
    select: { id: true, score: true, difficulty: true, schemaRefs: true, answerRules: true },
    orderBy: { id: 'asc' }, // 稳定排序：同样候选集得到同样顺序（确定性前提）
  })) as SlotCandidate[];

  const wanted = rule.schemaRefs ? schemaRefsSignature(rule.schemaRefs) : '';
  return rows.filter(c => {
    if ((c.score ?? 0) !== slotScore) return false;
    if (usedQuestionIds?.has(c.id)) return false;
    // 引擎判不了的题不进任何一档：放宽的是结构与难度，不是"能不能自动判分"
    if (unsupportedRuleActions(c.answerRules).length > 0) return false;
    if (level === 'strict' && wanted) return schemaRefsSignature(c.schemaRefs) === wanted;
    return true;
  });
}

/**
 * 为单个抽题题位挑选题目。
 *
 * 严格优先、逐级放宽：
 *   1. 能力点全覆盖 + 难度/题型命中 + 分值一致 + schemaRefs 一致（默认路径）
 *   2. 放宽 schemaRefs（题库未维护引用声明时的兜底）
 *   3. 放宽难度
 * 每一级内部都排除「本卷已用过」的题目，避免同一份卷子出现重复题。
 * 候选枚举委托给 listSlotCandidates —— 与预检/修复共用同一入口，避免两套过滤断链。
 * 仍无可选则返回 null，由调用方记录待关注题位。
 */
async function pickQuestionForSlot(params: {
  examId: string;
  slotIndex: number;
  rule: SlotRule;
  slotScore: number;
  usedQuestionIds: Set<string>;
  /** 数据范围 P2：试卷归属决定的候选池条件；缺省（未绑卷/试卷已删）则不加 */
  poolWhere?: Record<string, any>;
  seed: string;
  tx: Prisma.TransactionClient;
}) {
  const { examId, slotIndex, rule, slotScore, usedQuestionIds, poolWhere, seed, tx } = params;

  const levels: CandidateLevel[] = ['strict', 'relax-schemaRefs', 'relax-difficulty'];
  for (const level of levels) {
    const pool = await listSlotCandidates({ rule, slotScore, level, usedQuestionIds, poolWhere, tx });
    if (pool.length > 0) {
      // ── 按「本场考试该题位已分配次数」均衡取材 ──
      // 纯随机抽在只有 3 道候选时会有约 1/3 的概率让两个学生撞题，
      // 而"每生不同"正是这个功能的目的。改为优先选**用得最少**的候选题：
      // 3 道候选配 3 个考生时每人恰好拿到不同的一道；同时保留种子哈希做同分并列时的
      // 稳定选择，保证同一学生重复生成得到同一结果。
      const usage = await tx.studentExamQuestion.groupBy({
        by: ['questionId'],
        where: { examId, slotIndex },
        _count: { _all: true },
      });
      const usedCount = new Map(usage.map(u => [u.questionId, u._count._all]));
      const minUsed = Math.min(...pool.map(c => usedCount.get(c.id) ?? 0));
      const leastUsed = pool.filter(c => (usedCount.get(c.id) ?? 0) === minUsed);
      return leastUsed[seededPickIndex(seed, leastUsed.length)];
    }
  }
  return null;
}

/**
 * 试卷编辑页用的候选池预览：教师能看到每个抽题题位有多少候选题。
 *
 * 候选题只有 1 道时必须显式提示 —— 否则"每生不同"会静默退化成"全员同题"，
 * 而教师毫不知情（这是本功能最容易无声失效的地方）。
 *
 * ⚠️ 抽题/预检要的"可用候选数"请用 `listSlotCandidates`：本函数的 candidateCount
 * 按**当前请求者**的可读池统计，且自带一套过滤；两者口径不同，别混用。
 */
export async function previewSlotCandidates(
  rule: SlotRule,
  slotScore: number,
  poolWhere?: Prisma.QuestionWhereInput,
) {
  const where: Prisma.QuestionWhereInput = { status: 'published' };
  if (rule.capabilityIds?.length) where.capabilityIds = { hasEvery: rule.capabilityIds };
  if (rule.type) where.type = rule.type as any;
  // 数据范围 P2：预览候选数按当前请求者的可读池（本院系 / 校级 / 本人 / 上架）统计，
  // 与试卷列表可见性同源。第三参可选：不传（旧调用/离线脚本）= 不收口，行为向后兼容。
  if (poolWhere && Object.keys(poolWhere).length > 0) {
    (where as any).AND = [poolWhere];
  }

  // 一次取全（不叠加难度条件），在同一份数据上算出两个口径：
  // ① 按 rule.difficulty 过滤后的候选池（单题位预览，原有语义）
  // ② 三个难度各自有多少「分值一致」的可用题（组卷规则行的 简单/中等/困难 数量框显示 /N）
  // 若拆成两次查询，两次之间题库变动会让两个数字对不上
  const fetched = await prisma.question.findMany({
    where,
    select: { id: true, title: true, type: true, difficulty: true, score: true, schemaRefs: true, capabilityIds: true, answerRules: true },
    orderBy: { id: 'asc' },
  });

  // 规则引擎判不了的题不算候选（与 pickQuestionForSlot 同一判断 unsupportedRuleActions）。
  // 预览的候选数必须与真实能抽到的数一致，否则教师看到"有 3 道候选"、开考却一道都抽不出来；
  // 后续所有统计（scoped/byScore/homogeneous/signatures/difficultyCounts）都基于过滤后的 rows。
  const rows = fetched.filter(r => unsupportedRuleActions(r.answerRules).length === 0);

  const scoped = rule.difficulty ? rows.filter(r => r.difficulty === rule.difficulty) : rows;
  const byScore = scoped.filter(r => (r.score ?? 0) === slotScore);
  const wanted = rule.schemaRefs ? schemaRefsSignature(rule.schemaRefs) : '';
  const homogeneous = wanted ? byScore.filter(r => schemaRefsSignature(r.schemaRefs) === wanted) : byScore;

  // 不同 schemaRefs 的候选题不能混用（学生各自表格结构不同），单独报出来
  const signatures = new Set(byScore.map(r => schemaRefsSignature(r.schemaRefs)));

  const difficultyCounts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  for (const r of rows) {
    if ((r.score ?? 0) !== slotScore) continue;
    if (r.difficulty in difficultyCounts) difficultyCounts[r.difficulty] += 1;
  }

  return {
    /** 真正可用于抽题的候选数 */
    candidateCount: homogeneous.length,
    /** 分值不匹配而被排除的数量（教师常见配置错误）。注意：**不含**因「引擎判不了」被滤掉的题
     *  ——那类题在统计前已剔除，candidateCount=0 且 excludedByScore=0 不代表题位配置没问题 */
    excludedByScore: scoped.length - byScore.length,
    /** 候选池内部 schemaRefs 不一致：需要教师收敛引用声明 */
    schemaRefsConflict: signatures.size > 1,
    /** 各难度可用题数（分值一致口径，不带难度过滤；组卷规则行数量框用） */
    difficultyCounts,
    candidates: homogeneous.slice(0, 20).map(r => ({
      id: r.id, title: r.title, type: r.type, difficulty: r.difficulty, score: r.score,
    })),
    /** 只有一道候选 = 全员同题（不算错误，但要明确告知） */
    warning: homogeneous.length === 0
      ? '没有候选题：该题位在开考时将无法抽题，请调整能力点/难度/分值'
      : homogeneous.length === 1
        ? '只有 1 道候选题：所有学生会拿到同一道题，无法实现"每人不同"'
        : null,
  };
}
