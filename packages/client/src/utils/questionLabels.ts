/**
 * 题型中文标签与分组的唯一来源（实操 5 种 + 客观 3 种）。
 *
 * 之前 PaperEditor / ExamEntrySteps 各自维护了一份字典，且叫法已经漂移
 * （教师端「创建数据表/综合实操」vs 学生端「创建表格/综合操作」），
 * 统一收敛到这里：以题目编辑器（QuestionEditor，出题时的权威命名）为准。
 *
 * 消费方：PaperEditor（抽题条件展示）、ExamEntrySteps（卷面题型介绍）、
 * WpsExamDoing（答题卡分组）。
 */

export const QUESTION_TYPE_LABELS: Record<string, string> = {
  create_table: '创建数据表',
  add_field: '添加字段',
  config_view: '配置视图',
  create_form: '创建表单',
  comprehensive: '综合实操',
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
};

export function questionTypeLabel(type: string): string {
  return QUESTION_TYPE_LABELS[type] || type;
}

/** 客观题题型（单选/多选/判断）：作答是选选项，不走判分规则编辑器 */
export const OBJECTIVE_QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false'];

export function isObjectiveQuestionType(type?: string | null): boolean {
  return !!type && OBJECTIVE_QUESTION_TYPES.includes(type);
}

/** 单选题/多选题/判断题（判断题的选项就是「正确/错误」两项，编辑器预填） */
export const OBJECTIVE_TYPE_OPTIONS = OBJECTIVE_QUESTION_TYPES.map((value) => ({
  value,
  label: QUESTION_TYPE_LABELS[value],
}));

/** 中文序号（答题卡分组标题「一、二、…」）：超出 20 回退为阿拉伯数字 */
const CN_DIGITS = '一二三四五六七八九十';
export function toChineseIndex(index: number): string {
  if (index < 1 || index > 20) return String(index);
  if (index <= 10) return CN_DIGITS[index - 1];
  return index === 20 ? '二十' : `十${CN_DIGITS[index - 11]}`;
}

export interface QuestionTypeGroup<T> {
  type: string;
  label: string;
  questions: T[];
  totalScore: number;
}

/**
 * 按题型把有序题目分组，保持题型在卷面中首次出现的顺序。
 * 分值口径与 ExamEntrySteps 一致：score || scoreOverride || 0。
 */
export function groupByQuestionType<
  T extends { type: string; score?: number | null; scoreOverride?: number | null },
>(questions: T[]): QuestionTypeGroup<T>[] {
  const map = new Map<string, QuestionTypeGroup<T>>();
  for (const q of questions) {
    const type = q.type || 'comprehensive';
    let group = map.get(type);
    if (!group) {
      group = { type, label: questionTypeLabel(type), questions: [], totalScore: 0 };
      map.set(type, group);
    }
    group.questions.push(q);
    group.totalScore += q.score || q.scoreOverride || 0;
  }
  return Array.from(map.values());
}
