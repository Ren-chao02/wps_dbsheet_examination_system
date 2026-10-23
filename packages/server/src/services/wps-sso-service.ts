import jwt from 'jsonwebtoken';
import { config } from '../config';
import { wpsConfigService } from './wps-config-service';
import { signKso1 } from './wps-kso-sign';
import { logger } from '../utils/logger';

/**
 * WPS 账号 SSO（用户授权，不是多维表格 API 的全局 token）。
 *
 * ⚠️ 这里拿到的 access_token 是「当前登录用户」的，只用于读取用户身份。
 * 绝对不要调用 wpsConfigService.save() —— 那会覆盖多维表格判分链路使用的
 * 全局 refresh_token，导致 token 链断裂、判分读不到表格。
 */

const WPS_OAUTH_AUTH = 'https://openapi.wps.cn/oauth2/auth';
const WPS_OAUTH_TOKEN = 'https://openapi.wps.cn/oauth2/token';
const WPS_USERINFO_PATH = '/v7/users/current';
const HTTP_TIMEOUT_MS = 10_000;

export interface WpsProfile {
  id: string;
  name: string;
  avatar: string;
}

export interface WpsCredentials {
  clientId: string;
  clientSecret: string;
}

export interface WpsBindTicket extends WpsProfile {
  typ: 'wps_bind';
}

export class WpsSsoService {
  /** 环境变量优先，缺省回退到「WPS 多维表格」已配置的应用凭据（同一个应用也可以开用户授权） */
  async getCredentials(): Promise<WpsCredentials> {
    // 两套都配了环境变量时不必查库，/auth/config 会在每次打开登录页时调用
    if (config.wpsSso.clientId && config.wpsSso.clientSecret) {
      return { clientId: config.wpsSso.clientId, clientSecret: config.wpsSso.clientSecret };
    }

    let db = { clientId: '', clientSecret: '' };
    try {
      db = await wpsConfigService.getEffectiveCredentials();
    } catch (err) {
      logger.warn({ err }, '[wps-sso] 读取数据库凭据失败，仅使用环境变量');
    }
    return {
      clientId: config.wpsSso.clientId || db.clientId,
      clientSecret: config.wpsSso.clientSecret || db.clientSecret,
    };
  }

  getRedirectUri(): string {
    return config.wpsSso.redirectUri
      || (config.wpsSso.publicBaseUrl ? `${config.wpsSso.publicBaseUrl}/api/auth/wps/callback` : '');
  }

  /** 登录成功后回到的前端地址；同源部署时 publicBaseUrl 即前端地址 */
  getClientBaseUrl(): string {
    return config.wpsSso.clientBaseUrl || config.wpsSso.publicBaseUrl;
  }

  async isEnabled(): Promise<boolean> {
    if (!config.wpsSso.enabled) return false;
    if (!this.getRedirectUri() || !this.getClientBaseUrl()) return false;
    const { clientId, clientSecret } = await this.getCredentials();
    return Boolean(clientId && clientSecret);
  }

  async buildAuthorizeUrl(state: string): Promise<string> {
    const { clientId } = await this.getCredentials();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) {
      throw new Error('WPS SSO 未配置完整（缺少 client_id 或回调地址）');
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: config.wpsSso.scope,
      state,
    });
    return `${WPS_OAUTH_AUTH}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<string> {
    const { clientId, clientSecret } = await this.getCredentials();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error('WPS SSO 未配置完整');
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await fetch(WPS_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as any;
    if (!response.ok || (data?.code !== undefined && data.code !== 0) || !data?.access_token) {
      throw new Error(data?.msg || data?.error_description || data?.error || 'WPS 授权码换取 token 失败');
    }
    return String(data.access_token);
  }

  /** GET /v7/users/current：KSO-1 签名 + 用户 access_token */
  async fetchProfile(accessToken: string): Promise<WpsProfile> {
    const { clientId, clientSecret } = await this.getCredentials();
    if (!clientId || !clientSecret) throw new Error('WPS SSO 未配置完整');

    const sign = signKso1({
      method: 'GET',
      requestUri: WPS_USERINFO_PATH,
      appId: clientId,
      appSecret: clientSecret,
    });

    const response = await fetch(`https://openapi.wps.cn${WPS_USERINFO_PATH}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Kso-Date': sign.date,
        'X-Kso-Authorization': sign.authorization,
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    const data = (await response.json().catch(() => null)) as any;
    if (!response.ok || (data?.code !== undefined && data.code !== 0)) {
      throw new Error(data?.msg || data?.error_description || `WPS 用户信息读取失败（HTTP ${response.status}）`);
    }

    const user = data?.data || data;
    const id = user?.id ?? user?.user_id ?? user?.userId;
    if (!id) throw new Error('WPS 未返回用户 ID');

    return {
      id: String(id),
      name: String(user?.name ?? user?.nickname ?? 'WPS 用户'),
      avatar: String(user?.avatar ?? user?.avatar_url ?? ''),
    };
  }

  signBindTicket(profile: WpsProfile): string {
    const payload: WpsBindTicket = { typ: 'wps_bind', ...profile };
    return jwt.sign(payload, config.jwt.secret, { expiresIn: '10m' });
  }

  verifyBindTicket(ticket: string): WpsBindTicket | null {
    try {
      const payload = jwt.verify(ticket, config.jwt.secret) as WpsBindTicket;
      if (payload?.typ !== 'wps_bind' || !payload.id) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

export const wpsSsoService = new WpsSsoService();
