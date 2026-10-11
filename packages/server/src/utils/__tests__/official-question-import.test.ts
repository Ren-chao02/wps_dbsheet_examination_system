/**
 * 官方题库导入纯逻辑测试
 *
 * 锁住三类容易踩坑的边界：品牌中性化顺序（先整词后兜底）、
 * 答案解析的多种原始写法、构建时的答案/选项一致性校验。
 */
import { describe, it, expect } from 'vitest';
import {
  neutralizeBrand, parseSingleChoiceAnswer, parseMultipleChoiceAnswer,
  parseTrueFalseAnswer, buildOfficialQuestion, OBJECTIVE_SCORES,
} from '../official-question-import';

describe('neutralizeBrand — 品牌中性化', () => {
  it('「飞书多维表格」整体替换为「多维表格」', () => {
    expect(neutralizeBrand('飞书多维表格中，一张数据表最多可创建多少个视图？'))
      .toBe('多维表格中，一张数据表最多可创建多少个视图？');
    // 先整词后兜底：整体替换优先，不会被残留的「飞书」二次破坏
    expect(neutralizeBrand('飞书多维表格的飞书文档')).toBe('多维表格的文档');
  });

  it('其余「飞书」字样一并清掉（功能名保留）', () => {
    expect(neutralizeBrand('关联飞书通讯录成员')).toBe('关联通讯录成员');
    expect(neutralizeBrand('新增记录自动发飞书消息')).toBe('新增记录自动发消息');
    expect(neutralizeBrand('飞书公式中判断空白可用等号空字符串')).toBe('公式中判断空白可用等号空字符串');
    expect(neutralizeBrand('发送飞书提醒')).toBe('发送提醒');
  });

  it('空值与尾部空格处理', () => {
    expect(neutralizeBrand('')).toBe('');
    expect(neutralizeBrand('  飞书多维表格  ')).toBe('多维表格');
  });
});

describe('答案解析', () => {
  it('单选题：单字母（含小写/带点）', () => {
    expect(parseSingleChoiceAnswer('B')).toBe('B');
    expect(parseSingleChoiceAnswer('b.')).toBe('B');
    expect(() => parseSingleChoiceAnswer('1')).toThrow();
  });

  it('多选题：连写与顿号分隔两种格式，去重升序', () => {
    expect(parseMultipleChoiceAnswer('ABCDEFG')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect(parseMultipleChoiceAnswer('A、B、C')).toEqual(['A', 'B', 'C']);
    expect(parseMultipleChoiceAnswer('B、A、B')).toEqual(['A', 'B']);
    expect(() => parseMultipleChoiceAnswer('无')).toThrow();
  });

  it('判断题：√/× 与 正确/错误 四种写法都映射到 A/B', () => {
    expect(parseTrueFalseAnswer('√')).toBe('A');
    expect(parseTrueFalseAnswer('正确')).toBe('A');
    expect(parseTrueFalseAnswer('对')).toBe('A');
    expect(parseTrueFalseAnswer('×')).toBe('B');
    expect(parseTrueFalseAnswer('错误')).toBe('B');
    expect(() => parseTrueFalseAnswer('不知道')).toThrow();
  });
});

describe('buildOfficialQuestion — 构建与校验', () => {
  const base = {
    type: 'single_choice' as const,
    stem: '飞书多维表格中，一张数据表最多可创建多少个视图？',
    options: [
      { key: 'A', text: '50 个' },
      { key: 'B', text: '100 个' },
      { key: 'C', text: '无明确数量限制，受性能影响' },
      { key: 'D', text: '每个类型最多一个' },
    ],
    correct: ['C'],
    analysis: '多维表格对视图数量未做硬性限制。',
    knowledgePoint: '基础概念',
  };

  it('输出题目对象：title=题干、description 置空、source=official、published、默认分值', () => {
    const q = buildOfficialQuestion(base);
    expect(q.title).toBe('多维表格中，一张数据表最多可创建多少个视图？');
    expect(q.description).toBeNull();
    expect(q.source).toBe('official');
    expect(q.status).toBe('published');
    expect(q.difficulty).toBe('medium');
    expect(q.score).toBe(OBJECTIVE_SCORES.single_choice);
    expect(q.objectiveAnswer.correct).toEqual(['C']);
    expect(q.tags).toEqual(['基础概念']);
    expect(q.analysis).toContain('多维表格');
  });

  it('选项文本也做中性化，空选项被剔除', () => {
    const q = buildOfficialQuestion({
      ...base,
      type: 'multiple_choice',
      options: [
        { key: 'A', text: '关联飞书通讯录成员' },
        { key: 'B', text: '' },
        { key: 'C', text: '统计人数' },
      ],
      correct: ['A', 'C'],
    });
    expect(q.objectiveAnswer.options).toEqual([
      { key: 'A', text: '关联通讯录成员' },
      { key: 'C', text: '统计人数' },
    ]);
  });

  it('答案不在选项 / 单选多答案 / 空题干 都会被拦下', () => {
    expect(() => buildOfficialQuestion({ ...base, correct: ['G'] })).toThrow('不在选项中');
    expect(() => buildOfficialQuestion({ ...base, correct: ['A', 'B'] })).toThrow('只能有 1 个正确项');
    expect(() => buildOfficialQuestion({ ...base, stem: '  ' })).toThrow('题干为空');
  });

  it('超长题干（>512）把全文放进 description 兜底', () => {
    const longStem = '题干'.repeat(300); // 600 字
    const q = buildOfficialQuestion({ ...base, stem: longStem });
    expect(q.description).toBe(longStem);
    expect(q.title.length).toBeLessThanOrEqual(512);
    expect(q.title.endsWith('…')).toBe(true);
  });
});
