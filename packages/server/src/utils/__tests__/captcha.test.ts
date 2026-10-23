import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateMathCaptcha,
  resetCaptchaStoreForTests,
  verifyCaptcha,
} from '../captcha';

describe('数学验证码（服务端存储 + 一次性）', () => {
  afterEach(() => {
    resetCaptchaStoreForTests();
    vi.useRealTimers();
  });

  it('生成 SVG/不透明 token，非生产环境带 debugAnswer', () => {
    const result = generateMathCaptcha();
    expect(result.svg).toContain('<svg');
    expect(result.captchaToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.debugAnswer).toBeTruthy();
  });

  it('答案正确时通过，且同一个 token 只能用一次', () => {
    const { captchaToken, debugAnswer } = generateMathCaptcha();
    expect(verifyCaptcha(debugAnswer!, captchaToken)).toBe(true);
    expect(verifyCaptcha(debugAnswer!, captchaToken)).toBe(false);
  });

  it('答案错误时不通过并作废 token', () => {
    const { captchaToken } = generateMathCaptcha();
    expect(verifyCaptcha('not-the-answer', captchaToken)).toBe(false);
  });

  it('超过 5 分钟过期', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
    const { captchaToken, debugAnswer } = generateMathCaptcha();

    vi.setSystemTime(new Date('2026-10-23T00:05:01Z'));
    expect(verifyCaptcha(debugAnswer!, captchaToken)).toBe(false);
  });
});
