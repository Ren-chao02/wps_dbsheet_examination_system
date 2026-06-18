/**
 * ✅ 通知管理 API 路由
 *
 * 提供完整的通知CRUD和管理功能：
 * - 通知列表查询（分页、筛选、未读优先）
 * - 标记已读/全部已读
 * - 未读统计
 * - 偏好设置管理
 * - 手动发送通知（管理员）
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient, NotificationType, NotificationPriority } from '@prisma/client';
import { notificationService } from '../services/notification-service';

const router = Router();
const prisma = new PrismaClient();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1️⃣ Zod Schema 定义
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 查询参数
const queryNotificationsSchema = z.object({
  isRead: z.coerce.boolean().optional(),
  type: z.nativeEnum(NotificationType).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

// 手动发送通知请求
const sendNotificationSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1), // 接收者ID列表
  type: z.nativeEnum(NotificationType),
  priority: z.nativeEnum(NotificationPriority).optional(),
  title: z.string().min(1).max(256),
  content: z.string().max(2000).optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  actionUrl: z.string().url().optional(),
});

// 更新偏好设置
const updatePreferenceSchema = z.object({
  enableWebPush: z.boolean().optional(),
  enableEmail: z.boolean().optional(),
  enableSystem: z.boolean().optional(),
  enableExam: z.boolean().optional(),
  enableGrade: z.boolean().optional(),
  enableAlert: z.boolean().optional(),
  enableAudit: z.boolean().optional(),
  emailFrequency: z.enum(['realtime', 'hourly', 'daily']).optional(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2️⃣ API 端点实现
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * GET /api/notifications
 *
 * 功能：获取当前用户的通知列表
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const query = queryNotificationsSchema.parse(req.query);

    const where: any = { userId };
    if (query.isRead !== undefined) where.isRead = query.isRead;
    if (query.type) where.type = query.type;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: [{ isRead: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (err: any) {
    console.error('查询通知失败:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/notifications/unread-count
 *
 * 功能：快速获取当前用户未读通知数量
 */
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    res.json({ success: true, count });
  } catch (err: any) {
    console.error('获取未读数失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/notifications/:id/read
 *
 * 功能：标记单条通知为已读
 */
router.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    await prisma.notification.updateMany({
      where: { id: req.params.id, userId },
      data: { isRead: true, readAt: new Date() },
    });

    // 推送更新后的未读计数
    await notificationService.pushUnreadCount(userId);

    res.json({ success: true, message: '已标记为已读' });
  } catch (err: any) {
    console.error('标记已读失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/notifications/read-all
 *
 * 功能：将所有通知标记为已读
 */
router.put('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const count = await notificationService.markAllAsRead(userId);

    res.json({ success: true, message: `已将 ${count} 条通知标记为已读` });
  } catch (err: any) {
    console.error('全部标记已读失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/notifications/:id
 *
 * 功能：删除单条通知
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;

    await prisma.notification.deleteMany({
      where: { id: req.params.id, ...(userId ? { userId } : {}) },
    });

    // 如果是自己的通知，更新未读计数
    if (userId) {
      await notificationService.pushUnreadCount(userId);
    }

    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    console.error('删除通知失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/notifications/send
 *
 * 功能：管理员手动发送通知（支持批量）
 */
router.post('/send', async (req: Request, res: Response) => {
  try {
    // TODO: 权限检查（需admin角色）
    const body = sendNotificationSchema.parse(req.body);

    const results = [];
    for (const userId of body.userIds) {
      const result = await notificationService.sendToUser({
        ...body,
        userId,
      });
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      success: true,
      message: `成功发送 ${successCount}/${body.userIds.length} 条通知`,
      results,
    });
  } catch (err: any) {
    console.error('发送通知失败:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/notifications/preferences
 *
 * 功能：获取用户通知偏好设置
 */
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    let prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    // 如果不存在，创建默认配置
    if (!prefs) {
      prefs = await prisma.notificationPreference.create({
        data: { userId },
      });
    }

    res.json({ success: true, data: prefs });
  } catch (err: any) {
    console.error('获取偏好设置失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/notifications/preferences
 *
 * 功能：更新用户通知偏好设置
 */
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: '未授权' });
    }

    const data = updatePreferenceSchema.parse(req.body);

    const prefs = await prisma.notificationPreference.upsert({
      where: { userId },
      create: { ...data, userId },
      update: data,
    });

    res.json({ success: true, data: prefs, message: '设置已更新' });
  } catch (err: any) {
    console.error('更新偏好设置失败:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

export { router as notificationRouter };
