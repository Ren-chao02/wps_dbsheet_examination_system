import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { authenticate, authorize } from '../middleware/auth';
import { wpsConfigService } from '../services/wps-config-service';

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
    // 凭据解析：请求参数 → 数据库（前端已配置）→ 环境变量
    const { clientId: dbClientId, clientSecret: dbClientSecret } = await wpsConfigService.getEffectiveCredentials();
    const effectiveClientId = clientId || dbClientId || '';
    const effectiveClientSecret = clientSecret || dbClientSecret || '';
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
 * 获取已保存的 WPS 应用凭据（DB 优先，回退环境变量）
 */
wpsTokenRouter.get('/credentials', async (_req: Request, res: Response) => {
  try {
    const { clientId, clientSecret } = await wpsConfigService.getEffectiveCredentials();
    res.json({
      apiKey: clientId,
      apiSecret: clientSecret,
      configured: !!(clientId && clientSecret),
    });
  } catch (err: any) {
    res.status(500).json({ message: '获取凭据失败', detail: err.message });
  }
});

/**
 * POST /api/wps-token/credentials
 * 保存 WPS 应用凭据：数据库为主（持久化，容器重建不丢）+ 尽力写 .env 文件
 * Body: { apiKey: string, apiSecret: string }
 */
wpsTokenRouter.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { apiKey, apiSecret } = req.body;
    if (!apiKey || !apiSecret) {
      return res.status(400).json({ message: '缺少 apiKey 或 apiSecret' });
    }

    // 1) 持久化到数据库（主持久化：克隆部署/容器重建后仍生效）
    await wpsConfigService.saveCredentials(apiKey, apiSecret);

    // 2) 尽力写入 .env 文件（便于非 Docker 部署查看）
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      let content = '';
      try {
        content = fs.readFileSync(envPath, 'utf-8');
      } catch {
        content = '';
      }

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
    } catch {
      // .env 写入失败不阻塞（如容器内只读），DB 已持久化
    }

    // 3) 同步更新运行时环境变量（立即生效，无需重启）
    process.env.KINGSOFT_API_KEY = apiKey;
    process.env.KINGSOFT_API_SECRET = apiSecret;

    res.json({ message: '凭据已保存' });
  } catch (err: any) {
    res.status(500).json({ message: '保存凭据失败', detail: err.message });
  }
});
