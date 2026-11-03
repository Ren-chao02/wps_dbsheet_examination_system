/**
 * 个人信息 — 三种角色共用
 *
 * 权限：只需登录（authenticate），所有查询都以 req.user.userId 为边界，
 * 不接收任何“查别人”的参数，因此无需再按角色分流。
 *
 * 注意：姓名/学号/工号/班级/院系来自名册，属于权威数据，本模块只读；
 * 唯一可自助修改的是登录密码。
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate } from '../middleware/auth';
import { hashPassword, passwordChangedTimestamp, verifyPassword } from '../services/password-hash';
import { logger } from '../utils/logger';

export const profileRouter = Router();

profileRouter.use(authenticate);

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, '请输入原密码'),
  // 与账号创建时的 6 位下限相比，自助改密要求更长：这是学生默认口令的第一道升级。
  newPassword: z.string().min(8, '新密码至少 8 位').max(64, '新密码最长 64 位'),
});

profileRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        avatarUrl: true,
        email: true,
        phoneNumber: true,
        gender: true,
        studentId: true,
        employeeId: true,
        accountStatus: true,
        createdAt: true,
        lastLoginAt: true,
        wpsBoundAt: true,
        systemRole: { select: { roleCode: true, roleName: true } },
        department: { select: { name: true } },
        major: { select: { name: true } },
        classRoom: { select: { name: true, academicYear: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 关联名称拍平，前端不必理解 Prisma 的关系结构；
    // 其余字段（含 passwordHash）不在此 select 内，天然不会泄露。
    res.json({
      ...user,
      department: user.department?.name ?? null,
      major: user.major?.name ?? null,
      classRoom: user.classRoom?.name ?? null,
      academicYear: user.classRoom?.academicYear ?? null,
    });
  } catch (err) {
    logger.error({ err }, '[profile/me] 读取个人信息失败');
    res.status(500).json({ message: '服务器错误' });
  }
});

profileRouter.post('/change-password', async (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || '参数不合法' });
  }

  const { oldPassword, newPassword } = parsed.data;

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { passwordHash: true },
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (!(await verifyPassword(oldPassword, user.passwordHash))) {
      return res.status(400).json({ message: '原密码不正确' });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ message: '新密码不能与原密码相同' });
    }

    await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        // 供 authenticate 判定旧 token 失效：改密前签发的 token 立即作废，
        // 不必等 24 小时（或“记住我”7 天）自然过期。
        passwordChangedAt: passwordChangedTimestamp(),
      },
    });

    res.json({ message: '密码已修改，请重新登录' });
  } catch (err) {
    logger.error({ err }, '[profile/change-password] 修改密码失败');
    res.status(500).json({ message: '服务器错误' });
  }
});
