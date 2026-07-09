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
  senderId: z.string().uuid().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

// 手动发送通知请求
const sendNotificationSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).optional(),        // 接收者ID列表
  classRoomIds: z.array(z.string().uuid()).min(1).optional(),   // 班级ID列表（会自动展开为学生）
  type: z.nativeEnum(NotificationType),
  priority: z.nativeEnum(NotificationPriority).optional(),
  title: z.string().min(1).max(256),
  content: z.string().max(2000).optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  actionUrl: z.string().url().optional(),
}).refine(data => data.userIds || data.classRoomIds, {
  message: '请选择接收用户或班级',
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

// 通知模板
const createTemplateSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.nativeEnum(NotificationType),
  title: z.string().min(1).max(256),
  content: z.string().max(2000).optional(),
});

const updateTemplateSchema = createTemplateSchema.partial();

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

    // 如果传了 senderId，查询"我发送的"通知（发送历史）；否则查询"我收到的"通知
    const where: any = query.senderId
      ? { senderId: query.senderId }
      : { userId };
    if (query.isRead !== undefined) where.isRead = query.isRead;
    if (query.type) where.type = query.type;
    if (query.createdAfter || query.createdBefore) {
      where.createdAt = {};
      if (query.createdAfter) where.createdAt.gte = query.createdAfter;
      if (query.createdBefore) where.createdAt.lte = query.createdBefore;
    }

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 模板 CRUD（必须在 :id 路由之前）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/templates', async (_req: Request, res: Response) => {
  try {
    // 如果没有模板，自动预置考试通知模板
    const count = await prisma.notificationTemplate.count();
    console.log('[Templates] current count:', count);
    if (count === 0) {
      // 查找第一个管理员用户作为模板创建者
      const adminUser = await prisma.user.findFirst({
        where: { role: 'admin', accountStatus: 'ENABLED' },
        select: { id: true },
      });
      console.log('[Templates] admin user found:', adminUser?.id || 'none');
      const defaultCreatorId = adminUser?.id || '00000000-0000-0000-0000-000000000000';
      const defaults = [
        { name: '考试即将开始', type: 'EXAM' as const, title: '考试即将开始', content: '请做好考试准备，按时进入考场。', createdBy: defaultCreatorId },
        { name: '考试时间变更', type: 'EXAM' as const, title: '考试时间调整通知', content: '考试时间已调整，请留意新的考试安排。', createdBy: defaultCreatorId },
        { name: '成绩已发布', type: 'GRADE' as const, title: '考试成绩已公布', content: '您的考试成绩已发布，请登录系统查看。', createdBy: defaultCreatorId },
        { name: '试卷批阅完成', type: 'GRADE' as const, title: '试卷已批阅', content: '试卷批阅已完成，请查看成绩详情。', createdBy: defaultCreatorId },
      ];
      for (const tpl of defaults) {
        console.log('[Templates] creating template:', tpl.name);
        await prisma.notificationTemplate.create({ data: tpl });
      }
      console.log('[Templates] seed completed');
    }

    const templates = await prisma.notificationTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: { creator: { select: { id: true, username: true, realName: true } } },
    });
    res.json({ success: true, data: templates });
  } catch (err: any) {
    console.error('[Templates] error:', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const data = createTemplateSchema.parse(req.body);
    const template = await prisma.notificationTemplate.create({
      data: { ...data, createdBy: userId },
    });
    res.status(201).json({ success: true, data: template });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: err.errors });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const data = updateTemplateSchema.parse(req.body);
    const template = await prisma.notificationTemplate.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: template });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: err.errors });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    await prisma.notificationTemplate.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: '模板已删除' });
  } catch (err: any) {
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
    const userId = (req as any).user?.id;
    const body = sendNotificationSchema.parse(req.body);

    // 解析接收者：如果提供了班级ID，展开为班级内所有学生
    let targetUserIds: string[] = body.userIds || [];
    if (body.classRoomIds && body.classRoomIds.length > 0) {
      const classStudents = await prisma.user.findMany({
        where: {
          classRoomId: { in: body.classRoomIds },
          role: 'student',
          accountStatus: 'ENABLED',
        },
        select: { id: true },
      });
      targetUserIds = [...new Set([...targetUserIds, ...classStudents.map(u => u.id)])];
    }
    if (targetUserIds.length === 0) {
      return res.status(400).json({ success: false, error: '没有找到有效的接收者' });
    }

    const results = [];
    for (const targetUserId of targetUserIds) {
      await notificationService.sendToUser({
        ...body,
        userId: targetUserId,
        senderId: userId,  // 记录发送者
      } as any);
      // 也直接通过 DB 写入 senderId（notificationService 可能不包含该字段）
      const notification = await prisma.notification.create({
        data: {
          type: body.type,
          priority: body.priority || 'MEDIUM',
          title: body.title,
          content: body.content,
          userId: targetUserId,
          entityType: body.entityType,
          entityId: body.entityId,
          actionUrl: body.actionUrl,
          senderId: userId,
        },
      });
      results.push({ success: true, notificationId: notification.id });
    }

    const successCount = results.length;

    res.json({
      success: true,
      message: `成功发送 ${successCount}/${targetUserIds.length} 条通知`,
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
