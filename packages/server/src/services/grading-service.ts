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

import { prisma } from '../config/prisma';
import { evaluateRules, type AnswerRule, type RuleResult, type SchemaResponse, type RecordData } from '../engine/rule-engine';
import { createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';

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

  // 1.5 WPS 实操考试可能没有提交答题详情，自动基于考试题目创建
  let details = submission.details;
  if (!details || details.length === 0) {
    const examQuestions = await prisma.examQuestion.findMany({
      where: { examId: submission.examId },
      include: {
        question: {
          select: {
            id: true,
            title: true,
            type: true,
            score: true,
            answerRules: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    if (examQuestions.length > 0) {
      await prisma.submissionDetail.createMany({
        data: examQuestions.map(eq => ({
          submissionId: submission.id,
          questionId: eq.questionId,
          answerJson: {},
          score: null,
          isCorrect: null,
        })),
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
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    }
  }

  // 2. 获取 Schema
  let schema: SchemaResponse;
  let autoGraded = false;
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

  // 如果外部传入了 accessToken，注入到 spaceId 中
  if (accessToken && effectiveSpaceId) {
    const fileId = effectiveSpaceId.split(':')[0];
    effectiveSpaceId = `${fileId}:${accessToken}`;
  }

  const adapter = createAdapterFromSpaceId(effectiveSpaceId);

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

  if (tablesNeedingRecords.size > 0) {
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
            const fields = await adapter.getFormFields(sheet.id, targetForm.id);
            formFieldsData.set(cacheKey, fields);
          }
          // 将表单字段数据注入规则params中，供rule-engine使用
          rule.params.formFields = formFieldsData.get(cacheKey);
        }
      }
    }
  }

  // 3. 逐题判分
  const questionResults: QuestionGradingResult[] = [];
  let totalScore = 0;
  let maxScore = 0;
  let totalNeedsReview = 0;

  for (const detail of details) {
    const rules = detail.question.answerRules as unknown as AnswerRule[];
    if (!rules || rules.length === 0) continue;

    const { totalScore: qScore, maxScore: qMaxScore, results } = evaluateRules(schema, rules, recordData);

    const needsReviewCount = results.filter(r => r.needsReview).length;
    totalNeedsReview += needsReviewCount;

    // 写入 VerificationResult 到数据库
    await prisma.verificationResult.createMany({
      data: results.map(r => ({
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
    });

    // 计算该题得分（有 needsReview 的规则不计入自动得分）
    const autoScore = results.reduce((sum, r) => sum + (r.passed && !r.needsReview ? r.score : 0), 0);
    const isCorrect = results.every(r => r.passed) && needsReviewCount === 0;

    // 更新 SubmissionDetail 的分数
    await prisma.submissionDetail.update({
      where: { id: detail.id },
      data: {
        score: needsReviewCount === 0 ? autoScore : null, // 有待复核项时不自动设分
        isCorrect: needsReviewCount === 0 ? isCorrect : null,
      },
    });

    questionResults.push({
      detailId: detail.id,
      questionId: detail.question.id,
      questionTitle: detail.question.title,
      score: autoScore,
      maxScore: qMaxScore,
      isCorrect,
      ruleResults: results,
      needsReviewCount,
    });

    totalScore += autoScore;
    maxScore += qMaxScore;
  }

  // 4. 如果没有 needsReview 项，自动完成评分
  const hasNeedsReview = totalNeedsReview > 0;

  if (!hasNeedsReview) {
    await prisma.studentSubmission.update({
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
    await prisma.studentSubmission.update({
      where: { id: submissionId },
      data: {
        status: 'grading',
        graderComment: `自动判分完成，有 ${totalNeedsReview} 条规则需人工复核`,
      },
    });
  }

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
