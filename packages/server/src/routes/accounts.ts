/**
 * 账户管理路由 — 增强版用户管理（支持 systemRole、wpsId、批量导入）
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/prisma';
import { authenticate, authorizePermission } from '../middleware/auth';

export const accountRouter = Router();

const upload = multer({ dest: path.join(__dirname, '../../uploads/tmp') });

// 所有接口需要认证 + SYSTEM_MANAGEMENT 权限
accountRouter.use(authenticate);
accountRouter.use(authorizePermission('SYSTEM_MANAGEMENT'));

// ============================================================
// GET /api/accounts — 账户列表（分页，支持搜索和角色筛选）
// ============================================================
accountRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', search, systemRoleId, role, status } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    // 默认排除学生角色（账户管理主要管理教师/管理员）
    if (!role) {
      where.role = { not: 'student' };
    } else {
      where.role = String(role);
    }

    if (search) {
      where.OR = [
        { username: { contains: String(search), mode: 'insensitive' } },
        { realName: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { wpsId: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    if (systemRoleId) {
      where.systemRoleId = String(systemRoleId);
    }
    if (status) {
      where.accountStatus = String(status);
    }

    const [accounts, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          realName: true,
          role: true,
          email: true,
          wpsId: true,
          employeeId: true,
          accountStatus: true,
          systemRoleId: true,
          systemRole: {
            select: { roleCode: true, roleName: true },
          },
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: accounts, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/accounts — 新增单个账户
// ============================================================
const createAccountSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6),
  realName: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'teacher']).default('teacher'),
  wpsId: z.string().max(128).optional(),
  systemRoleId: z.string().uuid().optional().nullable(),
});

accountRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = createAccountSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { username: data.username } });
    if (existing) {
      return res.status(409).json({ message: '用户名已存在' });
    }

    // 验证 systemRoleId 存在且为 active
    if (data.systemRoleId) {
      const role = await prisma.systemRole.findUnique({ where: { id: data.systemRoleId } });
      if (!role) {
        return res.status(400).json({ message: '角色不存在' });
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        realName: data.realName,
        email: data.email,
        role: data.role,
        wpsId: data.wpsId || null,
        systemRoleId: data.systemRoleId || null,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        email: true,
        wpsId: true,
        systemRoleId: true,
        systemRole: { select: { roleCode: true, roleName: true } },
        accountStatus: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/accounts/:id — 编辑账户
// ============================================================
const updateAccountSchema = z.object({
  realName: z.string().optional(),
  email: z.string().email().optional().nullable(),
  role: z.enum(['admin', 'teacher', 'student']).optional(),
  wpsId: z.string().max(128).optional().nullable(),
  systemRoleId: z.string().uuid().optional().nullable(),
  accountStatus: z.enum(['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL']).optional(),
});

accountRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const data = updateAccountSchema.parse(req.body);

    if (data.systemRoleId) {
      const role = await prisma.systemRole.findUnique({ where: { id: data.systemRoleId } });
      if (!role) {
        return res.status(400).json({ message: '角色不存在' });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(data.realName !== undefined && { realName: data.realName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.wpsId !== undefined && { wpsId: data.wpsId }),
        ...(data.systemRoleId !== undefined && { systemRoleId: data.systemRoleId }),
        ...(data.accountStatus !== undefined && { accountStatus: data.accountStatus }),
      },
      select: {
        id: true,
        username: true,
        realName: true,
        role: true,
        email: true,
        wpsId: true,
        systemRoleId: true,
        systemRole: { select: { roleCode: true, roleName: true } },
        accountStatus: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// DELETE /api/accounts/:id — 删除账户
// ============================================================
accountRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    // 不允许删除自己
    if (req.params.id === req.user!.userId) {
      return res.status(400).json({ message: '不能删除自己的账户' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/accounts/reset-password/:id — 重置密码
// ============================================================
accountRouter.put('/reset-password/:id', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true },
    });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const defaultPassword = '123456';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    res.json({ message: '密码已重置为默认密码 (123456)' });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// GET /api/accounts/import-template — 下载账户导入模板
// ============================================================
accountRouter.get('/import-template', async (_req: Request, res: Response) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('账户导入模板');

    worksheet.columns = [
      { header: '用户名(必填)', key: 'username', width: 18 },
      { header: '密码(必填)', key: 'password', width: 14 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: 'WPSID(企业账号ID)', key: 'wpsId', width: 20 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '角色编码(如TEACHER)', key: 'roleCode', width: 20 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    const fileName = encodeURIComponent('账户导入模板.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch {
    res.status(500).json({ message: '下载模板失败' });
  }
});

// ============================================================
// POST /api/accounts/import — 批量导入账户
// ============================================================
accountRouter.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请上传文件' });
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;

    // 读取 Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ message: '文件内容为空' });
    }

    // 预加载所有角色
    const allRoles = await prisma.systemRole.findMany({ select: { id: true, roleCode: true } });
    const roleMap = new Map(allRoles.map((r) => [r.roleCode, r.id]));

    let totalRows = 0;
    let successRows = 0;
    let failedRows = 0;
    const errors: { row: number; username: string; error: string }[] = [];

    // 创建 ImportTask
    const importTask = await prisma.importTask.create({
      data: {
        type: 'account',
        fileName: originalName,
        taskName: '批量导入账户',
        totalRows: 0,
        status: 'PROCESSING',
        createdBy: req.user!.userId,
      },
    });

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const username = String(row.getCell(1).value || '').trim();
      const password = String(row.getCell(2).value || '').trim();
      const realName = String(row.getCell(3).value || '').trim();
      const wpsId = String(row.getCell(4).value || '').trim();
      const email = String(row.getCell(5).value || '').trim();
      const roleCode = String(row.getCell(6).value || '').trim() || 'TEACHER';

      if (!username || !password) {
        if (username || password || realName || wpsId || email) {
          totalRows++;
          failedRows++;
          errors.push({ row: i, username: username || `(第${i}行)`, error: '用户名和密码不能为空' });
        }
        continue;
      }

      totalRows++;

      try {
        // 检查用户名是否已存在
        const existing = await prisma.user.findUnique({ where: { username } });
        if (existing) {
          failedRows++;
          errors.push({ row: i, username, error: '用户名已存在' });
          continue;
        }

        // 查找角色
        const systemRoleId = roleMap.get(roleCode) || null;
        const userRole = roleCode === 'ADMIN' ? 'admin' : 'teacher';

        const passwordHash = await bcrypt.hash(password, 10);
        await prisma.user.create({
          data: {
            username,
            passwordHash,
            realName: realName || null,
            wpsId: wpsId || null,
            email: email || null,
            role: userRole,
            systemRoleId,
          },
        });
        successRows++;
      } catch (err: any) {
        failedRows++;
        errors.push({ row: i, username, error: err.message || '未知错误' });
      }
    }

    // 生成错误文件
    let errorFile: string | null = null;
    if (errors.length > 0) {
      const errorWorkbook = new ExcelJS.Workbook();
      const errorSheet = errorWorkbook.addWorksheet('导入失败记录');
      errorSheet.columns = [
        { header: '行号', key: 'row', width: 8 },
        { header: '用户名', key: 'username', width: 18 },
        { header: '失败原因', key: 'error', width: 40 },
      ];
      const errHeaderRow = errorSheet.getRow(1);
      errHeaderRow.font = { bold: true };
      errHeaderRow.commit();
      for (const e of errors) {
        errorSheet.addRow(e);
      }

      const errorDir = path.join(__dirname, '../../uploads/errors');
      if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });
      const errorFileName = `account_import_errors_${importTask.id}.xlsx`;
      await errorWorkbook.xlsx.writeFile(path.join(errorDir, errorFileName));
      errorFile = errorFileName;
    }

    // 更新 ImportTask
    await prisma.importTask.update({
      where: { id: importTask.id },
      data: {
        totalRows,
        successRows,
        failedRows,
        errorFile,
        status: failedRows === totalRows ? 'FAILED' : 'FINISHED',
        completedAt: new Date(),
      },
    });

    // 清理临时文件
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      message: '导入完成',
      taskId: importTask.id,
      totalRows,
      successRows,
      failedRows,
      errorFile: errorFile ? `/api/import-tasks/${importTask.id}/error-file` : null,
    });
  } catch (err: any) {
    res.status(500).json({ message: '导入失败', detail: err.message });
  }
});

// ============================================================
// GET /api/accounts/export — 导出账户列表
// ============================================================
accountRouter.get('/export', async (req: Request, res: Response) => {
  try {
    const where: any = { role: { not: 'student' } };
    if (req.query.systemRoleId) {
      where.systemRoleId = String(req.query.systemRoleId);
    }

    const accounts = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        username: true,
        realName: true,
        email: true,
        wpsId: true,
        role: true,
        accountStatus: true,
        systemRole: { select: { roleName: true } },
        createdAt: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('账户列表');

    worksheet.columns = [
      { header: '用户名', key: 'username', width: 18 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: 'WPSID', key: 'wpsId', width: 20 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '角色', key: 'role', width: 14 },
      { header: '系统角色', key: 'systemRole', width: 16 },
      { header: '状态', key: 'status', width: 10 },
      { header: '创建时间', key: 'createdAt', width: 20 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    for (const a of accounts) {
      worksheet.addRow({
        username: a.username,
        realName: a.realName || '',
        wpsId: a.wpsId || '',
        email: a.email || '',
        role: a.role,
        systemRole: a.systemRole?.roleName || '',
        status: a.accountStatus === 'ACTIVE' ? '正常' : a.accountStatus === 'INACTIVE' ? '禁用' : '待审批',
        createdAt: new Date(a.createdAt).toLocaleString('zh-CN'),
      });
    }

    const fileName = encodeURIComponent(`账户列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch {
    res.status(500).json({ message: '导出失败' });
  }
});
