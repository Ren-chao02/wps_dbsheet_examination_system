import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config';

/**
 * 登录失败限流：只在响应为 401（账号或密码错误）时计数。
 *
 * 为什么不用 express-rate-limit 的 skipSuccessfulRequests：它在请求进入时先 +1、
 * 成功响应后再 -1。整班 NAT 同 IP 数百人同时登录时，计数会先冲到上限，
 * 把本应成功的请求也 429 掉（压测实测 300 人并发触发，随后重试又打满验证码限流）。
 * 这里把计数放到响应 finish 之后：成功请求永不占额度，失败预算仍保持 100/15 分钟。
 */
export function createLoginFailureLimiter(
  limit = config.login.ipLimit,
  windowMs = config.login.ipWindowMinutes * 60 * 1000,
  maxInflight = config.login.ipMaxInflight,
) {
  // pending 必须在场：只看"已完成失败数"会被并发绕过——攻击者同时发 N 个错误密码，
  // 全部在计数前通过闸门。pending 给在途请求一个硬上限，失败预算仍按 401 计。
  const buckets = new Map<string, { failed: number; pending: number; resetAt: number }>();
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    // key 用 req.ip：它只在 trust proxy 配置正确时可信。app.ts 生产默认 1 跳
    // （应用只绑定 127.0.0.1，同机反向代理追加真实客户端 IP），开发默认 false；
    // 严禁 TRUST_PROXY=true（app.ts 会 fail-fast）。不能用 socket.remoteAddress：
    // 代理后面它永远是代理 IP，会把所有客户端合并成同一个限流桶。
    const key = ipKeyGenerator(req.ip || 'unknown');
    const now = Date.now();

    // 轻量清理：每 5 分钟扫一遍过期且无在途请求的桶，避免大量来源把 Map 撑大
    if (now - lastSweep > 5 * 60 * 1000) {
      lastSweep = now;
      for (const [k, b] of buckets) if (now >= b.resetAt && b.pending === 0) buckets.delete(k);
    }

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { failed: 0, pending: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    } else if (now >= bucket.resetAt) {
      bucket.failed = 0;
      bucket.resetAt = now + windowMs;
    }

    if (bucket.failed >= limit || bucket.pending >= maxInflight) {
      return res.status(429).json({ message: '登录尝试过于频繁，请稍后再试', code: 'TOO_MANY_ATTEMPTS' });
    }

    bucket.pending += 1;
    res.on('finish', () => {
      bucket!.pending = Math.max(0, bucket!.pending - 1);
      if (res.statusCode === 401) bucket!.failed += 1;
    });

    next();
  };
}
