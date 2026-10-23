import crypto from 'crypto';

/**
 * WPS 365 / 开放平台 KSO-1 请求签名。
 *
 * 与 AWS SigV4 不同，KSO-1 的 stringToSign 是**直接拼接、没有换行**：
 *   "KSO-1" + METHOD + RequestURI(含 query) + ContentType + X-Kso-Date + sha256(body)
 * GET 无请求体时，body 哈希段是空字符串（不是 sha256('')）。
 *
 * 参考：WPS 开放平台「接口签名」文档与社区实现。
 * 这里单独成模块，便于用固定向量做单测，也方便先用探针脚本验证真实接口。
 */

export interface KsoSignInput {
  method: string;
  /** 参与签名的路径 + query，例如 /v7/users/current 或 /v7/users?x=1 */
  requestUri: string;
  contentType?: string;
  /** RFC1123 UTC 时间；不传则取当前时间 */
  date?: string;
  /** 原始请求体字符串；GET 传空 */
  body?: string;
  appId: string;
  appSecret: string;
}

export interface KsoSignResult {
  date: string;
  signature: string;
  stringToSign: string;
  authorization: string;
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildStringToSign(input: Omit<KsoSignInput, 'appId' | 'appSecret'> & { date: string }): string {
  const contentType = input.contentType || '';
  const bodyHash = input.body ? sha256Hex(input.body) : '';
  return `KSO-1${input.method.toUpperCase()}${input.requestUri}${contentType}${input.date}${bodyHash}`;
}

export function signKso1(input: KsoSignInput): KsoSignResult {
  const date = input.date || new Date().toUTCString();
  const stringToSign = buildStringToSign({
    method: input.method,
    requestUri: input.requestUri,
    contentType: input.contentType,
    body: input.body,
    date,
  });
  const signature = crypto
    .createHmac('sha256', input.appSecret)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    date,
    signature,
    stringToSign,
    authorization: `KSO-1 ${input.appId}:${signature}`,
  };
}
