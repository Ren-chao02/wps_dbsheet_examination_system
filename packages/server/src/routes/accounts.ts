/**
 * 账户管理路由 — 增强版用户管理（支持 systemRole、gender、remark）
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/prisma';
import { authenticate, authorizePermission } from '../middleware/auth';
import { findIdentifierConflict, identifierConflictMessage } from '../services/user-identifiers';

export const accountRouter = Router();

const upload = multer({
  dest: path.join(__dirname, '../../uploads/tmp'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 xlsx 格式'));
    }
  },
});

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
        { remark: { contains: String(search), mode: 'insensitive' } },
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
          gender: true,
          remark: true,
          employeeId: true,
          accountStatus: true,
          systemRoleId: true,
          departmentId: true, // P2：管理端编辑表单需预填所属院系
          systemRole: {
            select: { roleCode: true, roleName: true },
          },
          lastLoginAt: true,
          // 登录安全 / WPS SSO 管理
          wpsUserId: true,
          wpsBoundAt: true,
          failedLoginAttempts: true,
          lockedUntil: true,
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
// PUT /api/accounts/:id/disable — 禁用账户（须在 /:id 之前）
// ============================================================
accountRouter.put('/:id/disable', async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.user!.userId) {
      return res.status(400).json({ message: '不能禁用自己的账户' });
    }
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { accountStatus: 'DISABLED' },
    });
    res.json({ message: '账户已禁用', id: user.id });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/accounts/:id/enable — 启用账户（须在 /:id 之前）
// ============================================================
accountRouter.put('/:id/enable', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { accountStatus: 'ENABLED' },
    });
    res.json({ message: '账户已启用', id: user.id });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '用户不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/accounts — 新增单个账户
// ============================================================
const createAccountSchema = z
  .object({
    // 教师登录名由工号派生，不再单独填写；管理员系统账号仍使用独立登录名
    username: z.string().min(2).max(64).optional(),
    employeeId: z.string().min(1).max(64).optional(),
    password: z.string().min(6),
    realName: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    role: z.enum(['admin', 'teacher']).default('teacher'),
    gender: z.enum(['MALE', 'FEMALE', 'UNSET']).optional().nullable(),
    remark: z.string().max(512).optional().nullable(),
    systemRoleId: z.string().uuid().optional().nullable(),
    departmentId: z.string().uuid().optional().nullable(), // P2：教师归属院系（管理员/校长任命两级管理的基础）
  })
  .superRefine((value, ctx) => {
    if (value.role === 'teacher') {
      if (!value.employeeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['employeeId'],
          message: '教师账号必须填写工号',
        });
      } else if (value.username && value.username !== value.employeeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['username'],
          message: '教师登录名由工号决定，不能与工号不同',
        });
      }
    } else {
      if (!value.username) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['username'],
          message: '管理员系统账号必须填写登录名',
        });
      }
      if (value.employeeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['employeeId'],
          message: '管理员系统账号不使用工号',
        });
      }
    }
  });

accountRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = createAccountSchema.parse(req.body);
    const loginName = data.role === 'teacher' ? data.employeeId! : data.username!;

    // 全局标识守卫：教师登录名=工号时，不能与任何人的学号/工号/登录名冲突
    const conflict = await findIdentifierConflict(loginName);
    if (conflict) {
      return res.status(409).json({ message: identifierConflictMessage(conflict) });
    }

    // 验证 systemRoleId 存在且为 active
    if (data.systemRoleId) {
      const role = await prisma.systemRole.findUnique({ where: { id: data.systemRoleId } });
      if (!role) {
        return res.status(400).json({ message: '角色不存在' });
      }
    }

    // 院系非空时必须存在：否则会留下指向不存在院系的账号，
    // 后续按院系收口数据范围时这类账号谁都看不到（写库前拦截）
    if (data.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!department) {
        return res.status(400).json({ message: '院系不存在' });
      }
    }

    // ✅ 未指定系统角色时，按 role 自动分配预设角色（TEACHER / ADMIN）
    let systemRoleId = data.systemRoleId || null;
    if (!systemRoleId) {
      const presetRoleCode = data.role === 'admin' ? 'ADMIN' : 'TEACHER';
      const presetRole = await prisma.systemRole.findUnique({ where: { roleCode: presetRoleCode } });
      systemRoleId = presetRole?.id || null;
    }

    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        username: loginName,
        passwordHash,
        realName: data.realName,
        email: data.email,
        role: data.role,
        employeeId: data.role === 'teacher' ? data.employeeId! : null,
        gender: data.gender || null,
        remark: data.remark || null,
        systemRoleId,
        departmentId: data.departmentId ?? null,
      },
      select: {
        id: true,
        username: true,
        employeeId: true,
        realName: true,
        role: true,
        email: true,
        gender: true,
        remark: true,
        systemRoleId: true,
        departmentId: true,
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
  role: z.enum(['admin', 'teacher']).optional(),
  employeeId: z.string().min(1).max(64).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'UNSET']).optional().nullable(),
  remark: z.string().max(512).optional().nullable(),
  systemRoleId: z.string().uuid().optional().nullable(),
  accountStatus: z.enum(['ENABLED', 'DISABLED']).optional(),
  departmentId: z.string().uuid().optional().nullable(), // P2：教师归属院系（管理员/校长任命两级管理的基础）
});

accountRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const data = updateAccountSchema.parse(req.body);

    // ⚠️ 禁止自我提权/自我降权：若允许改自己的 role 或 systemRoleId，
    // 任何拿到 SYSTEM_MANAGEMENT 权限的账号都能把自己变成 admin（进而重置他人密码）。
    if (req.params.id === req.user!.userId && (data.role !== undefined || data.systemRoleId !== undefined)) {
      return res.status(400).json({ message: '不能修改自己的角色，请由其他管理员操作' });
    }

    const existing = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true, role: true, employeeId: true },
    });
    if (!existing) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 工号即登录名：教师改工号时同步 username；管理员系统账号不允许有工号
    let syncedUsername: string | undefined;
    let syncedEmployeeId: string | null | undefined;

    if (data.employeeId !== undefined) {
      if (existing.role !== 'teacher' || data.role === 'admin') {
        return res.status(400).json({ message: '只有教师账号可以设置工号' });
      }
      if (data.employeeId !== existing.employeeId) {
        const conflict = await findIdentifierConflict(data.employeeId, existing.id);
        if (conflict) {
          return res.status(409).json({ message: identifierConflictMessage(conflict) });
        }
        syncedUsername = data.employeeId;
      }
      syncedEmployeeId = data.employeeId;
    }

    // 教师 → 管理员：保留原登录名作为系统登录名，清掉工号
    if (data.role === 'admin' && existing.role === 'teacher') {
      syncedEmployeeId = null;
    }

    // 管理员 → 教师：必须同时提供工号
    if (data.role === 'teacher' && existing.role !== 'teacher' && !data.employeeId) {
      return res.status(400).json({ message: '管理员转为教师时必须填写工号' });
    }

    if (data.systemRoleId) {
      const role = await prisma.systemRole.findUnique({ where: { id: data.systemRoleId } });
      if (!role) {
        return res.status(400).json({ message: '角色不存在' });
      }
    }

    // departmentId 非空才校验存在（null 表示清空归属，无需查库）；
    // 未提供（undefined）时不碰该字段，避免把已有归属改没
    if (data.departmentId) {
      const department = await prisma.department.findUnique({ where: { id: data.departmentId } });
      if (!department) {
        return res.status(400).json({ message: '院系不存在' });
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(syncedUsername !== undefined && { username: syncedUsername }),
        ...(syncedEmployeeId !== undefined && { employeeId: syncedEmployeeId }),
        ...(data.realName !== undefined && { realName: data.realName }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.role !== undefined && { role: data.role }),
        // 注意：以下由上方守卫保证 —— 不允许修改自己的角色（防自我提权）
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.remark !== undefined && { remark: data.remark }),
        ...(data.systemRoleId !== undefined && { systemRoleId: data.systemRoleId }),
        ...(data.accountStatus !== undefined && { accountStatus: data.accountStatus }),
        ...(data.departmentId !== undefined && { departmentId: data.departmentId }),
      },
      select: {
        id: true,
        username: true,
        employeeId: true,
        realName: true,
        role: true,
        email: true,
        gender: true,
        remark: true,
        systemRoleId: true,
        departmentId: true,
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
// GET /api/accounts/:id/classes — 获取教师负责的班级列表
// ============================================================
accountRouter.get('/:id/classes', async (req: Request, res: Response) => {
  try {
    const teacherClasses = await prisma.teacherClass.findMany({
      where: { teacherId: req.params.id },
      include: {
        classRoom: {
          select: { id: true, name: true, code: true, departmentId: true, majorId: true },
        },
      },
    });
    res.json({ data: teacherClasses.map(tc => tc.classRoom) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/accounts/:id/classes — 更新教师负责的班级（全量覆盖）
// ============================================================
const updateClassesSchema = z.object({
  classIds: z.array(z.string()),
});

accountRouter.put('/:id/classes', async (req: Request, res: Response) => {
  try {
    const { classIds } = updateClassesSchema.parse(req.body);

    // 验证用户存在且为教师
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    if (user.role !== 'teacher') {
      return res.status(400).json({ message: '只有教师角色可以分配班级' });
    }

    // 事务：先删除旧关联，再创建新关联
    await prisma.$transaction([
      prisma.teacherClass.deleteMany({ where: { teacherId: req.params.id } }),
      ...classIds.map(classId =>
        prisma.teacherClass.create({
          data: { teacherId: req.params.id, classId },
        }),
      ),
    ]);

    res.json({ message: '班级分配已更新', teacherId: req.params.id, classIds });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/accounts/reset-password/:id — 重置密码
// ============================================================
/**
 * 重置密码用一次性随机口令（字符集去掉易混淆的 0/O/1/I/l，便于口头转告）。
 * 不使用固定弱口令，避免「猜到默认密码即可登录他人账号」。
 */
function generateResetPassword(length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

accountRouter.put('/reset-password/:id', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, username: true },
    });
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // ⚠️ 不再重置为固定弱口令 123456：管理员重置后若不转告，任何人猜到就能登录；
    // 改为随机口令并只在此处返回一次，由管理员转告使用者。
    const password = generateResetPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    res.json({ message: '密码已重置，请把新密码转告使用者', password });
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
      { header: '系统登录名(管理员必填)', key: 'username', width: 22 },
      { header: '密码(必填)', key: 'password', width: 14 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '角色编码(如TEACHER)', key: 'roleCode', width: 20 },
      // P2：院系编码取 Department.code（可选列，留空则不归属院系）
      { header: '院系编码', key: 'departmentCode', width: 16 },
      // 新模型：教师登录名 = 工号；管理员仍用第 1 列用户名（系统登录名）
      { header: '工号(教师必填)', key: 'employeeId', width: 18 },
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
  let filePath: string | undefined;
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请上传文件' });
    }

    filePath = req.file.path;
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

    // P2：院系编码是可选列（第 6 列）。先扫一遍收集文件里出现的编码，再按 in 一次性预加载
    // 映射——不逐行查库；未知编码留给主循环逐行报错，不在这里整份拦截。
    const deptCodes = new Set<string>();
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const code = String(worksheet.getRow(i).getCell(6).value || '').trim();
      if (code) deptCodes.add(code);
    }
    const departmentMap = new Map<string, string>(); // code → id
    if (deptCodes.size > 0) {
      const departments = await prisma.department.findMany({
        where: { code: { in: [...deptCodes] } },
        select: { id: true, code: true },
      });
      for (const d of departments) departmentMap.set(d.code, d.id);
    }

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

    // 模板列：1=系统登录名(管理员必填), 2=密码, 3=姓名, 4=邮箱, 5=角色编码,
    //         6=院系编码(可选), 7=工号(教师必填，且作为教师登录名)
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const username = String(row.getCell(1).value || '').trim();
      const password = String(row.getCell(2).value || '').trim();
      const realName = String(row.getCell(3).value || '').trim();
      const email = String(row.getCell(4).value || '').trim();
      const roleCode = String(row.getCell(5).value || '').trim().toUpperCase() || 'TEACHER';
      const departmentCode = String(row.getCell(6).value || '').trim();
      const employeeId = String(row.getCell(7).value || '').trim();

      const hasAny = Boolean(
        username || password || realName || email || departmentCode || employeeId,
      );
      if (!hasAny) continue;

      const userRole = roleCode === 'ADMIN' ? 'admin' : 'teacher';
      const isTeacher = userRole === 'teacher';
      const loginName = isTeacher ? employeeId : username;
      const rowLabel = loginName || username || `(第${i}行)`;

      totalRows++;

      if (!password) {
        failedRows++;
        errors.push({ row: i, username: rowLabel, error: '密码不能为空' });
        continue;
      }

      if (isTeacher ? !employeeId : !username) {
        failedRows++;
        errors.push({
          row: i,
          username: rowLabel,
          error: isTeacher ? '教师账号必须填写工号' : '管理员账号必须填写登录名',
        });
        continue;
      }

      if (isTeacher && username && username !== employeeId) {
        failedRows++;
        errors.push({
          row: i,
          username: rowLabel,
          error: '教师登录名由工号决定，登录名列应与工号一致或留空',
        });
        continue;
      }

      if (!isTeacher && employeeId) {
        failedRows++;
        errors.push({
          row: i,
          username: rowLabel,
          error: '管理员系统账号不使用工号',
        });
        continue;
      }

      if (password.length < 6) {
        failedRows++;
        errors.push({ row: i, username: rowLabel, error: '密码长度不能少于6位' });
        continue;
      }

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        failedRows++;
        errors.push({ row: i, username: rowLabel, error: '邮箱格式不正确' });
        continue;
      }

      // 院系编码可选；填了就必须能匹配到院系。与班级编码导入同一口径：
      // 只标记该行错误，其余行照常导入（整份拒绝会让老师面对一个错别字重传全部）
      if (departmentCode && !departmentMap.has(departmentCode)) {
        failedRows++;
        errors.push({ row: i, username: rowLabel, error: '院系编码不存在' });
        continue;
      }

      try {
        // 查找角色
        const systemRoleId = roleMap.get(roleCode);
        if (!systemRoleId && roleCode !== 'TEACHER') {
          failedRows++;
          errors.push({ row: i, username: rowLabel, error: `未知角色编码: ${roleCode}` });
          continue;
        }

        // 全局标识守卫：教师的工号/管理员的登录名不能与任何人的学号/工号/登录名冲突
        const conflict = await findIdentifierConflict(loginName);
        if (conflict) {
          failedRows++;
          errors.push({ row: i, username: rowLabel, error: identifierConflictMessage(conflict) });
          continue;
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await prisma.user.create({
          data: {
            username: loginName,
            employeeId: isTeacher ? employeeId : null,
            passwordHash,
            realName: realName || null,
            email: email || null,
            role: userRole,
            systemRoleId: systemRoleId || null,
            // 未填编码 → 显式落 null（与单个创建同一口径，不依赖数据库默认值）
            departmentId: departmentMap.get(departmentCode) ?? null,
          },
        });
        successRows++;
      } catch (err: any) {
        failedRows++;
        errors.push({ row: i, username: rowLabel, error: err.message || '未知错误' });
      }
    }

    // 生成错误文件
    let errorFile: string | null = null;
    if (errors.length > 0) {
      const errorWorkbook = new ExcelJS.Workbook();
      const errorSheet = errorWorkbook.addWorksheet('导入失败记录');
      errorSheet.columns = [
        { header: '行号', key: 'row', width: 8 },
        { header: '登录名', key: 'username', width: 18 },
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
        status: totalRows === 0 ? 'FINISHED' : (failedRows === totalRows ? 'FAILED' : 'FINISHED'),
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
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch {}
    }
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
        employeeId: true,
        realName: true,
        email: true,
        gender: true,
        remark: true,
        role: true,
        accountStatus: true,
        systemRole: { select: { roleName: true } },
        createdAt: true,
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('账户列表');

    worksheet.columns = [
      { header: '登录名', key: 'username', width: 18 },
      { header: '工号', key: 'employeeId', width: 16 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: '性别', key: 'gender', width: 10 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '角色', key: 'role', width: 14 },
      { header: '系统角色', key: 'systemRole', width: 16 },
      { header: '状态', key: 'status', width: 10 },
      { header: '备注', key: 'remark', width: 20 },
      { header: '创建时间', key: 'createdAt', width: 20 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    const genderMap: Record<string, string> = { MALE: '男', FEMALE: '女', UNSET: '未设置' };

    for (const a of accounts) {
      worksheet.addRow({
        username: a.username,
        employeeId: a.employeeId || '',
        realName: a.realName || '',
        gender: genderMap[a.gender as string] || '',
        email: a.email || '',
        role: a.role,
        systemRole: a.systemRole?.roleName || '',
        status: a.accountStatus === 'ENABLED' ? '启用' : '禁用',
        remark: a.remark || '',
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
