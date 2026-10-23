/**
 * buildExamPayload 纯函数测试 — 编辑考试时的回传口径。
 *
 * 核心约束：表单总会回显加载时的 paperId，编辑时未变化就不回传，
 * 否则「只改标题」的保存会用旧 paperId 覆盖并发换上的新卷（lost-update）。
 */
import { describe, it, expect } from 'vitest';
import { buildExamPayload } from '../exam-form-payload';

const values = {
  title: '考试', paperId: 'p-1',
  startTime: null, endTime: null,
  shuffleQuestions: true, earliestSubmitMinutes: 5,
};

describe('buildExamPayload', () => {
  it('编辑且 paperId 未变化 → 不回传 paperId', () => {
    const p = buildExamPayload(values, { paperId: 'p-1', settings: {} }, true);
    expect(p).not.toHaveProperty('paperId');
  });

  it('编辑且 paperId 变化 → 回传新值', () => {
    const p = buildExamPayload({ ...values, paperId: 'p-2' }, { paperId: 'p-1', settings: {} }, true);
    expect(p.paperId).toBe('p-2');
  });

  it('创建 → 回传 paperId', () => {
    const p = buildExamPayload(values, null, false);
    expect(p.paperId).toBe('p-1');
  });

  it('编辑且未绑定试卷、表单也未选卷 → 不回传（null === null）', () => {
    const p = buildExamPayload({ ...values, paperId: null }, { paperId: null, settings: {} }, true);
    expect(p).not.toHaveProperty('paperId');
  });

  it('保留既有 settings，仅覆盖表单管理的两项', () => {
    const p = buildExamPayload(values, { paperId: 'p-1', settings: { antiCheat: true } }, true);
    expect(p.settings).toEqual({
      antiCheat: true,
      shuffleQuestions: true,
      earliestSubmitMinutes: 5,
    });
    // shuffleQuestions 只进 settings，不再作为顶层字段提交
    expect(p).not.toHaveProperty('shuffleQuestions');
  });

  it('时间序列化为 ISO 字符串，空值保持 null', () => {
    const start = new Date('2026-11-01T09:00:00.000Z');
    const p = buildExamPayload({ ...values, startTime: start }, null, false);
    expect(p.startTime).toBe('2026-11-01T09:00:00.000Z');
    expect(p.endTime).toBeNull();
  });
});
