import { Page, expect } from '@playwright/test';

/**
 * E2E 登录辅助
 *
 * 登录接口强制要求验证码。验证码答案现在只存在服务端，生产响应里没有答案；
 * 非生产环境后端会额外返回 debugAnswer 供 E2E 使用（见 utils/captcha.ts）。
 * 本地若以 NODE_ENV=production 起后端，需在后端环境设置 E2E_CAPTCHA_DEBUG=true
 * （服务端只对回环地址放行，公网请求仍拿不到答案）。
 * 这里拦截响应取出 debugAnswer。旧版本服务端仍返回 JWT token 时保留解码兜底。
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
    if (body?.debugAnswer) {
      answer = String(body.debugAnswer);
    } else if (body?.captchaToken) {
      // 兼容旧服务端：答案曾放在 JWT payload 里
      const payloadPart = String(body.captchaToken).split('.')[1];
      if (!payloadPart) return;
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

  await page.getByPlaceholder('学号 / 用户名').fill(creds.username);
  await page.getByPlaceholder('密码').fill(creds.password);
  await page.getByPlaceholder('验证码').fill(answer);

  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(new RegExp(expectPath), { timeout: 20_000 });
}
