/**
 * GradingService — 自动判分核心调度服务
 *
 * 职责：
 * 1. 加载答卷 + 题目 + 验证规则
 * 2. 通过 KingsoftAdapter 获取学生表格 Schema
 * 3. 调用规则引擎逐题判分
 * 4. 将验证结果写入数据库
 * 5. 汇总每题得分
 *
 * 必须提供有效的 WPS access_token 才能判分，缺少时直接抛出错误。
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { evaluateRules, type AnswerRule, type RuleResult, type SchemaResponse, type RecordData } from '../engine/rule-engine';
import { gradeObjectiveQuestion, isObjectiveType } from '../engine/objective-grader';
import { createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';
import { wpsConfigService } from './wps-config-service';

// ============================================================
// 类型定义
// ============================================================

export interface GradingResult {
  submissionId: string;
  totalScore: number;
  maxScore: number;
  questionResults: QuestionGradingResult[];
  hasNeedsReview: boolean;
  needsReviewCount: number;
  autoGraded: boolean;
  rawSchema?: any;
  rawRecords?: any;
  error?: string;
}

export interface QuestionGradingResult {
  detailId: string;
  questionId: string;
  questionTitle: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  ruleResults: RuleResult[];
  needsReviewCount: number;
}

// ============================================================
// 核心判分函数
// ============================================================

/**
 * 对单份答卷执行自动判分
 */

/**
 * 取「该生实际拿到的卷子条目」（questionId + 该题分值）。
 *
 * 优先级：每生卷子快照 > 考试题位。
 * 后者是给本轮抽题组卷上线**之前**已开考的答卷兜底（那时没有快照），
 * rule 题位没有固定题目，跳过。
 */
async function loadStudentPaperItems(
  examId: string,
  studentId: string,
): Promise<Array<{ questionId: string; score: number }>> {
  const paper = await prisma.studentExamQuestion.findMany({
    where: { examId, studentId },
    select: { questionId: true, score: true },
  });
  if (paper.length > 0) return paper;

  const slots = await prisma.examQuestion.findMany({
    where: { examId },
    select: { questionId: true, scoreOverride: true, question: { select: { score: true } } },
  });
  return slots
    .filter(s => !!s.questionId && !!s.question)
    .map(s => ({ questionId: s.questionId as string, score: s.scoreOverride ?? s.question!.score }));
}

export async function gradeSubmission(submissionId: string, accessToken?: string): Promise<GradingResult> {
  // 1. 加载答卷及关联数据
  const submission = await prisma.studentSubmission.findUnique({
    where: { id: submissionId },
    include: {
      details: {
        include: {
          question: {
            select: {
              id: true,
              title: true,
              type: true,
              score: true,
              answerRules: true,
              // 客观题判分要用标准答案（判分服务端内部使用，不会下发学生）
              objectiveAnswer: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!submission) {
    throw new Error(`答卷不存在: ${submissionId}`);
  }

  // 1.4 构建「题目实际满分」映射：规则分是 0~100 的权重（百分制），
  // 而本题在本次考试中的分值 = scoreOverride ?? question.score（如 10 分），
  // 落库前需按题目分值换算，否则会出现"每题 10 分却记 100 分"的错误总分。
  const examMaxPoints = new Map<string, number>();
  {
    // 以「该生实际拿到的卷子」为准：抽题组卷下每人题目不同、分值也不同，
    // 用考试题位算会算错别人的卷子分
    for (const row of await loadStudentPaperItems(submission.examId, submission.studentId)) {
      examMaxPoints.set(row.questionId, row.score);
    }
  }

  // 1.5 WPS 实操考试可能没有提交答题详情，自动基于考试题目创建
  let details = submission.details;
  if (!details || details.length === 0) {
    // 同样按该生卷子快照补建明细（而不是按考试题位——题位可能没有固定题目）
    const paperItems = await loadStudentPaperItems(submission.examId, submission.studentId);
    if (paperItems.length > 0) {
      await prisma.submissionDetail.createMany({
        data: paperItems.map(item => ({
          submissionId: submission.id,
          questionId: item.questionId,
          answerJson: {},
          score: null,
          isCorrect: null,
        })),
        skipDuplicates: true,
      });

      details = await prisma.submissionDetail.findMany({
        where: { submissionId: submission.id },
        include: {
          question: {
            select: {
              id: true,
              title: true,
              type: true,
              score: true,
              answerRules: true,
              // 客观题判分要用标准答案（判分服务端内部使用，不会下发学生）
              objectiveAnswer: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    }
  }

  // 2. 获取 Schema
  let schema: SchemaResponse;
  // 不设初值：下面 if/else 两个分支必然赋值（实操题读 WPS schema、纯客观题填空 schema）
  let autoGraded: boolean;
  let recordData: RecordData | undefined;

  // 回退：tableSpaceId 为空时，从 ExamTableAssignment 获取
  let effectiveSpaceId = submission.tableSpaceId;
  if (!effectiveSpaceId) {
    const assignment = await prisma.examTableAssignment.findUnique({
      where: {
        examId_studentId: {
          examId: submission.examId,
          studentId: submission.studentId,
        },
      },
    });
    if (assignment) {
      effectiveSpaceId = assignment.fileId;
    }
  }

  // Token 取用顺序：显式传入 > 系统当前（自动刷新）> tableSpaceId 里的历史快照。
  //
  // ⚠️ 这里曾经只用「显式传入」和「快照」两个来源：前端不传 token 时就会拿
  // 分配当时的快照去调 WPS —— 那个 token 24 小时即失效，表现为"判分报 token 过期，
  // 但 WPS Token 管理里明明是好的"。系统当前 token 由 wps-config-service 定时刷新，
  // 是唯一可靠的来源，必须优先取用。
  if (effectiveSpaceId) {
    const fileId = effectiveSpaceId.split(':')[0];
    const liveToken = accessToken || (await wpsConfigService.getValidAccessToken()) || undefined;
    if (liveToken) {
      effectiveSpaceId = `${fileId}:${liveToken}`;
    }
  }

  // 卷子里是否含实操题：**只考客观题的考试不该要求 WPS 表格**，
  // 也不该因为"没有表格/没有 token"而判不了分（客观题判分完全离线）。
  const hasHandsOn = details.some(d => !isObjectiveType(d.question.type));

  let adapter: ReturnType<typeof createAdapterFromSpaceId> = null;
  if (hasHandsOn) {
    adapter = createAdapterFromSpaceId(effectiveSpaceId);
    if (!adapter) {
      const tableSpaceIdParts = (effectiveSpaceId || '').split(':');
      const hasToken = tableSpaceIdParts.length >= 2 && tableSpaceIdParts[1];
      const reason = hasToken
        ? 'WPS API 连接失败，无法创建适配器'
        : '缺少有效的 WPS access_token，无法获取考生多维表格数据';
      throw new Error(reason);
    }

    // 真实 API 模式
    schema = await adapter.getSchema();
    autoGraded = true;
  } else {
    // 纯客观题：给一个空 Schema 占位（客观题分支不读它），避免下游 null 判断散落各处
    schema = { result: 0, detail: { sheets: [] } };
    autoGraded = true;
  }

  // 检查是否有记录类规则，若有则预获取记录数据
  const allRules = details.flatMap(
    d => (d.question.answerRules as unknown as AnswerRule[]) || []
  );
  const recordActions = new Set(['check_record_exists', 'check_record_value', 'check_record_count', 'check_record_value_exact']);
  const tablesNeedingRecords = new Set<string>();
  for (const rule of allRules) {
    if (recordActions.has(rule.action) && rule.params.tableName) {
      tablesNeedingRecords.add(rule.params.tableName);
    }
  }

  if (tablesNeedingRecords.size > 0 && adapter) {
    recordData = {};
    for (const tableName of tablesNeedingRecords) {
      const result = await adapter.getRecordsByTableName(tableName);
      recordData[tableName] = {
        records: result.records,
        fieldsSchema: result.fieldsSchema,
      };
    }
  }

  // 检查是否有表单字段规则，若有则预获取表单字段数据
  const formFieldActions = new Set(['check_form_fields', 'check_form_field_required']);
  const formFieldsData = new Map<string, any[]>();
  for (const rule of allRules) {
    if (formFieldActions.has(rule.action) && rule.params.tableName) {
      const sheet = schema.detail.sheets.find(s => s.name === rule.params.tableName);
      if (sheet) {
        const formViews = (sheet.views || []).filter(v => v.type === 'Form');
        const targetForm = rule.params.formName
          ? formViews.find(v => v.name === rule.params.formName)
          : formViews[0];
        if (targetForm) {
          const cacheKey = `${rule.params.tableName}:${targetForm.id}`;
          if (!formFieldsData.has(cacheKey)) {
            // 该分支只在有实操题时进入（hasHandsOn 为真则 adapter 必非空）
            const fields = await adapter!.getFormFields(sheet.id, targetForm.id);
            formFieldsData.set(cacheKey, fields);
          }
          // 将表单字段数据注入规则params中，供rule-engine使用
          rule.params.formFields = formFieldsData.get(cacheKey);
        }
      }
    }
  }

  // 3. 逐题判分（纯计算，结果先在内存中累积；DB 写入统一放入下方事务）
  const questionResults: QuestionGradingResult[] = [];
  const detailWrites: Array<{
    detailId: string;
    rows: Prisma.VerificationResultCreateManyInput[];
    score: number | null;
    isCorrect: boolean | null;
    /** 判分时的规则快照（存档用）：题目规则日后被改也能复现"当时按什么规则判的" */
    gradedWith: Prisma.InputJsonValue;
  }> = [];
  let totalScore = 0;
  let maxScore = 0;
  let totalNeedsReview = 0;

  for (const detail of details) {
    const qMaxPointsForType = examMaxPoints.get(detail.question.id) ?? detail.question.score ?? 0;

    // ── 客观题：走独立判分器（不读 WPS 表格、不依赖规则引擎）──
    if (isObjectiveType(detail.question.type)) {
      // 学生作答存在 SubmissionDetail.answerJson.answer（单选/判断为 string，多选为 string[]）
      const rawAnswer = (detail.answerJson as any)?.answer;
      const obj = gradeObjectiveQuestion(
        detail.question.type,
        detail.question.objectiveAnswer as any,
        rawAnswer,
        qMaxPointsForType,
      );

      questionResults.push({
        detailId: detail.id,
        questionId: detail.question.id,
        questionTitle: detail.question.title,
        score: obj.score,
        maxScore: obj.maxScore,
        isCorrect: obj.isCorrect,
        ruleResults: obj.ruleResults,
        needsReviewCount: obj.ruleResults.filter((r) => r.needsReview).length,
      });

      totalScore += obj.score;
      maxScore += obj.maxScore;
      if (obj.ruleResults.some((r) => r.needsReview)) totalNeedsReview += 1;

      detailWrites.push({
        detailId: detail.id,
        gradedWith: {
          gradedAt: new Date().toISOString(),
          source: 'objective',
          questionType: detail.question.type,
          correct: (detail.question.objectiveAnswer as any)?.correct ?? null,
          note: obj.note ?? null,
        } as Prisma.InputJsonValue,
        // 客观题不产生 VerificationResult（那是规则引擎逐规则比对的产物），
        // 判分依据完整写在 gradedWith 里
        rows: [],
        score: obj.score,
        isCorrect: obj.isCorrect,
      });
      continue;
    }

    const rules = detail.question.answerRules as unknown as AnswerRule[];
    if (!rules || rules.length === 0) continue;

    const { maxScore: qMaxScore, results } = evaluateRules(schema, rules, recordData);

    const needsReviewCount = results.filter(r => r.needsReview).length;
    totalNeedsReview += needsReviewCount;

    // 计算该题规则总分（百分制，范围 0~qMaxScore，qMaxScore=全部规则分之和，通常为 100）
    const rawAutoScore = results.reduce((sum, r) => sum + (r.passed && !r.needsReview ? r.score : 0), 0);
    const isCorrect = results.every(r => r.passed) && needsReviewCount === 0;

    // 把规则百分制换算为该题的实际分值：
    // 本题满分 = scoreOverride ?? question.score（如 10 分）
    // autoScore = rawAutoScore / qMaxScore * 本题满分，例如规则满分 100、全对 → 本题 10 分
    const qMaxPoints = examMaxPoints.get(detail.question.id) ?? detail.question.score ?? 0;
    const autoScore = needsReviewCount === 0 && qMaxPoints > 0 && qMaxScore > 0
      ? Math.round((rawAutoScore / qMaxScore) * qMaxPoints)
      : rawAutoScore;

    questionResults.push({
      detailId: detail.id,
      questionId: detail.question.id,
      questionTitle: detail.question.title,
      score: autoScore,
      maxScore: qMaxPoints,
      isCorrect,
      ruleResults: results,
      needsReviewCount,
    });

    totalScore += autoScore;
    maxScore += qMaxPoints;

    detailWrites.push({
      detailId: detail.id,
      gradedWith: {
        gradedAt: new Date().toISOString(),
        source: 'auto',
        // 题目规则快照：只存判分需要的字段，避免把整个 question 塞进 JSON
        rules: rules.map(r => ({ id: r.id, action: r.action, params: r.params, score: r.score })),
        ruleScoreTotal: qMaxScore,
        questionScore: qMaxPoints,
      } as Prisma.InputJsonValue,
      rows: results.map(r => ({
        submissionDetailId: detail.id,
        submissionId: submission.id,
        ruleId: r.ruleId,
        action: r.action,
        expected: r.expected as any,
        actual: r.actual as any,
        passed: r.passed,
        score: r.score,
        errorMessage: r.errorMessage || null,
        needsReview: r.needsReview,
      })),
      score: needsReviewCount === 0 ? autoScore : null, // 有待复核项时不自动设分
      isCorrect: needsReviewCount === 0 ? isCorrect : null,
    });
  }

  // 4. 统一在单个事务中落库：
  // - 判分链路有多次写入，且 BullMQ 失败会重试（attempts:3），必须幂等：
  //   先清理上次运行可能残留的判分结果与明细分数，防止重试时重复累计
  // - 必须原子：中途失败不留半套判分数据
  const hasNeedsReview = totalNeedsReview > 0;

  await prisma.$transaction(async (tx) => {
    await tx.verificationResult.deleteMany({ where: { submissionId: submission.id } });
    await tx.submissionDetail.updateMany({
      where: { submissionId: submission.id },
      data: { score: null, isCorrect: null },
    });

    for (const w of detailWrites) {
      await tx.verificationResult.createMany({ data: w.rows });
      await tx.submissionDetail.update({
        where: { id: w.detailId },
        data: { score: w.score, isCorrect: w.isCorrect, gradedWith: w.gradedWith },
      });
    }

    if (!hasNeedsReview) {
      await tx.studentSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'graded',
          totalScore,
          gradedAt: new Date(),
          graderComment: '自动判分完成',
        },
      });
    } else {
      // 有待复核项，保持 grading 状态等待教师复核
      await tx.studentSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'grading',
          graderComment: `自动判分完成，有 ${totalNeedsReview} 条规则需人工复核`,
        },
      });
    }
  }, { timeout: 30_000 });

  return {
    submissionId,
    totalScore,
    maxScore,
    questionResults,
    hasNeedsReview,
    needsReviewCount: totalNeedsReview,
    autoGraded,
    rawSchema: schema,
    rawRecords: recordData,
  };
}

/**
 * 批量判分：对某场考试的所有已提交答卷执行自动判分
 */
export async function gradeExamSubmissions(examId: string, accessToken?: string): Promise<{
  total: number;
  success: number;
  failed: number;
  results: GradingResult[];
  errors: { submissionId: string; error: string }[];
}> {
  const submissions = await prisma.studentSubmission.findMany({
    where: { examId, status: 'submitted' },
    select: { id: true },
  });

  const results: GradingResult[] = [];
  const errors: { submissionId: string; error: string }[] = [];

  for (const sub of submissions) {
    try {
      const result = await gradeSubmission(sub.id, accessToken);
      results.push(result);
    } catch (err: any) {
      errors.push({ submissionId: sub.id, error: err.message });
    }
  }

  return {
    total: submissions.length,
    success: results.length,
    failed: errors.length,
    results,
    errors,
  };
}
