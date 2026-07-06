/**
 * PracticeGradingService — 题库练习判分服务
 *
 * 职责（类比 grading-service.gradeSubmission，但读 PracticeRecord 而非 StudentSubmission）：
 * 1. 加载 PracticeRecord（含 questions 快照）+ 该学生的 PracticeTableAssignment
 * 2. 用 fileId:accessToken 建 adapter（复用 createAdapterFromSpaceId）
 * 3. 预取记录类/表单字段类规则所需数据
 * 4. 逐题 evaluateRules（与考试同一判分口径）
 * 5. 写回 PracticeRecord：score/maxScore/passed/details/status=graded/submittedAt
 *    判分失败保持 status=in_progress，不写回分数，便于学生重新提交
 * 6. 更新错题本 WrongQuestion
 * 7. 返回 { score, maxScore, passed, details(含 analysis) }
 *
 * 不复用 gradeSubmission：它绑死 ExamQuestion/SubmissionDetail/ExamTableAssignment，
 * 硬复用会引入考试耦合。但共享底层 evaluateRules + adapter，保证判分口径一致。
 */

import { prisma } from '../config/prisma';
import {
  evaluateRules,
  type AnswerRule,
  type RuleResult,
  type SchemaResponse,
  type RecordData,
} from '../engine/rule-engine';
import { createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';

// ============================================================
// 类型定义
// ============================================================

export interface PracticeQuestionSnapshot {
  questionId: string;
  score: number;
  sortOrder: number;
}

export interface PracticeQuestionResult {
  questionId: string;
  questionTitle: string;
  difficulty: string;
  type: string;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  ruleResults: RuleResult[];
  analysis: string | null;
}

export interface PracticeGradingResult {
  recordId: string;
  score: number;
  maxScore: number;
  passed: boolean;
  details: PracticeQuestionResult[];
}

// ============================================================
// 核心判分函数
// ============================================================

/**
 * 对一份练习记录执行判分
 * @param recordId PracticeRecord.id
 * @param accessToken 可选，外部注入的 WPS token（覆盖 record.tableSpaceId 中的 token）
 */
export async function gradePracticeRecord(
  recordId: string,
  accessToken?: string,
): Promise<PracticeGradingResult> {
  // 1. 加载练习记录
  const record = await prisma.practiceRecord.findUnique({
    where: { id: recordId },
  });

  if (!record) {
    throw new Error(`练习记录不存在: ${recordId}`);
  }

  const snapshots = (record.questions as unknown as PracticeQuestionSnapshot[]) || [];
  if (snapshots.length === 0) {
    throw new Error('练习记录无题目快照');
  }

  // 2. 加载题目（含 answerRules + analysis）
  const questions = await prisma.question.findMany({
    where: { id: { in: snapshots.map(s => s.questionId) } },
    select: {
      id: true,
      title: true,
      type: true,
      difficulty: true,
      score: true,
      answerRules: true,
      analysis: true,
    },
  });

  // 按 snapshot sortOrder 排序
  const questionMap = new Map(questions.map(q => [q.id, q]));
  const orderedQuestions = snapshots
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(s => ({ snapshot: s, question: questionMap.get(s.questionId) }))
    .filter((x): x is { snapshot: PracticeQuestionSnapshot; question: NonNullable<typeof x.question> } => !!x.question);

  // 3. 定位 WPS 文件
  // 优先 record.tableSpaceId，回退 PracticeTableAssignment
  let effectiveSpaceId = record.tableSpaceId;
  if (!effectiveSpaceId) {
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId: record.studentId },
    });
    if (assignment) {
      effectiveSpaceId = assignment.accessToken
        ? `${assignment.fileId}:${assignment.accessToken}`
        : assignment.fileId;
    }
  }

  // 外部注入 accessToken
  if (accessToken && effectiveSpaceId) {
    const fileId = effectiveSpaceId.split(':')[0];
    effectiveSpaceId = `${fileId}:${accessToken}`;
  }

  const adapter = createAdapterFromSpaceId(effectiveSpaceId);
  if (!adapter) {
    const parts = (effectiveSpaceId || '').split(':');
    const hasToken = parts.length >= 2 && parts[1];
    const reason = hasToken
      ? 'WPS API 连接失败，无法创建适配器'
      : '缺少有效的 WPS access_token，无法获取练习表格数据';
    throw new Error(reason);
  }

  // 4. 获取 Schema
  const schema: SchemaResponse = await adapter.getSchema();

  // 5. 预取记录类规则数据（与 gradeSubmission 同逻辑）
  const allRules = orderedQuestions.flatMap(
    x => (x.question.answerRules as unknown as AnswerRule[]) || [],
  );
  const recordActions = new Set([
    'check_record_exists', 'check_record_value',
    'check_record_count', 'check_record_value_exact',
  ]);
  const tablesNeedingRecords = new Set<string>();
  for (const rule of allRules) {
    if (recordActions.has(rule.action) && rule.params.tableName) {
      tablesNeedingRecords.add(rule.params.tableName);
    }
  }

  let recordData: RecordData | undefined;
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

  // 6. 预取表单字段类规则数据（与 gradeSubmission 同逻辑）
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
          rule.params.formFields = formFieldsData.get(cacheKey);
        }
      }
    }
  }

  // 7. 逐题判分
  // 注：练习无教师复核环节，needsReview 规则视为"未能自动验证"→不计分
  const details: PracticeQuestionResult[] = [];
  let totalScore = 0;
  let maxScore = 0;

  for (const { snapshot, question } of orderedQuestions) {
    const rules = (question.answerRules as unknown as AnswerRule[]) || [];
    if (rules.length === 0) {
      details.push({
        questionId: question.id,
        questionTitle: question.title,
        difficulty: question.difficulty,
        type: question.type,
        score: 0,
        maxScore: snapshot.score,
        isCorrect: false,
        ruleResults: [],
        analysis: question.analysis,
      });
      maxScore += snapshot.score;
      continue;
    }

    const { results } = evaluateRules(schema, rules, recordData);
    const needsReviewCount = results.filter(r => r.needsReview).length;
    // 仅 passed && !needsReview 的规则计入自动得分（与 gradeSubmission 口径一致）
    const qScore = results.reduce(
      (sum, r) => sum + (r.passed && !r.needsReview ? r.score : 0), 0,
    );
    const isCorrect = results.every(r => r.passed) && needsReviewCount === 0;

    details.push({
      questionId: question.id,
      questionTitle: question.title,
      difficulty: question.difficulty,
      type: question.type,
      score: qScore,
      maxScore: snapshot.score,
      isCorrect,
      ruleResults: results,
      analysis: question.analysis,
    });

    totalScore += qScore;
    maxScore += snapshot.score;
  }

  // 及格线：满分的 60%（练习无 passScore 字段，统一按 60% 判定）
  const passed = maxScore > 0 ? totalScore >= Math.ceil(maxScore * 0.6) : false;

  // 8. 写回 PracticeRecord
  await prisma.practiceRecord.update({
    where: { id: recordId },
    data: {
      score: totalScore,
      maxScore,
      passed,
      details: details as any,
      status: 'graded',
      submittedAt: new Date(),
    },
  });

  // 9. 更新错题本（错题 wrongCount+1，源标记为 practice）
  const wrong = details.filter(d => !d.isCorrect);
  for (const d of wrong) {
    await prisma.wrongQuestion.upsert({
      where: { studentId_questionId: { studentId: record.studentId, questionId: d.questionId } },
      update: {
        wrongCount: { increment: 1 },
        lastWrongAt: new Date(),
        sourceType: 'practice',
        sourceId: record.id,
      },
      create: {
        studentId: record.studentId,
        questionId: d.questionId,
        sourceType: 'practice',
        sourceId: record.id,
        lastWrongAt: new Date(),
      },
    });
  }

  return {
    recordId,
    score: totalScore,
    maxScore,
    passed,
    details,
  };
}
