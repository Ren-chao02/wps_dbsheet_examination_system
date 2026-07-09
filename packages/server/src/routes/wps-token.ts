import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { authenticate, authorize } from '../middleware/auth';
import { config } from '../config';

export const wpsTokenRouter = Router();

// 所有 WPS Token 接口需要教师或管理员认证
wpsTokenRouter.use(authenticate);
wpsTokenRouter.use(authorize('teacher', 'admin'));

interface WpsTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: string | number;
  token_type: string;
}

/**
 * POST /api/wps-token/refresh
 * 使用 refresh_token 刷新 access_token
 * Body: { refreshToken: string }
 */
wpsTokenRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken, clientId, clientSecret } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: '缺少 refresh_token' });
    }
    // 优先使用请求中的凭据，否则回退到服务端配置
    const effectiveClientId = clientId || config.kingsoft.apiKey;
    const effectiveClientSecret = clientSecret || config.kingsoft.apiSecret;
    if (!effectiveClientId || !effectiveClientSecret) {
      return res.status(500).json({ message: '未配置 WPS 应用凭据' });
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', refreshToken);
    params.append('client_id', effectiveClientId);
    params.append('client_secret', effectiveClientSecret);

    const response = await fetch('https://openapi.wps.cn/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = (await response.json()) as WpsTokenResponse & { code?: number; msg?: string };
    if (!response.ok || data.code !== undefined && data.code !== 0) {
      return res.status(400).json({
        message: data.msg || '刷新 WPS access_token 失败',
        code: data.code,
      });
    }

    res.json({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      refreshExpiresIn: Number(data.refresh_expires_in),
      tokenType: data.token_type,
    });
  } catch (err: any) {
    res.status(500).json({ message: '服务器错误', detail: err.message });
  }
});

/**
 * GET /api/wps-token/credentials
 * 获取已保存的 WPS 应用凭据（用于自动填充）
 */
wpsTokenRouter.get('/credentials', (_req: Request, res: Response) => {
  res.json({
    apiKey: process.env.KINGSOFT_API_KEY || '',
    apiSecret: process.env.KINGSOFT_API_SECRET || '',
    configured: !!(process.env.KINGSOFT_API_KEY && process.env.KINGSOFT_API_SECRET),
  });
});

/**
 * POST /api/wps-token/credentials
 * 保存 WPS 应用凭据到 .env 文件
 * Body: { apiKey: string, apiSecret: string }
 */
wpsTokenRouter.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ message: '缺少 apiKey 或 apiSecret' });
    }

    const envPath = path.resolve(process.cwd(), '.env');
    let content = fs.readFileSync(envPath, 'utf-8');

    // 替换或追加 KINGSOFT_API_KEY
    if (/^KINGSOFT_API_KEY=/m.test(content)) {
      content = content.replace(/^KINGSOFT_API_KEY=.*$/m, `KINGSOFT_API_KEY="${apiKey}"`);
    } else {
      content += `\nKINGSOFT_API_KEY="${apiKey}"`;
    }

    // 替换或追加 KINGSOFT_API_SECRET
    if (/^KINGSOFT_API_SECRET=/m.test(content)) {
      content = content.replace(/^KINGSOFT_API_SECRET=.*$/m, `KINGSOFT_API_SECRET="${apiSecret}"`);
    } else {
      content += `\nKINGSOFT_API_SECRET="${apiSecret}"`;
    }

    fs.writeFileSync(envPath, content, 'utf-8');

    // 同步更新运行时环境变量
    process.env.KINGSOFT_API_KEY = apiKey;
    process.env.KINGSOFT_API_SECRET = apiSecret;

    res.json({ message: '凭据已保存' });
  } catch (err: any) {
    res.status(500).json({ message: '保存凭据失败', detail: err.message });
  }
});
