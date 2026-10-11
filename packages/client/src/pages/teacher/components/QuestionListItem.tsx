/**
 * 题库题干流列表项（题库管理页与试卷「选题」页共用）
 *
 * 借鉴参考产品「校本题库」的列表形态：题型/难度/状态标签行 → 题干 →
 * 客观题选项（A/B/C/D 各占一行）→ 元信息行（时间｜创建人｜引用次数）＋右侧操作。
 *
 * 客观题在列表里**不标注正确答案**（与参考产品一致）：答案在详情里看，
 * 避免教师浏览题库时被答案干扰，也避免列表截图外传变相泄题。
 */
import type { ReactNode } from 'react';
import { Tag } from 'antd';
import dayjs from 'dayjs';
import type { Question } from '../../../types';
import { questionTypeLabel, isObjectiveQuestionType } from '../../../utils/questionLabels';

const DIFFICULTY_LABELS: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' };

export function QuestionListItem({ question, actions }: {
  question: Question;
  actions?: ReactNode;
}) {
  const isObjective = isObjectiveQuestionType(question.type);
  const options = isObjective ? question.objectiveAnswer?.options ?? [] : [];
  const counts = (question as any)._count as { paperQuestions?: number; examQuestions?: number } | undefined;
  const inPapers = counts?.paperQuestions ?? 0;
  const inExams = counts?.examQuestions ?? 0;

  return (
    <div className="qflow-item">
      {/* 标签行：题型 / 难度 / 状态 / 分类 —— 对齐参考产品「单选题 | 简单 | 启用」 */}
      <div className="qflow-head">
        <Tag color="blue">{questionTypeLabel(question.type)}</Tag>
        <i className="qflow-sep" />
        <span className="qflow-plain">{DIFFICULTY_LABELS[question.difficulty] || question.difficulty}</span>
        <i className="qflow-sep" />
        <Tag color={question.status === 'published' ? 'success' : 'default'}>
          {question.status === 'published' ? '启用' : '禁用'}
        </Tag>
        {question.source === 'official' && <Tag color="orange">官方</Tag>}
        {question.primaryCategory && <Tag>{question.primaryCategory.name}</Tag>}
        {question.secondaryCategory && <Tag>{question.secondaryCategory.name}</Tag>}
      </div>

      <div className="qflow-body">
        {/* 标题是列表识别用的短名；题干（description）是真正给学生看的内容，两者有则都显示 */}
        {question.title && <div className="qflow-title">{question.title}</div>}
        {question.description && <div className="qflow-stem">{question.description}</div>}
        {options.length > 0 && (
          <div className="qflow-options">
            {options.map((o) => (
              <div key={o.key}>{o.key}. {o.text}</div>
            ))}
          </div>
        )}
        {question.hints && <div className="qflow-hint">提示：{question.hints}</div>}
      </div>

      <div className="qflow-meta">
        <span className="qflow-meta-left">
          <span>{dayjs(question.updatedAt).format('YYYY-MM-DD HH:mm')}</span>
          <i>｜</i><span>{question.creator?.realName || question.teacherName || (question.source === 'official' ? '官方题库' : '未知')}</span>
          <i>｜</i><span>分值 {question.score}</span>
          <i>｜</i><span>试卷引用 {inPapers} 次</span>
          <i>｜</i><span>考试引用 {inExams} 次</span>
        </span>
        {actions && <span className="qflow-actions">{actions}</span>}
      </div>
    </div>
  );
}
