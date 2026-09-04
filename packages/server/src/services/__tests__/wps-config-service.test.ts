/**
 * wpsConfigService 测试 — saveCredentials + getEffectiveCredentials (DB→env 兜底)
 * 验证：前端在 WPS Token 页保存的凭据，DB 优先于环境变量，且保存时保留已有 token。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockWpsFindUnique, mockWpsUpsert } = vi.hoisted(() => ({
  mockWpsFindUnique: vi.fn(),
  mockWpsUpsert: vi.fn(),
}));

vi.mock('../../config/prisma', () => ({
  prisma: {
    wpsConfig: {
      findUnique: mockWpsFindUnique,
      upsert: mockWpsUpsert,
    },
  },
}));

import { wpsConfigService } from '../wps-config-service';

function dbRow(overrides: Partial<Record<'clientId' | 'clientSecret', string | null>> = {}) {
  return {
    id: 'wps_config',
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: 1n,
    refreshExpiresAt: 2n,
    clientId: null,
    clientSecret: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('wpsConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KINGSOFT_API_KEY = 'env-key';
    process.env.KINGSOFT_API_SECRET = 'env-secret';
  });

  afterEach(() => {
    delete process.env.KINGSOFT_API_KEY;
    delete process.env.KINGSOFT_API_SECRET;
  });

  describe('getEffectiveCredentials', () => {
    it('DB 有凭据时优先返回 DB（前端已配置，无需重启即生效）', async () => {
      mockWpsFindUnique.mockResolvedValue(dbRow({ clientId: 'db-client-id', clientSecret: 'db-client-secret' }));

      const result = await wpsConfigService.getEffectiveCredentials();

      expect(result.clientId).toBe('db-client-id');
      expect(result.clientSecret).toBe('db-client-secret');
    });

    it('DB 记录存在但凭据为空时回退到环境变量', async () => {
      mockWpsFindUnique.mockResolvedValue(dbRow());

      const result = await wpsConfigService.getEffectiveCredentials();

      expect(result.clientId).toBe('env-key');
      expect(result.clientSecret).toBe('env-secret');
    });

    it('DB 记录不存在时回退到环境变量', async () => {
      mockWpsFindUnique.mockResolvedValue(null);

      const result = await wpsConfigService.getEffectiveCredentials();

      expect(result.clientId).toBe('env-key');
      expect(result.clientSecret).toBe('env-secret');
    });
  });

  describe('saveCredentials', () => {
    it('调用 upsert 保存凭据，create 保留已有 token', async () => {
      mockWpsFindUnique.mockResolvedValue(dbRow({ accessToken: 'old-at', refreshToken: 'old-rt' } as any));
      mockWpsUpsert.mockResolvedValue({});

      await wpsConfigService.saveCredentials('new-client-id', 'new-client-secret');

      expect(mockWpsUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wps_config' },
          create: expect.objectContaining({
            accessToken: 'old-at',
            refreshToken: 'old-rt',
            clientId: 'new-client-id',
            clientSecret: 'new-client-secret',
          }),
          update: { clientId: 'new-client-id', clientSecret: 'new-client-secret' },
        }),
      );
    });

    it('DB 无记录时 create 用空 token 占位，仍写入凭据', async () => {
      mockWpsFindUnique.mockResolvedValue(null);
      mockWpsUpsert.mockResolvedValue({});

      await wpsConfigService.saveCredentials('new-client-id', 'new-client-secret');

      expect(mockWpsUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'wps_config' },
          create: expect.objectContaining({
            clientId: 'new-client-id',
            clientSecret: 'new-client-secret',
          }),
        }),
      );
    });
  });
});
