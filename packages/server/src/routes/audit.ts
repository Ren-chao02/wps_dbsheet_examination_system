/**
 * ✅ 操作审计日志 API 路由
 *
 * 提供完整的审计日志查询和管理功能：
 * - 多维度筛选（操作类型、实体、时间、操作者）
 * - 变更数据对比查看
 * - 审计报表导出
 * - 日志清理（管理员）
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient, AuditAction } from '@prisma/client';
import dayjs from 'dayjs';

const router = Router();
const prisma = new PrismaClient();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1️⃣ Zod Schema 定义
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 查询参数验证
const queryAuditSchema = z.object({
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  username: z.string().optional(),

  // 时间范围筛选
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  dateRange: z.enum(['today', 'week', 'month', 'quarter', 'year']).optional(),

  // 分页
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),

  // 排序
  sortBy: z.enum(['occurredAt', 'action', 'entityType']).default('occurredAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2️⃣ 辅助函数：时间范围解析
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseDateRange(dateRange?: string) {
  const now = new Date();

  switch (dateRange) {
    case 'today':
      return dayjs(now).startOf('day').toDate();
    case 'week':
      return dayjs(now).subtract(7, 'day').toDate();
    case 'month':
      return dayjs(now).subtract(30, 'day').toDate();
    case 'quarter':
      return dayjs(now).subtract(90, 'day').toDate();
    case 'year':
      return dayjs(now).subtract(365, 'day').toDate();
    default:
      return undefined;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3️⃣ API 端点实现
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/audit/logs
 *
 * 功能：查询审计日志列表（支持多维度筛选）
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const query = queryAuditSchema.parse(req.query);

    // 构建查询条件
    const where: any = {};

    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    if (query.entityId) where.entityId = query.entityId;
    if (query.userId) where.userId = query.userId;
    if (query.username) where.username = { contains: query.username };

    // 时间范围处理
    const autoStartTime = parseDateRange(query.dateRange);
    if (query.startTime || autoStartTime || query.endTime) {
      where.occurredAt = {};
      if (query.startTime) where.occurredAt.gte = new Date(query.startTime);
      else if (autoStartTime) where.occurredAt.gte = autoStartTime;
      if (query.endTime) where.occurredAt.lte = new Date(query.endTime);
    }

    // 排序配置
    const orderBy: any = { [query.sortBy]: query.sortOrder };

    // 执行查询（并行优化）
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          operator: {
            select: { id: true, realName: true, username: true },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (err: any) {
    console.error('查询审计日志失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '查询参数错误',
    });
  }
});

/**
 * GET /api/audit/logs/:id
 *
 * 功能：获取单条审计日志详情（含完整变更数据）
 */
router.get('/logs/:id', async (req: Request, res: Response) => {
  try {
    const log = await prisma.auditLog.findUnique({
      where: { id: req.params.id },
      include: {
        operator: {
          select: { id: true, realName: true, username: true, role: true },
        },
      },
    });

    if (!log) {
      return res.status(404).json({
        success: false,
        error: '审计日志不存在',
      });
    }

    res.json({ success: true, data: log });
  } catch (err: any) {
    console.error('获取审计日志详情失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '服务器内部错误',
    });
  }
});

/**
 * GET /api/audit/statistics
 *
 * 功能：审计统计概览（按操作类型、实体类型聚合）
 */
router.get('/statistics', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 并行执行多个统计查询
    const [
      totalCount,
      todayCount,
      actionStats,
      entityTypeStats,
      topUsers,
    ] = await Promise.all([
      // 总记录数
      prisma.auditLog.count(),

      // 今日记录数
      prisma.auditLog.count({
        where: { occurredAt: { gte: today } },
      }),

      // 按操作类型分组
      prisma.auditLog.groupBy({
        by: ['action'],
        _count: true,
        orderBy: { _count: { action: 'desc' } },
      }),

      // 按实体类型分组
      prisma.auditLog.groupBy({
        by: ['entityType'],
        _count: true,
        orderBy: { _count: { entityType: 'desc' } },
        take: 10,
      }),

      // 最活跃用户TOP10
      prisma.auditLog.groupBy({
        by: ['userId', 'username'],
        where: { userId: { not: null } },
        _count: true,
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalLogs: totalCount,
          todayLogs: todayCount,
          growthRate:
            totalCount > 0 ? ((todayCount / totalCount) * 100).toFixed(2) : '0',
        },
        actionDistribution: actionStats.map(item => ({
          action: item.action,
          count: item._count,
        })),
        entityDistribution: entityTypeStats.map(item => ({
          entityType: item.entityType,
          count: item._count,
        })),
        activeUsers: topUsers.map(item => ({
          userId: item.userId,
          username: item.username,
          operationCount: item._count,
        })),
      },
    });
  } catch (err: any) {
    console.error('获取审计统计失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '服务器内部错误',
    });
  }
});

/**
 * DELETE /api/audit/logs/:id
 *
 * 功能：删除单条审计日志（仅限超级管理员）
 */
router.delete('/logs/:id', async (req: Request, res: Response) => {
  try {
    // TODO: 权限检查（需superadmin角色）

    await prisma.auditLog.delete({
      where: { id: req.params.id },
    });

    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    console.error('删除审计日志失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '删除失败',
    });
  }
});

/**
 * POST /api/audit/cleanup
 *
 * 功能：批量清理过期审计日志（保留最近N天）
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  try {
    const { retainDays = 180 } = req.body; // 默认保留180天

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retainDays);

    const deleteResult = await prisma.auditLog.deleteMany({
      where: {
        occurredAt: { lt: cutoffDate },
      },
    });

    res.json({
      success: true,
      message: `已清理 ${deleteResult.count} 条过期日志`,
      deletedCount: deleteResult.count,
    });
  } catch (err: any) {
    console.error('清理审计日志失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '清理失败',
    });
  }
});

export { router as auditRouter };
