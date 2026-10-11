/**
 * ✅ 实时通知服务 (Notification Service)
 *
 * 核心功能：
 * - WebSocket连接管理（用户在线状态）
 * - 实时消息推送到指定用户
 * - 通知持久化（数据库存储）
 * - 邮件发送（异步队列）
 * - 事件驱动触发机制
 *
 * 使用方式：
 * const notificationService = new NotificationService(server);
 * await notificationService.sendToUser(userId, { type: 'EXAM', title: '...' });
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { PrismaClient, NotificationType, NotificationPriority } from '@prisma/client';

const prisma = new PrismaClient();

// ✅ 通知数据接口
export interface NotificationPayload {
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  content?: string;
  userId: string;           // 接收者ID
  entityType?: string;      // 关联实体类型
  entityId?: string;        // 关联实体ID
  actionUrl?: string;       // 点击跳转链接
  senderId?: string;        // 发送者ID（可选）
}

class NotificationService {
  private io: SocketIOServer | null = null;
  private onlineUsers: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>

  /**
   * 初始化Socket.IO服务器
   */
  initialize(io: SocketIOServer): void {
    this.io = io;

    // 连接事件处理
    io.on('connection', (socket: Socket) => {
      console.log(`[WebSocket] 用户连接: ${socket.id}`);

      // 用户认证并加入房间
      socket.on('auth:user', (userId: string) => {
        this.handleUserAuth(socket, userId);
      });

      // 断开连接处理
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // 标记通知已读
      socket.on('notification:read', async (notificationIds: string[]) => {
        await this.markAsRead(notificationIds, socket.data.userId);
      });
    });

    console.log('[NotificationService] WebSocket服务已初始化');
  }

  /**
   * 处理用户认证
   */
  private handleUserAuth(socket: Socket, userId: string): void {
    socket.data.userId = userId;
    // 加入个人房间。socket.join 在异步适配器下返回 Promise——失败意味着该用户
    // 再也收不到实时通知，必须留痕，否则「在线但没通知」根本无从排查。
    // 用 void + catch 而不是 await：连接建立不该卡在房间加入上。
    void Promise.resolve(socket.join(`user:${userId}`)).catch((err) => {
      console.error(`[NotificationService] 用户 ${userId} 加入通知房间失败:`, err);
    });

    // 记录在线状态
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId)!.add(socket.id);

    console.log(`[WebSocket] 用户 ${userId} 已认证，当前在线: ${this.onlineUsers.size} 人`);

    // 推送未读计数：失败只影响角标数字，不该阻断连接建立，但必须留痕
    this.pushUnreadCount(userId).catch((err) => {
      console.error(`[NotificationService] 推送未读计数失败 userId=${userId}:`, err);
    });

    // 发送欢迎消息
    socket.emit('notification:system', {
      type: 'welcome',
      message: '已连接到实时通知服务',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 处理断开连接
   */
  private handleDisconnect(socket: Socket): void {
    const userId = socket.data.userId;

    if (userId) {
      const sockets = this.onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          this.onlineUsers.delete(userId);
          console.log(`[WebSocket] 用户 ${userId} 已离线`);
        }
      }
    }

    console.log(`[WebSocket] 连接断开: ${socket.id}`);
  }

  /**
   * ✅ 发送通知给单个用户（核心方法）
   */
  async sendToUser(payload: NotificationPayload): Promise<{ success: boolean; notificationId?: string }> {
    try {
      // 1. 持久化到数据库
      const notification = await prisma.notification.create({
        data: {
          type: payload.type,
          priority: payload.priority || NotificationPriority.MEDIUM,
          title: payload.title,
          content: payload.content,
          userId: payload.userId,
          entityType: payload.entityType,
          entityId: payload.entityId,
          actionUrl: payload.actionUrl,
          senderId: payload.senderId,
        },
      });

      // 2. 检查用户偏好设置
      const prefs = await this.getUserPreferences(payload.userId);

      // 3. WebSocket实时推送（如果在线且启用）
      if (prefs?.enableWebPush && this.io && this.isOnline(payload.userId)) {
        this.io.to(`user:${payload.userId}`).emit('notification:new', {
          id: notification.id,
          ...payload,
          createdAt: notification.createdAt,
        });

        // 更新发送标记
        await prisma.notification.update({
          where: { id: notification.id },
          data: { sentViaWeb: true },
        });
      }

      // 4. 异步邮件发送（如果启用且配置了SMTP）
      if (prefs?.enableEmail && this.shouldSendEmail(prefs, payload.type)) {
        this.sendEmailAsync(notification, payload.userId).catch(err => {
          console.error('邮件发送失败:', err);
        });
      }

      return { success: true, notificationId: notification.id };
    } catch (err) {
      console.error('发送通知失败:', err);
      return { success: false };
    }
  }

  /**
   * ✅ 批量发送通知（取代对每个用户串行调用 sendToUser）
   *
   * 旧实现的 broadcast 对每个目标用户串行 2~3 次 DB 查询，
   * 3000 人规模就是上万次串行查询。这里改为：
   * 1. 一次 createMany 批量落库（含 senderId，返回带 id 的记录用于推送）
   * 2. 一次查询批量取所有接收者偏好
   * 3. 批量 emit 给在线用户 + 一次 updateMany 回写 sentViaWeb
   *
   * 说明：批量路径不触发邮件（sendEmailAsync 目前只是日志桩，逐人查询
   * email + 延时更新在批量场景会放大为数千次无意义操作；接入真实 SMTP
   * 时再引入批量邮件队列）。
   */
  async sendToUsers(payloads: NotificationPayload[]): Promise<{ success: boolean; count: number }> {
    try {
      // 去重（同一接收者只建一条）
      const seen = new Set<string>();
      const unique = payloads.filter(p => {
        if (seen.has(p.userId)) return false;
        seen.add(p.userId);
        return true;
      });
      if (unique.length === 0) return { success: true, count: 0 };

      // 1. 批量落库（一次 createMany，返回带 id 的记录用于推送）
      const created = await prisma.notification.createManyAndReturn({
        data: unique.map(p => ({
          type: p.type,
          priority: p.priority || NotificationPriority.MEDIUM,
          title: p.title,
          content: p.content,
          userId: p.userId,
          entityType: p.entityType,
          entityId: p.entityId,
          actionUrl: p.actionUrl,
          senderId: p.senderId,
        })),
      });

      // 2. 批量取偏好（一次查询）
      const prefs = await prisma.notificationPreference.findMany({
        where: { userId: { in: unique.map(p => p.userId) } },
      });
      const prefsMap = new Map(prefs.map(x => [x.userId, x]));

      // 3. 批量推送在线用户
      if (this.io) {
        const webSentIds: string[] = [];
        for (const n of created) {
          // 未配置偏好的用户沿用默认：开启 WebPush
          const pref = prefsMap.get(n.userId);
          if ((pref?.enableWebPush ?? true) && this.isOnline(n.userId)) {
            this.io.to(`user:${n.userId}`).emit('notification:new', {
              id: n.id,
              type: n.type,
              priority: n.priority,
              title: n.title,
              content: n.content,
              entityType: n.entityType,
              entityId: n.entityId,
              actionUrl: n.actionUrl,
              createdAt: n.createdAt,
            });
            webSentIds.push(n.id);
          }
        }
        if (webSentIds.length > 0) {
          await prisma.notification.updateMany({
            where: { id: { in: webSentIds } },
            data: { sentViaWeb: true },
          });
        }
      }

      return { success: true, count: created.length };
    } catch (err) {
      console.error('批量发送通知失败:', err);
      return { success: false, count: 0 };
    }
  }

  /**
   * ✅ 广播通知（按角色筛选或全部在线用户，系统公告）
   */
  async broadcast(payload: Omit<NotificationPayload, 'userId'> & { targetRoles?: string[] }): Promise<void> {
    if (!this.io) return;

    // 获取目标用户列表（下面 if/else 必然赋值）
    let targetUsers: string[];

    if (payload.targetRoles && payload.targetRoles.length > 0) {
      // 按角色筛选
      const users = await prisma.user.findMany({
        where: { role: { in: payload.targetRoles as any } },
        select: { id: true },
      });
      targetUsers = users.map(u => u.id);
    } else {
      // 所有在线用户
      targetUsers = Array.from(this.onlineUsers.keys());
    }

    if (targetUsers.length === 0) return;

    // 批量落库 + 批量推送（不再逐人串行查询）
    await this.sendToUsers(targetUsers.map(userId => ({ ...payload, userId })));
  }

  /**
   * ✅ 推送未读计数
   */
  async pushUnreadCount(userId: string): Promise<void> {
    if (!this.io) return;

    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    this.io.to(`user:${userId}`).emit('notification:unread_count', count);
  }

  /**
   * ✅ 标记通知为已读
   */
  async markAsRead(notificationIds: string[], userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    // 更新未读计数
    await this.pushUnreadCount(userId);

    return result.count;
  }

  /**
   * ✅ 全部标记为已读
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    await this.pushUnreadCount(userId);

    return result.count;
  }

  /**
   * ✅ 检查用户是否在线
   */
  isOnline(userId: string): boolean {
    return this.onlineUsers.has(userId) && this.onlineUsers.get(userId)!.size > 0;
  }

  /**
   * ✅ 获取在线用户数
   */
  getOnlineCount(): number {
    return this.onlineUsers.size;
  }

  /**
   * 获取用户偏好设置
   */
  private async getUserPreferences(userId: string): Promise<any> {
    // 注意这里必须 await 后再判空。
    // 原写法 `return prisma.x.findUnique(...) || {默认值}` 中，Promise 对象恒为真，
    // 默认值分支永远不会执行——没有偏好记录的用户会拿到 null，调用方写的是
    // `prefs?.enableWebPush`，于是「实时推送」被静默关掉。
    // 而本文件另一处（按用户批量推送）用的是 `pref?.enableWebPush ?? true`，
    // 与数据库默认值一致，两处行为原本是矛盾的。
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });
    return prefs ?? {
      enableWebPush: true,
      enableEmail: false,
      emailFrequency: 'realtime',
    };
  }

  /**
   * 判断是否需要发送邮件
   */
  private shouldSendEmail(prefs: any, type: NotificationType): boolean {
    // 检查分类开关
    switch (type) {
      case NotificationType.SYSTEM:
        return prefs.enableSystem !== false;
      case NotificationType.EXAM:
        return prefs.enableExam !== false;
      case NotificationType.GRADE:
        return prefs.enableGrade !== false;
      case NotificationType.ALERT:
        return prefs.enableAlert !== false;
      case NotificationType.AUDIT:
        return prefs.enableAudit !== false;
      default:
        return true;
    }
  }

  /**
   * 异步发送邮件（基础实现）
   */
  private async sendEmailAsync(notification: any, userId: string): Promise<void> {
    try {
      // TODO: 集成实际SMTP库（如nodemailer）
      // 这里仅记录日志，生产环境应实现真实邮件发送

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, realName: true },
      });

      if (user?.email) {
        console.log(`[EmailService] 待发送邮件至 ${user.email}:`, {
          subject: `[考试系统] ${notification.title}`,
          body: notification.content,
        });

        // 模拟延迟后更新标记
        setTimeout(async () => {
          await prisma.notification.update({
            where: { id: notification.id },
            data: { sentViaEmail: true },
          });
        }, 1000);
      }
    } catch (err) {
      console.error('准备邮件失败:', err);
    }
  }
}

// ✅ 单例导出
export const notificationService = new NotificationService();
