import svgCaptcha from 'svg-captcha';
import jwt from 'jsonwebtoken';
import { config } from '../config';

interface CaptchaToken {
  answer: string;
}

/**
 * 生成数学运算验证码（更友好）
 */
export function generateMathCaptcha(): { svg: string; token: string } {
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

  const token = jwt.sign(
    { answer: captcha.text.toLowerCase().replace(/\s/g, '') } as CaptchaToken,
    config.jwt.secret,
    { expiresIn: '5m' }
  );

  return { svg: captcha.data, token };
}

/**
 * 校验验证码
 * @param captchaText 用户输入的验证码
 * @param captchaToken 验证码签发时返回的 token
 * @returns { valid: boolean }
 */
export function verifyCaptcha(captchaText: string, captchaToken: string): boolean {
  try {
    const payload = jwt.verify(captchaToken, config.jwt.secret) as CaptchaToken;
    return payload.answer === captchaText.toLowerCase().replace(/\s/g, '');
  } catch {
    return false;
  }
}
