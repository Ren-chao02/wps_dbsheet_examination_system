import { describe, expect, it } from 'vitest';
import { extractInvitationCode } from '../invitation-code';

describe('extractInvitationCode', () => {
  it('从完整邀请链接中提取邀请码', () => {
    expect(
      extractInvitationCode('https://exam.snnu.edu.cn/join/Ab3d_9-x?from=wechat'),
    ).toBe('Ab3d_9-x');
  });

  it('从相对路径中提取邀请码', () => {
    expect(extractInvitationCode('/join/Ab3d_9-x')).toBe('Ab3d_9-x');
  });

  it('允许直接输入邀请码', () => {
    expect(extractInvitationCode('  Ab3d_9-x  ')).toBe('Ab3d_9-x');
  });

  it('拒绝无关文字或过短内容', () => {
    expect(extractInvitationCode('https://exam.snnu.edu.cn/login')).toBeNull();
    expect(extractInvitationCode('abc')).toBeNull();
    expect(extractInvitationCode('')).toBeNull();
  });
});
