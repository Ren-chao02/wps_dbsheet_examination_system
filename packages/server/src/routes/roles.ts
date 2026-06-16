/**
 * 角色权限管理路由
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorizePermission } from '../middleware/auth';
import { SYSTEM_MODULES } from '../constants/modules';

export const roleRouter = Router();

// 所有接口需要认证 + SYSTEM_MANAGEMENT 权限
roleRouter.use(authenticate);
roleRouter.use(authorizePermission('SYSTEM_MANAGEMENT'));

// ============================================================
// GET /api/roles/modules — 获取所有可分配模块列表（须在 /:id 之前）
// ============================================================
roleRouter.get('/modules', (_req: Request, res: Response) => {
  res.json({ data: SYSTEM_MODULES });
});

// ============================================================
// GET /api/roles — 角色列表（含权限信息）
// ============================================================
roleRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const roles = await prisma.systemRole.findMany({
      orderBy: [{ roleType: 'asc' }, { createdAt: 'asc' }],
      include: {
        permissions: { select: { moduleCode: true } },
        _count: { select: { users: true } },
      },
    });

    res.json({
      data: roles.map((r) => ({
        id: r.id,
        roleCode: r.roleCode,
        roleName: r.roleName,
        roleType: r.roleType,
        description: r.description,
        status: r.status,
        permissions: r.permissions.map((p) => p.moduleCode),
        userCount: r._count.users,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// GET /api/roles/:id — 角色详情
// ============================================================
roleRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const role = await prisma.systemRole.findUnique({
      where: { id: req.params.id },
      include: {
        permissions: { select: { moduleCode: true } },
        _count: { select: { users: true } },
      },
    });

    if (!role) {
      return res.status(404).json({ message: '角色不存在' });
    }

    res.json({
      id: role.id,
      roleCode: role.roleCode,
      roleName: role.roleName,
      roleType: role.roleType,
      description: role.description,
      status: role.status,
      permissions: role.permissions.map((p) => p.moduleCode),
      userCount: role._count.users,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/roles — 创建自定义角色
// ============================================================
const createRoleSchema = z.object({
  roleCode: z.string().min(2).max(64).regex(/^[A-Z_0-9]+$/, '角色编码只允许大写字母、数字和下划线'),
  roleName: z.string().min(2).max(128),
  description: z.string().max(512).optional(),
  permissions: z.array(z.string()),
});

roleRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = createRoleSchema.parse(req.body);

    // 检查编码是否已存在
    const existing = await prisma.systemRole.findUnique({ where: { roleCode: data.roleCode } });
    if (existing) {
      return res.status(409).json({ message: '角色编码已存在' });
    }

    // 验证权限编码
    const validModules = SYSTEM_MODULES.map((m) => m.code);
    const invalidPerms = data.permissions.filter((p) => !validModules.includes(p as any));
    if (invalidPerms.length > 0) {
      return res.status(400).json({ message: `无效的权限编码: ${invalidPerms.join(', ')}` });
    }

    const role = await prisma.systemRole.create({
      data: {
        roleCode: data.roleCode,
        roleName: data.roleName,
        roleType: 'custom',
        description: data.description,
        createdBy: req.user!.userId,
        updatedBy: req.user!.userId,
        permissions: {
          create: data.permissions.map((code) => ({ moduleCode: code })),
        },
      },
      include: {
        permissions: { select: { moduleCode: true } },
      },
    });

    res.status(201).json({
      id: role.id,
      roleCode: role.roleCode,
      roleName: role.roleName,
      roleType: role.roleType,
      description: role.description,
      status: role.status,
      permissions: role.permissions.map((p) => p.moduleCode),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/roles/:id — 编辑自定义角色（预设角色不可改）
// ============================================================
const updateRoleSchema = z.object({
  roleName: z.string().min(2).max(128).optional(),
  description: z.string().max(512).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  permissions: z.array(z.string()).optional(),
});

roleRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const role = await prisma.systemRole.findUnique({ where: { id: req.params.id } });
    if (!role) {
      return res.status(404).json({ message: '角色不存在' });
    }
    if (role.roleType === 'preset') {
      return res.status(403).json({ message: '预设角色不可修改' });
    }

    const data = updateRoleSchema.parse(req.body);

    // 验证权限编码
    if (data.permissions) {
      const validModules = SYSTEM_MODULES.map((m) => m.code);
      const invalidPerms = data.permissions.filter((p) => !validModules.includes(p as any));
      if (invalidPerms.length > 0) {
        return res.status(400).json({ message: `无效的权限编码: ${invalidPerms.join(', ')}` });
      }
    }

    // 使用事务更新角色和权限
    const updated = await prisma.$transaction(async (tx) => {
      if (data.permissions) {
        await tx.systemRolePermission.deleteMany({ where: { roleId: req.params.id } });
        await tx.systemRolePermission.createMany({
          data: data.permissions.map((code) => ({ roleId: req.params.id, moduleCode: code })),
        });
      }

      return tx.systemRole.update({
        where: { id: req.params.id },
        data: {
          ...(data.roleName !== undefined && { roleName: data.roleName }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.status !== undefined && { status: data.status }),
          updatedBy: req.user!.userId,
        },
        include: {
          permissions: { select: { moduleCode: true } },
        },
      });
    });

    res.json({
      id: updated.id,
      roleCode: updated.roleCode,
      roleName: updated.roleName,
      roleType: updated.roleType,
      description: updated.description,
      status: updated.status,
      permissions: updated.permissions.map((p) => p.moduleCode),
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// DELETE /api/roles/:id — 删除自定义角色（预设角色不可删）
// ============================================================
roleRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const role = await prisma.systemRole.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });

    if (!role) {
      return res.status(404).json({ message: '角色不存在' });
    }
    if (role.roleType === 'preset') {
      return res.status(403).json({ message: '预设角色不可删除' });
    }
    if (role._count.users > 0) {
      return res.status(400).json({ message: `该角色下还有 ${role._count.users} 个用户，无法删除` });
    }

    await prisma.systemRole.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// GET /api/roles/:id/users — 获取拥有该角色的用户列表
// ============================================================
roleRouter.get('/:id/users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      where: { systemRoleId: req.params.id },
      select: {
        id: true,
        username: true,
        realName: true,
        email: true,
        accountStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: users });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
