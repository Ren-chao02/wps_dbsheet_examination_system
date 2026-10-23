import crypto from 'crypto';
import svgCaptcha from 'svg-captcha';
import { config } from '../config';

/**
 * 数学验证码：答案只存在服务端，客户端拿到的 captchaToken 是不透明 ID。
 *
 * 为什么不继续把答案签进 JWT：JWT 只签名不加密，任何拿到 token 的人
 * base64 解一下就能读出答案（E2E 之前就是这么干的）。这里改成服务端
 * 存储 + 一次性消费，答案不再离开服务端。
 *
 * 存储选择：进程内 Map。当前部署是单 Node 实例（server 同时托管前端），
 * 够用且不依赖 Redis；如果以后横向扩容，需要换成 Redis 共享存储，否则
 * 请求落到另一台实例会验证码失效。
 */

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 10_000;

interface CaptchaEntry {
  answer: string;
  expiresAt: number;
}

const store = new Map<string, CaptchaEntry>();

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s/g, '');
}

function cleanup(now: number) {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  // 极端情况下（大量验证码未过期）按插入顺序淘汰最旧的一批，防止内存无界增长
  if (store.size >= MAX_ENTRIES) {
    const overflow = store.size - Math.floor(MAX_ENTRIES * 0.9);
    let removed = 0;
    for (const key of store.keys()) {
      store.delete(key);
      if (++removed >= overflow) break;
    }
  }
}

/**
 * 生成验证码。
 * 非生产环境默认返回 debugAnswer 供 Playwright 解算；生产环境永不返回。
 * 本地 E2E 若以 NODE_ENV=production 起服务，可由路由层在「回环地址 + E2E_CAPTCHA_DEBUG=true」
 * 时显式打开，避免为了测试把答案暴露给公网。
 */
export function generateMathCaptcha(includeDebug = config.nodeEnv !== 'production'): {
  svg: string;
  captchaToken: string;
  debugAnswer?: string;
} {
  const captcha = svgCaptcha.createMathExpr({
    mathMin: 1,
    mathMax: 20,
    mathOperator: '+',
    fontSize: 48,
    width: 150,
    height: 50,
    background: '#f0f2f5',
    noise: 2,
  });

  const answer = normalize(captcha.text);
  const captchaToken = crypto.randomUUID();
  const now = Date.now();
  cleanup(now);
  store.set(captchaToken, { answer, expiresAt: now + CAPTCHA_TTL_MS });

  return {
    svg: captcha.data,
    captchaToken,
    ...(includeDebug ? { debugAnswer: answer } : {}),
  };
}

/**
 * 校验并消费验证码（一次性）。
 * 无论成功失败，同一个 token 都不能再用第二次。
 */
export function verifyCaptcha(captchaText: string, captchaToken: string): boolean {
  const entry = store.get(captchaToken);
  if (!entry) return false;

  store.delete(captchaToken);
  if (entry.expiresAt <= Date.now()) return false;

  const input = Buffer.from(normalize(captchaText));
  const expected = Buffer.from(entry.answer);
  return input.length === expected.length && crypto.timingSafeEqual(input, expected);
}

/** 仅供测试：清空进程内验证码，避免用例之间互相影响 */
export function resetCaptchaStoreForTests() {
  store.clear();
}
