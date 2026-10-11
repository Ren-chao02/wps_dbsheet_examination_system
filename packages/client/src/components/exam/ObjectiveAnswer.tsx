import { Alert, Checkbox, Radio } from 'antd';
import type { CSSProperties } from 'react';
import type { ObjectiveAnswerValue, ObjectiveOption, StudentExamQuestion } from '../../types';

/**
 * 客观题学生作答组件（单选 / 多选 / 判断）。
 *
 * 选项一律来自服务端下发（question.options，不含正确答案，见 server toStudentQuestion）：
 * 判断题的 A=正确 / B=错误 也由服务端给定，前端不硬编码。
 * 组件只负责「回显 + 交互」，自动保存的编排在页面层（WpsExamDoing）。
 */

/** 客观题题型集合（与 server engine/objective-grader.isObjectiveType 保持一致） */
export const OBJECTIVE_QUESTION_TYPES = ['single_choice', 'multiple_choice', 'true_false'] as const;

/** 判断某道题是否为客观题（页面渲染与答题卡状态共用） */
export function isObjectiveQuestion(type: string): boolean {
  return (OBJECTIVE_QUESTION_TYPES as readonly string[]).includes(type);
}

/** 判断一道客观题是否已作答：单选/判断有选项 key，多选至少选了一项 */
export function hasObjectiveAnswer(value: ObjectiveAnswerValue | undefined): boolean {
  if (value == null) return false;
  return value.length > 0;
}

/**
 * 从已保存的作答记录还原客观题答案（进入页面 / 刷新 / 断线重进时调用）。
 * 服务端存于 SubmissionDetail.answerJson.answer：单选/判断为 string，多选为 string[]。
 */
export function restoreObjectiveAnswers(
  details: Array<{ questionId: string; answerJson?: Record<string, any> }> | null | undefined,
): Record<string, ObjectiveAnswerValue> {
  const restored: Record<string, ObjectiveAnswerValue> = {};
  for (const d of details ?? []) {
    const raw: unknown = (d.answerJson ?? {})?.answer;
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'string') {
      restored[d.questionId] = raw;
    } else if (Array.isArray(raw)) {
      // 防御性过滤：老数据/异常数据里可能混入非字符串项，只保留 key
      restored[d.questionId] = raw.filter((k): k is string => typeof k === 'string');
    }
  }
  return restored;
}

interface ObjectiveAnswerProps {
  question: StudentExamQuestion;
  value: ObjectiveAnswerValue;
  disabled?: boolean;
  onChange: (value: ObjectiveAnswerValue) => void;
}

export function ObjectiveAnswer({ question, value, disabled, onChange }: ObjectiveAnswerProps) {
  const options: ObjectiveOption[] = question.options ?? [];
  // 选项字号与题干描述一致，保证读题节奏不跳
  const optionLabelStyle: CSSProperties = { fontSize: 15 };

  if (question.type === 'multiple_choice') {
    return (
      <div>
        {/* 多选题必须明示计分口径：与标准答案完全一致才得分 —— 学生最容易误以为少选能拿部分分 */}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="多选题：选择所有正确选项，按与标准答案完全一致计分（多选、少选、错选均不得分）"
        />
        <Checkbox.Group
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          onChange={(checked) => onChange(checked.map(String))}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {options.map((opt) => (
              <Checkbox key={opt.key} value={opt.key}>
                <span style={optionLabelStyle}>{opt.key}. {opt.text}</span>
              </Checkbox>
            ))}
          </div>
        </Checkbox.Group>
      </div>
    );
  }

  // 单选 / 判断共用 Radio.Group；已存答案若不在当前选项里（教师事后改过选项），
  // 回退为未选状态，避免 antd「value 不在 options」的异常回显
  const radioValue = typeof value === 'string' && options.some((o) => o.key === value) ? value : undefined;
  return (
    <Radio.Group value={radioValue} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {options.map((opt) => (
          <Radio key={opt.key} value={opt.key}>
            <span style={optionLabelStyle}>{opt.key}. {opt.text}</span>
          </Radio>
        ))}
      </div>
    </Radio.Group>
  );
}
