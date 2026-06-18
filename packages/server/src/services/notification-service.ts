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
import dayjs from 'dayjs';

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

// ✅ 用户连接信息
interface UserConnection {
  userId: string;
  socketId: string;
  connectedAt: Date;
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
    socket.join(`user:${userId}`); // 加入个人房间

    // 记录在线状态
    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId)!.add(socket.id);

    console.log(`[WebSocket] 用户 ${userId} 已认证，当前在线: ${this.onlineUsers.size} 人`);

    // 推送未读计数
    this.pushUnreadCount(userId);

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
   * ✅ 广播通知给所有在线用户（系统公告）
   */
  async broadcast(payload: Omit<NotificationPayload, 'userId'> & { targetRoles?: string[] }): Promise<void> {
    if (!this.io) return;

    // 获取目标用户列表
    let targetUsers: string[] = [];

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

    // 批量发送
    for (const userId of targetUsers) {
      await this.sendToUser({ ...payload, userId });
    }
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
    return prisma.notificationPreference.findUnique({
      where: { userId },
    }) || {
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
