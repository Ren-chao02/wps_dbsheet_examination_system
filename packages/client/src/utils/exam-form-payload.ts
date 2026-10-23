/**
 * 考试表单提交 payload 的构造（纯函数，便于单测）。
 *
 * 为什么单独抽出来：编辑页加载时会把 paperId 回显进表单，保存时若原样回传，
 * 「只改标题」也会带着加载时的旧 paperId 覆盖别人并发换上的新卷（lost-update）。
 * 因此编辑态下 paperId 未变化就不回传 —— 服务端只在显式提供时才写该字段。
 */
export function buildExamPayload(values: any, existingExam: any | null, isEdit: boolean) {
  const payload: any = {
    ...values,
    durationMinutes: values.durationMinutes ?? null,
    passScore: values.passScore ?? null,
    startTime: values.startTime ? values.startTime.toISOString() : null,
    endTime: values.endTime ? values.endTime.toISOString() : null,
    settings: {
      ...(typeof existingExam?.settings === 'object' && existingExam?.settings !== null ? existingExam.settings : {}),
      shuffleQuestions: values.shuffleQuestions === true,
      earliestSubmitMinutes: values.earliestSubmitMinutes || 0,
    },
  };
  delete payload.shuffleQuestions;
  // 表单总会回显加载时的 paperId；编辑时未变化就不回传，避免覆盖并发换卷
  if (isEdit && (values.paperId || null) === (existingExam?.paperId ?? null)) {
    delete payload.paperId;
  } else {
    payload.paperId = values.paperId || null;
  }
  return payload;
}
