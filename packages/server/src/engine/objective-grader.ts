/**
 * 客观题判分器（单选 / 多选 / 判断）
 *
 * 与 rule-engine 并列的第二条判分路径：
 *   - rule-engine：读 WPS 表格 Schema，判「实操题」
 *   - objective-grader：读学生提交的选项，判「客观题」
 * 二者互不影响，判分入口（services/grading-service）按 question.type 分流。
 *
 * 设计约束（与实操题一致）：
 *   - 纯函数：不依赖数据库、不发网络请求，输入齐了就出结果
 *   - 确定性：没有"部分给分"的模糊地带，也没有依赖模型判断的环节
 *     （多选按「完全一致」计分——少选/多选/错选都不得分。这是学校的常见口径，
 *      也避免了"少选给了几分"这类需要解释的争议）
 */

export interface ObjectiveOption {
  key: string;   // 选项标识：A / B / C …
  text: string;
}

export interface ObjectiveAnswer {
  /** 选项列表（判断题也用它，约定 A=正确 / B=错误） */
  options: ObjectiveOption[];
  /** 正确答案的选项 key 列表；单选/判断恰好一个，多选一个或多个 */
  correct: string[];
}

export interface ObjectiveGradeResult {
  score: number;
  maxScore: number;
  isCorrect: boolean;
  /** 供教师端/成绩页展示明细，与规则引擎的 RuleResult 结构对齐 */
  ruleResults: Array<{
    ruleId: string;
    action: string;
    passed: boolean;
    score: number;
    maxScore: number;
    expected: unknown;
    actual: unknown;
    errorMessage?: string;
    needsReview: boolean;
  }>;
  /** 判分口径说明，附在题目详情里便于申诉复核 */
  note?: string;
}

/** 学生作答的原始形态：单选/判断是 string，多选是 string[] */
export type StudentObjectiveAnswer = string | string[] | null | undefined;

/** 统一把学生作答规整成 key 数组 */
export function normalizeStudentAnswer(answer: StudentObjectiveAnswer): string[] {
  if (answer === null || answer === undefined) return [];
  if (Array.isArray(answer)) {
    return Array.from(new Set(answer.map(String).map(s => s.trim()).filter(Boolean)));
  }
  const s = String(answer).trim();
  return s ? [s] : [];
}

function sameKeySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every(k => setB.has(k));
}

/**
 * 判一道客观题。
 *
 * @param type   Question.type（single_choice / multiple_choice / true_false）
 * @param answer 题目的正确答案（存于 Question.objectiveAnswer）
 * @param studentAnswer 学生提交的作答（存于 SubmissionDetail.answerJson）
 * @param maxScore 本题分值（考试可能用 scoreOverride 覆盖）
 */
export function gradeObjectiveQuestion(
  type: string,
  answer: ObjectiveAnswer | null | undefined,
  studentAnswer: StudentObjectiveAnswer,
  maxScore: number,
): ObjectiveGradeResult {
  const picked = normalizeStudentAnswer(studentAnswer);
  const correct = Array.isArray(answer?.correct) ? answer!.correct.map(String) : [];

  // 题目本身没有配置答案：判为 0 分并标记待人工复核，避免"老师漏配答案导致学生全 0"
  if (correct.length === 0) {
    return {
      score: 0,
      maxScore,
      isCorrect: false,
      ruleResults: [{
        ruleId: 'objective_missing_answer',
        action: 'check_objective_answer',
        passed: false,
        score: 0,
        maxScore,
        expected: null,
        actual: picked,
        errorMessage: '该题未配置正确答案，请教师核对题目设置',
        needsReview: true,
      }],
      note: '题目未配置正确答案',
    };
  }

  const isMulti = type === 'multiple_choice';
  const passed = isMulti ? sameKeySet(picked, correct) : picked.length === 1 && sameKeySet(picked, correct);

  // 未作答单独说明：与学生"选错了"区分开，便于教师复核与教学分析
  const errorMessage = passed
    ? undefined
    : picked.length === 0
      ? '未作答'
      : isMulti
        ? `作答与标准答案不完全一致（应选 ${correct.join('、')}，实选 ${picked.join('、')}）`
        : `选错（应选 ${correct.join('、')}，实选 ${picked.join('、')}）`;

  return {
    score: passed ? maxScore : 0,
    maxScore,
    isCorrect: passed,
    ruleResults: [{
      ruleId: 'objective_answer',
      action: type === 'multiple_choice'
        ? 'check_multiple_choice'
        : type === 'true_false'
          ? 'check_true_false'
          : 'check_single_choice',
      passed,
      score: passed ? maxScore : 0,
      maxScore,
      expected: correct,
      actual: picked,
      errorMessage,
      needsReview: false,
    }],
    note: isMulti ? '多选题按「与标准答案完全一致」计分，少选/多选/错选均不得分' : undefined,
  };
}

/** 判断某个题型是否走客观题判分 */
export function isObjectiveType(type: string): boolean {
  return type === 'single_choice' || type === 'multiple_choice' || type === 'true_false';
}
