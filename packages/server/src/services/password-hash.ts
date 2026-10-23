import { hash as nativeHash, verify as nativeVerify } from '@node-rs/bcrypt';

/**
 * 密码哈希的唯一入口。
 *
 * 历史实现是 bcryptjs（纯 JS）：哈希/比较都在主线程 CPU 上跑，压测里
 * 200~300 人同时登录时 p95 达到 25~33 秒。改用 @node-rs/bcrypt（原生实现，
 * 异步比较在工作线程池执行），哈希格式保持 bcrypt 兼容（$2a/$2b 都能验证），
 * 存量密码无需重置。
 */
export const PASSWORD_HASH_COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return nativeHash(plain, { cost: PASSWORD_HASH_COST });
}

export function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  return nativeVerify(plain, storedHash);
}
