import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildStringToSign, sha256Hex, signKso1 } from '../wps-kso-sign';

describe('WPS KSO-1 签名', () => {
  const date = 'Wed, 23 Jan 2013 06:43:08 GMT';

  it('GET 无 body 时哈希段为空、拼接无换行', () => {
    const stringToSign = buildStringToSign({
      method: 'GET',
      requestUri: '/v7/users/current',
      date,
    });
    expect(stringToSign).toBe(`KSO-1GET/v7/users/current${date}`);
    expect(stringToSign).not.toContain('\n');
  });

  it('POST 时 body 取 sha256 小写十六进制', () => {
    const body = '{"a":1}';
    const stringToSign = buildStringToSign({
      method: 'POST',
      requestUri: '/v7/test?x=1',
      contentType: 'application/json',
      body,
      date,
    });
    expect(stringToSign).toBe(
      `KSO-1POST/v7/test?x=1application/json${date}${sha256Hex(body)}`,
    );
  });

  it('签名是 HMAC-SHA256(secret, stringToSign) 的小写十六进制', () => {
    const result = signKso1({
      method: 'GET',
      requestUri: '/v7/users/current',
      date,
      appId: 'AK123456',
      appSecret: 'secret-key',
    });
    const expected = crypto
      .createHmac('sha256', 'secret-key')
      .update(result.stringToSign)
      .digest('hex');
    expect(result.signature).toBe(expected);
    expect(result.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(result.authorization).toBe(`KSO-1 AK123456:${result.signature}`);
  });
});
