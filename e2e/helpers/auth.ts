import { Page, expect } from '@playwright/test';

/**
 * E2E 登录辅助
 *
 * 难点只有一个：登录接口强制要求验证码，而答案只能从图片上认出来。
 * 不过服务端把答案**以明文放进了 JWT payload**（只签名、未加密），
 * 所以这里拦截 /api/auth/captcha 的响应把答案解出来 —— 用的是页面自己
 * 拿到的那一个 token，因此与真实用户提交的完全一致。
 *
 * ⚠️ 这段代码同时也是一份证据：这个验证码挡不住自动化。要真正生效，
 * 答案应当存在服务端（Redis / 数据库）或改成 HMAC 校验，而不是塞进一个
 * 客户端持有的 token。
 */

export interface Credentials {
  username: string;
  password: string;
}

/** 从环境变量读测试账号；没配就返回 null，调用方据此跳过用例 */
export function readCredentials(prefix: 'STUDENT' | 'TEACHER'): Credentials | null {
  const username = process.env[`E2E_${prefix}_USERNAME`];
  const password = process.env[`E2E_${prefix}_PASSWORD`];
  if (!username || !password) return null;
  return { username, password };
}

/**
 * 装上验证码解算器，返回一个取值函数。
 * 必须在 page.goto 之前调用 —— 页面加载时就会请求验证码，晚一步就漏了。
 */
export async function armCaptchaSolver(page: Page): Promise<() => string | undefined> {
  let answer: string | undefined;

  await page.route('**/api/auth/captcha', async (route) => {
    const response = await route.fetch();
    const body = await response.json().catch(() => null);
    if (body?.captchaToken) {
      const payloadPart = String(body.captchaToken).split('.')[1];
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
      answer = String(payload.answer);
    }
    // 原样放行，页面拿到的仍是真实响应
    await route.fulfill({ response });
  });

  return () => answer;
}

/** 登录并等待跳转到目标角色的首页 */
export async function login(page: Page, creds: Credentials, expectPath: string): Promise<void> {
  const getCaptcha = await armCaptchaSolver(page);

  await page.goto('/login');
  // 等页面把验证码取回来，解算器才有值
  await page.waitForResponse((r) => r.url().includes('/api/auth/captcha')).catch(() => undefined);

  const answer = getCaptcha();
  if (!answer) {
    throw new Error('未能解出验证码答案 —— 请确认 /api/auth/captcha 仍返回 captchaToken');
  }

  await page.getByPlaceholder('用户名').fill(creds.username);
  await page.getByPlaceholder('密码').fill(creds.password);
  await page.getByPlaceholder('验证码').fill(answer);

  await page.getByRole('button', { name: /登\s*录/ }).click();

  await expect(page).toHaveURL(new RegExp(expectPath), { timeout: 20_000 });
}
