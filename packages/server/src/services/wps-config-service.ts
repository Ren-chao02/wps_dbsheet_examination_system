/**
 * WPS Token 配置服务 — 服务端持久化 + 自动刷新
 */
import { prisma } from '../config/prisma';

const REFRESH_MARGIN_MS = 10 * 60 * 1000; // 提前10分钟刷新
const CHECK_INTERVAL_MS = 5 * 60 * 1000;  // 每5分钟检查一次

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export const wpsConfigService = {
  /** 从数据库加载 WPS Token */
  async get() {
    return prisma.wpsConfig.findUnique({ where: { id: 'wps_config' } });
  },

  /** 保存 Token 到数据库（clientId/clientSecret 仅在传入时更新，避免覆盖已有凭据） */
  async save(params: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    refreshExpiresIn: number;
    clientId?: string | null;
    clientSecret?: string | null;
  }) {
    const expiresAt = BigInt(Date.now() + params.expiresIn * 1000);
    const refreshExpiresAt = BigInt(Date.now() + params.refreshExpiresIn * 1000);
    return prisma.wpsConfig.upsert({
      where: { id: 'wps_config' },
      create: {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt,
        refreshExpiresAt,
        ...(params.clientId !== undefined ? { clientId: params.clientId } : {}),
        ...(params.clientSecret !== undefined ? { clientSecret: params.clientSecret } : {}),
      },
      update: {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt,
        refreshExpiresAt,
        ...(params.clientId !== undefined ? { clientId: params.clientId } : {}),
        ...(params.clientSecret !== undefined ? { clientSecret: params.clientSecret } : {}),
      },
    });
  },

  /** 保存 WPS 应用凭据（只更新 clientId/clientSecret，保留已有 token） */
  async saveCredentials(clientId: string, clientSecret: string) {
    const existing = await this.get();
    const now = BigInt(Date.now());
    return prisma.wpsConfig.upsert({
      where: { id: 'wps_config' },
      create: {
        accessToken: existing?.accessToken || '',
        refreshToken: existing?.refreshToken || '',
        expiresAt: existing?.expiresAt || now,
        refreshExpiresAt: existing?.refreshExpiresAt || now,
        clientId,
        clientSecret,
      },
      update: { clientId, clientSecret },
    });
  },

  /** 获取生效凭据：DB 优先（前端已配置，容器重建不丢），否则回退环境变量 */
  async getEffectiveCredentials(): Promise<{ clientId: string; clientSecret: string }> {
    const cfg = await this.get();
    if (cfg?.clientId && cfg?.clientSecret) {
      return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
    }
    return {
      clientId: process.env.KINGSOFT_API_KEY || '',
      clientSecret: process.env.KINGSOFT_API_SECRET || '',
    };
  },

  /**
   * 获取「当前可用」的 access_token：
   * 临近过期（10 分钟内）或已过期时先自动刷新再返回。
   * 用途：判分/重置文件等写时操作必须用实时 token，不能依赖配置时刻的快照，
   * 否则 token 轮换后快照过期会导致 403 Token expired。
   */
  async getValidAccessToken(): Promise<string | null> {
    const cfg = await this.get();
    if (!cfg?.accessToken) return null;

    const now = BigInt(Date.now());
    const expiresAt = cfg.expiresAt || 0n;
    if (expiresAt > 0n && now >= expiresAt - BigInt(REFRESH_MARGIN_MS)) {
      await this.autoRefresh();
      const refreshed = await this.get();
      return refreshed?.accessToken || cfg.accessToken;
    }
    return cfg.accessToken;
  },

  /** 检查是否需要刷新，需要则自动刷新 */
  async autoRefresh() {
    const cfg = await this.get();
    if (!cfg || !cfg.refreshToken) return false;

    const now = BigInt(Date.now());
    const expiresAt = cfg.expiresAt;
    const refreshExpiresAt = cfg.refreshExpiresAt;

    // refresh_token 本身已过期，无法刷新
    if (refreshExpiresAt > 0n && now >= refreshExpiresAt) {
      console.log('[WPS] refresh_token 已过期，跳过自动刷新');
      return false;
    }

    // access_token 还有充足时间，无需刷新
    if (now < expiresAt - BigInt(REFRESH_MARGIN_MS)) return false;

    console.log('[WPS] access_token 即将过期，自动刷新中...');

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', cfg.refreshToken);
      // 凭据动态解析：DB 优先，回退环境变量（修复 config 启动快照导致 UI 保存不生效的问题）
      const { clientId, clientSecret } = await this.getEffectiveCredentials();
      params.append('client_id', clientId);
      params.append('client_secret', clientSecret);

      const response = await fetch('https://openapi.wps.cn/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await response.json() as any;
      if (!response.ok || (data.code !== undefined && data.code !== 0)) {
        console.error('[WPS] 自动刷新失败:', data.msg || data);
        return false;
      }

      await this.save({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        refreshExpiresIn: Number(data.refresh_expires_in) || 2592000,
      });

      console.log('[WPS] access_token 自动刷新成功, 新有效期:', data.expires_in, '秒');
      return true;
    } catch (err: any) {
      console.error('[WPS] 自动刷新异常:', err.message);
      return false;
    }
  },

  /** 启动定时刷新 */
  startAutoRefresh() {
    if (refreshTimer) return;
    console.log('[WPS] 自动刷新定时任务已启动 (每5分钟检查)');
    // 启动时立即检查一次
    this.autoRefresh().catch(() => {});
    refreshTimer = setInterval(() => {
      this.autoRefresh().catch(() => {});
    }, CHECK_INTERVAL_MS);
  },

  /** 停止定时刷新 */
  stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  },
};
