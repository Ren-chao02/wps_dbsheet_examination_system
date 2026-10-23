import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../password-hash';

// 由旧实现 bcryptjs 生成的 $2a$ 哈希：证明切换原生实现后存量密码仍可验证
const LEGACY_BCRYPTJS_HASH = '$2a$10$28tX5K8qKBGXCV37W..n..OPLDiIZi4bnGi0CPhjIIMvAj97.lABe';

describe('password-hash', () => {
  it('hash/verify 往返', async () => {
    const h = await hashPassword('New#Pass1');
    expect(h.startsWith('$2')).toBe(true);
    await expect(verifyPassword('New#Pass1', h)).resolves.toBe(true);
    await expect(verifyPassword('wrong', h)).resolves.toBe(false);
  });

  it('兼容历史 bcryptjs 哈希（$2a$）', async () => {
    await expect(verifyPassword('Legacy#Pass1', LEGACY_BCRYPTJS_HASH)).resolves.toBe(true);
    await expect(verifyPassword('wrong', LEGACY_BCRYPTJS_HASH)).resolves.toBe(false);
  });
});
