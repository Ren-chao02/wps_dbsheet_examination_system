import { describe, it, expect } from 'vitest';
import { extractMissingTable, friendlyRuleMessage } from '../rule-message';

describe('friendlyRuleMessage', () => {
  it('「未找到表」翻成学生能懂的话：保留表名 + 告诉他这是正常现象、先建它', () => {
    const msg = friendlyRuleMessage('未找到表「员工信息表」');
    expect(msg).toContain('员工信息表');
    expect(msg).toContain('请先把它建出来');
    // 判分引擎的原话（黑话）不再出现在给学生看的文案里
    expect(msg).not.toContain('未找到表');
  });

  it('另一种缺表措辞（表「X」不存在…）同样识别；非缺表 message 原样返回、空值 undefined', () => {
    expect(extractMissingTable('表「订单管理表」不存在，无法验证字段')).toBe('订单管理表');
    expect(friendlyRuleMessage('字段「姓名」类型不符合要求')).toBe('字段「姓名」类型不符合要求');
    expect(friendlyRuleMessage(undefined)).toBeUndefined();
    expect(friendlyRuleMessage(null)).toBeUndefined();
    expect(friendlyRuleMessage('')).toBeUndefined();
  });

  it('表单/视图缺失不误判成缺表（引擎真会下发这两种措辞，改写会给出错误指令）', () => {
    expect(friendlyRuleMessage('未找到表单「报名表」')).toBe('未找到表单「报名表」');
    expect(friendlyRuleMessage('视图「员工总览」不存在')).toBe('视图「员工总览」不存在');
  });
});
