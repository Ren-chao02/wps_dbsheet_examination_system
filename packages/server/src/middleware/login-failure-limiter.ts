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
) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;

  return (req: Request, res: Response, next: NextFunction) => {
    const key = ipKeyGenerator(req.ip || 'unknown');
    const now = Date.now();

    // 轻量清理：每 5 分钟扫一遍过期桶，避免大量来源把 Map 撑大
    if (now - lastSweep > 5 * 60 * 1000) {
      lastSweep = now;
      for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
    }

    const bucket = buckets.get(key);
    if (bucket && now < bucket.resetAt && bucket.count >= limit) {
      return res.status(429).json({ message: '登录尝试过于频繁，请稍后再试', code: 'TOO_MANY_ATTEMPTS' });
    }

    res.on('finish', () => {
      if (res.statusCode !== 401) return;
      const at = Date.now();
      const cur = buckets.get(key);
      if (!cur || at >= cur.resetAt) buckets.set(key, { count: 1, resetAt: at + windowMs });
      else cur.count += 1;
    });

    next();
  };
}
