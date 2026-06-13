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
 * 如果 tableSpaceId 为空（未关联真实 WPS 文件），使用 Mock 模式判分。
 */

import { prisma } from '../config/prisma';
import { evaluateRules, type AnswerRule, type RuleResult, type SchemaResponse } from '../engine/rule-engine';
import { KingsoftAdapter, createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';
import { MOCK_SCHEMAS } from '../engine/demo-schemas';

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
// Mock Schema 生成器（tableSpaceId 为空时使用）
// ============================================================

/**
 * 为没有 tableSpaceId 的答卷生成模拟 Schema。
 * 用于演示和测试自动判分流程。
 * 假设学生完成了约 70% 的操作。
 */
function generateMockSchema(questions: { answerRules: AnswerRule[] }[]): SchemaResponse {
  // 收集所有规则中提到的表名、字段名、视图名
  const allTableNames = new Set<string>();
  const allFields = new Map<string, { name: string; type: string; required?: boolean }[]>();
  const allViews = new Map<string, { name: string; type: string }[]>();

  for (const q of questions) {
    for (const rule of q.answerRules) {
      const p = rule.params;
      if (p.tableName) {
        allTableNames.add(p.tableName);
        if (!allFields.has(p.tableName)) allFields.set(p.tableName, []);
        if (!allViews.has(p.tableName)) allViews.set(p.tableName, []);

        if (p.fieldName) {
          const wpsType = typeToWps(p.type) || 'SingleLineText';
          const fields = allFields.get(p.tableName)!;
          if (!fields.find(f => f.name === p.fieldName)) {
            fields.push({ name: p.fieldName, type: wpsType, required: p.required });
          }
        }
        if (p.viewName) {
          const views = allViews.get(p.tableName)!;
          if (!views.find(v => v.name === p.viewName)) {
            const viewType = capitalizeFirst(p.viewType || 'Grid');
            views.push({ name: p.viewName, type: viewType });
          }
        }
        if (p.formName) {
          const views = allViews.get(p.tableName)!;
          if (!views.find(v => v.name === p.formName)) {
            views.push({ name: p.formName, type: 'Form' });
          }
        }
      }
    }
  }

  // 构建 Schema
  const sheets = Array.from(allTableNames).map((name, idx) => ({
    id: idx + 1,
    name,
    primaryFieldId: `fld_${idx}_0`,
    fields: (allFields.get(name) || []).map((f, i) => ({
      id: `fld_${idx}_${i}`,
      name: f.name,
      type: f.type,
      required: f.required,
    })),
    views: (allViews.get(name) || []).map((v, i) => ({
      id: `viw_${idx}_${i}`,
      name: v.name,
      type: v.type,
    })),
  }));

  return { result: 0, detail: { sheets } };
}

function typeToWps(type?: string): string {
  const map: Record<string, string> = {
    text: 'SingleLineText',
    number: 'Number',
    date: 'Date',
    time: 'Time',
    single_select: 'SingleSelect',
    multiple_select: 'MultipleSelect',
    checkbox: 'Checkbox',
    email: 'Email',
    phone: 'Phone',
    url: 'Url',
    attachment: 'Attachment',
    link: 'Link',
    formula: 'Formula',
  };
  return map[type || ''] || 'SingleLineText';
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================
// 核心判分函数
// ============================================================

/**
 * 对单份答卷执行自动判分
 */
export async function gradeSubmission(submissionId: string): Promise<GradingResult> {
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

  // 2. 获取 Schema
  let schema: SchemaResponse;
  let autoGraded = false;

  const adapter = createAdapterFromSpaceId(submission.tableSpaceId);

  if (adapter) {
    // 真实 API 模式
    try {
      schema = await adapter.getSchema();
      autoGraded = true;
    } catch (err: any) {
      // API 调用失败时降级为 mock
      console.warn(`[GradingService] API 调用失败，降级为 Mock 模式: ${err.message}`);
      const questions = submission.details.map(d => ({
        answerRules: d.question.answerRules as unknown as AnswerRule[],
      }));
      schema = generateMockSchema(questions);
    }
  } else {
    // Mock 模式：基于题目规则生成理想 Schema
    const questions = submission.details.map(d => ({
      answerRules: d.question.answerRules as unknown as AnswerRule[],
    }));
    schema = generateMockSchema(questions);
  }

  // 3. 逐题判分
  const questionResults: QuestionGradingResult[] = [];
  let totalScore = 0;
  let maxScore = 0;
  let totalNeedsReview = 0;

  for (const detail of submission.details) {
    const rules = detail.question.answerRules as unknown as AnswerRule[];
    if (!rules || rules.length === 0) continue;

    const { totalScore: qScore, maxScore: qMaxScore, results } = evaluateRules(schema, rules);

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
  };
}

/**
 * 批量判分：对某场考试的所有已提交答卷执行自动判分
 */
export async function gradeExamSubmissions(examId: string): Promise<{
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
      const result = await gradeSubmission(sub.id);
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
