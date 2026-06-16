/**
 * 缓存管理路由 — 提供系统缓存查看/清理/刷新功能
 */
import { Router, Request, Response } from 'express';
import { authenticate, authorizePermission } from '../middleware/auth';

export const cacheRouter = Router();

cacheRouter.use(authenticate);
cacheRouter.use(authorizePermission('SYSTEM_MANAGEMENT'));

// 内存缓存存储
const memoryCache: Map<string, { value: unknown; createdAt: number }> = new Map();

// GET /api/cache — 查看缓存状态
cacheRouter.get('/', (_req: Request, res: Response) => {
  const entries = Array.from(memoryCache.entries()).map(([key, item]) => ({
    key,
    createdAt: new Date(item.createdAt).toISOString(),
    age: Math.round((Date.now() - item.createdAt) / 1000),
    size: JSON.stringify(item.value).length,
  }));

  res.json({
    data: {
      totalEntries: entries.length,
      entries,
      message: '缓存状态查询成功',
    },
  });
});

// POST /api/cache/clear — 清理缓存
cacheRouter.post('/clear', (_req: Request, res: Response) => {
  memoryCache.clear();
  res.json({ message: '缓存已清理', totalEntries: 0 });
});

// POST /api/cache/refresh — 刷新缓存（重建缓存数据）
cacheRouter.post('/refresh', async (_req: Request, res: Response) => {
  memoryCache.clear();

  // 重建缓存：预加载系统时间戳标记
  memoryCache.set('system_refreshed_at', {
    value: { refreshedAt: new Date().toISOString() },
    createdAt: Date.now(),
  });

  res.json({
    message: '缓存已刷新',
    totalEntries: memoryCache.size,
  });
});

// 导出缓存实例供其他模块使用
export { memoryCache };
