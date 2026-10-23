/** 「已开考」状态集合：这些提交一旦存在，对应学生的卷子快照绝不能再动 */
export const STARTED_SUBMISSION_STATUSES = ['in_progress', 'submitted', 'grading', 'graded'] as const;
