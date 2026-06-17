import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const invitationRouter = Router();
export const applicationRouter = Router();

// ===== Zod Schemas =====

const createInvitationSchema = z.object({
  classRoomId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  maxUses: z.number().int().min(0).default(0),
});

const applySchema = z.object({
  realName: z.string().min(1).max(50),
  studentId: z.string().min(1).max(30),
  phoneNumber: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
});

const rejectSchema = z.object({
  rejectReason: z.string().min(1).max(500),
});

const batchApproveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

// ===== Helper: validate invitation =====

async function validateInvitation(code: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { code },
    include: {
      classRoom: {
        include: {
          department: true,
          major: true,
        },
      },
    },
  });

  if (!invitation) {
    return { valid: false as const, error: '邀请不存在', status: 404 };
  }

  if (invitation.status === 'DISABLED') {
    return { valid: false as const, error: '邀请已被禁用', status: 400 };
  }

  // 自动更新过期状态：如果邀请已过期但状态仍为ACTIVE，则更新为EXPIRED
  if (invitation.status === 'ACTIVE' && new Date(invitation.expiresAt) < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    });
    invitation.status = 'EXPIRED'; // 更新内存中的对象
  }

  if (invitation.status === 'EXPIRED') {
    return { valid: false as const, error: '邀请已过期', status: 400 };
  }

  if (invitation.maxUses > 0 && invitation.usedCount >= invitation.maxUses) {
    return { valid: false as const, error: '邀请已达使用上限', status: 400 };
  }

  return { valid: true as const, invitation };
}

// ===== Invitation Public Routes (无需认证) =====

// GET /api/invitations/:code/info - 获取邀请信息
invitationRouter.get('/:code/info', async (req: Request, res: Response) => {
  try {
    const result = await validateInvitation(req.params.code);

    if (!result.valid) {
      return res.status(result.status).json({ message: result.error });
    }

    const { classRoom, expiresAt, status, code } = result.invitation;

    res.json({
      code,
      status,
      expiresAt,
      classRoom: {
        name: classRoom.name,
        academicYear: classRoom.academicYear,
        major: { name: classRoom.major.name },
        department: { name: classRoom.department.name },
      },
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/invitations/:code/apply - 学生提交申请
invitationRouter.post('/:code/apply', async (req: Request, res: Response) => {
  try {
    const data = applySchema.parse(req.body);

    const result = await validateInvitation(req.params.code);

    if (!result.valid) {
      return res.status(result.status).json({ message: result.error });
    }

    // 检查学号是否已存在于用户表中
    const existingUser = await prisma.user.findUnique({
      where: { studentId: data.studentId },
    });
    if (existingUser) {
      return res.status(409).json({ message: '该学号已注册' });
    }

    // 检查学号是否有待审批的申请
    const pendingApplication = await prisma.studentApplication.findFirst({
      where: {
        studentId: data.studentId,
        status: 'PENDING',
      },
    });
    if (pendingApplication) {
      return res.status(409).json({ message: '该学号已有待审批的申请' });
    }

    // 使用事务：创建申请 + 增加邀请使用计数
    const application = await prisma.$transaction(async (tx) => {
      const app = await tx.studentApplication.create({
        data: {
          invitationId: result.invitation.id,
          realName: data.realName,
          studentId: data.studentId,
          phoneNumber: data.phoneNumber,
          gender: data.gender,
          status: 'PENDING',
        },
      });

      await tx.invitation.update({
        where: { id: result.invitation.id },
        data: { usedCount: { increment: 1 } },
      });

      return app;
    });

    res.status(201).json(application);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ===== Invitation Protected Routes (需要认证) =====

// POST /api/invitations - 创建邀请链接
invitationRouter.post(
  '/',
  authenticate,
  authorize('admin', 'teacher'),
  async (req: Request, res: Response) => {
    try {
      const data = createInvitationSchema.parse(req.body);

      // 验证班级存在
      const classRoom = await prisma.classRoom.findUnique({
        where: { id: data.classRoomId },
        include: { department: true, major: true },
      });

      if (!classRoom) {
        return res.status(404).json({ message: '班级不存在' });
      }

      const code = nanoid(8);

      const invitation = await prisma.invitation.create({
        data: {
          code,
          classRoomId: data.classRoomId,
          createdBy: req.user!.userId,
          expiresAt: new Date(data.expiresAt),
          maxUses: data.maxUses,
        },
        include: {
          classRoom: {
            include: {
              department: true,
              major: true,
            },
          },
          creator: {
            select: { id: true, username: true, realName: true },
          },
        },
      });

      res.status(201).json(invitation);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: '参数错误', errors: err.errors });
      }
      res.status(500).json({ message: '服务器错误' });
    }
  }
);

// GET /api/invitations - 获取邀请列表（当前用户创建的）
invitationRouter.get(
  '/',
  authenticate,
  authorize('admin', 'teacher'),
  async (req: Request, res: Response) => {
    try {
      const { page = '1', pageSize = '20', status } = req.query;
      const skip = (Number(page) - 1) * Number(pageSize);
      const take = Number(pageSize);

      // 批量修正过期状态：将所有已过期但状态仍为ACTIVE的邀请更新为EXPIRED
      await prisma.invitation.updateMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED' },
      });

      const where: any = { createdBy: req.user!.userId };
      if (status) {
        where.status = String(status);
      }

      const [invitations, total] = await Promise.all([
        prisma.invitation.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: 'desc' },
          include: {
            classRoom: {
              include: {
                department: true,
                major: true,
              },
            },
            creator: {
              select: { id: true, username: true, realName: true },
            },
            _count: {
              select: { applications: true },
            },
          },
        }),
        prisma.invitation.count({ where }),
      ]);

      res.json({ data: invitations, total, page: Number(page), pageSize: Number(pageSize) });
    } catch {
      res.status(500).json({ message: '服务器错误' });
    }
  }
);

// PUT /api/invitations/:id/disable - 禁用邀请
invitationRouter.put(
  '/:id/disable',
  authenticate,
  authorize('admin', 'teacher'),
  async (req: Request, res: Response) => {
    try {
      const invitation = await prisma.invitation.findUnique({
        where: { id: req.params.id },
      });

      if (!invitation) {
        return res.status(404).json({ message: '邀请不存在' });
      }

      if (invitation.createdBy !== req.user!.userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: '无权操作此邀请' });
      }

      const updated = await prisma.invitation.update({
        where: { id: req.params.id },
        data: { status: 'DISABLED' },
        include: {
          classRoom: {
            include: {
              department: true,
              major: true,
            },
          },
        },
      });

      res.json(updated);
    } catch (err: any) {
      if (err.code === 'P2025') {
        return res.status(404).json({ message: '邀请不存在' });
      }
      res.status(500).json({ message: '服务器错误' });
    }
  }
);

// ===== Application Routes (需要认证) =====

applicationRouter.use(authenticate);
applicationRouter.use(authorize('admin', 'teacher'));

// GET /api/applications - 获取待审批列表
applicationRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', status } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (status) {
      where.status = String(status);
    }

    const [applications, total] = await Promise.all([
      prisma.studentApplication.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          invitation: {
            include: {
              classRoom: {
                include: {
                  department: true,
                  major: true,
                },
              },
            },
          },
          reviewer: {
            select: { id: true, username: true, realName: true },
          },
        },
      }),
      prisma.studentApplication.count({ where }),
    ]);

    res.json({ data: applications, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/applications/batch-approve - 批量审批通过（放在 :id 路由之前，避免被匹配）
applicationRouter.put('/batch-approve', async (req: Request, res: Response) => {
  try {
    const data = batchApproveSchema.parse(req.body);

    let success = 0;
    let failed = 0;
    const errors: { id: string; reason: string }[] = [];

    await prisma.$transaction(async (tx) => {
      for (const id of data.ids) {
        try {
          const application = await tx.studentApplication.findUnique({
            where: { id },
            include: {
              invitation: {
                include: {
                  classRoom: true,
                },
              },
            },
          });

          if (!application) {
            failed++;
            errors.push({ id, reason: '申请不存在' });
            continue;
          }

          if (application.status !== 'PENDING') {
            failed++;
            errors.push({ id, reason: '该申请已被处理' });
            continue;
          }

          // 检查学号是否已注册
          const existingUser = await tx.user.findUnique({
            where: { studentId: application.studentId },
          });
          if (existingUser) {
            failed++;
            errors.push({ id, reason: '该学号已注册' });
            continue;
          }

          const { classRoom } = application.invitation;
          const studentIdSuffix = application.studentId.slice(-6);
          const passwordHash = await bcrypt.hash(studentIdSuffix, 10);

          // 创建用户
          await tx.user.create({
            data: {
              username: application.studentId,
              passwordHash,
              role: 'student',
              realName: application.realName,
              studentId: application.studentId,
              gender: application.gender,
              phoneNumber: application.phoneNumber,
              classRoomId: application.invitation.classRoomId,
              majorId: classRoom.majorId,
              departmentId: classRoom.departmentId,
              accountStatus: 'ENABLED',
            },
          });

          // 更新申请状态
          await tx.studentApplication.update({
            where: { id },
            data: {
              status: 'APPROVED',
              reviewedBy: req.user!.userId,
              reviewedAt: new Date(),
            },
          });

          success++;
        } catch {
          failed++;
          errors.push({ id, reason: '处理失败' });
        }
      }
    });

    res.json({ success, failed, errors });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/applications/:id/approve - 审批通过
applicationRouter.put('/:id/approve', async (req: Request, res: Response) => {
  try {
    const application = await prisma.studentApplication.findUnique({
      where: { id: req.params.id },
      include: {
        invitation: {
          include: {
            classRoom: {
              include: {
                department: true,
                major: true,
              },
            },
          },
        },
      },
    });

    if (!application) {
      return res.status(404).json({ message: '申请不存在' });
    }

    if (application.status !== 'PENDING') {
      return res.status(400).json({ message: '该申请已被处理' });
    }

    // 检查学号是否已被注册
    const existingUser = await prisma.user.findUnique({
      where: { studentId: application.studentId },
    });
    if (existingUser) {
      return res.status(409).json({ message: '该学号已注册，无法再次通过' });
    }

    const { classRoom } = application.invitation;
    const studentIdSuffix = application.studentId.slice(-6);
    const passwordHash = await bcrypt.hash(studentIdSuffix, 10);

    // 使用事务：创建用户 + 更新申请状态
    const [user, updatedApp] = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          username: application.studentId,
          passwordHash,
          role: 'student',
          realName: application.realName,
          studentId: application.studentId,
          gender: application.gender,
          phoneNumber: application.phoneNumber,
          classRoomId: application.invitation.classRoomId,
          majorId: classRoom.majorId,
          departmentId: classRoom.departmentId,
          accountStatus: 'ENABLED',
        },
        select: {
          id: true,
          username: true,
          realName: true,
          role: true,
          studentId: true,
          classRoomId: true,
          createdAt: true,
        },
      });

      const app = await tx.studentApplication.update({
        where: { id: application.id },
        data: {
          status: 'APPROVED',
          reviewedBy: req.user!.userId,
          reviewedAt: new Date(),
        },
      });

      return [newUser, app];
    });

    res.json({ application: updatedApp, user });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '申请不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/applications/:id/reject - 审批拒绝
applicationRouter.put('/:id/reject', async (req: Request, res: Response) => {
  try {
    const data = rejectSchema.parse(req.body);

    const application = await prisma.studentApplication.findUnique({
      where: { id: req.params.id },
    });

    if (!application) {
      return res.status(404).json({ message: '申请不存在' });
    }

    if (application.status !== 'PENDING') {
      return res.status(400).json({ message: '该申请已被处理' });
    }

    const updated = await prisma.studentApplication.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        reviewedBy: req.user!.userId,
        reviewedAt: new Date(),
        rejectReason: data.rejectReason,
      },
      include: {
        invitation: {
          include: {
            classRoom: {
              include: {
                department: true,
                major: true,
              },
            },
          },
        },
        reviewer: {
          select: { id: true, username: true, realName: true },
        },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '申请不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
