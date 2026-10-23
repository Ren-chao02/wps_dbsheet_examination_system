/**
 * 学生管理路由 — CRUD + 批量导入/导出
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';

import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { enqueueImport } from '../jobs/import-queue';
import { wpsConfigService } from '../services/wps-config-service';

import { checkStudentAccess, denyAccess } from '../middleware/exam-ownership';
import { scopeCtxOf, studentWhere, myClassIds } from '../services/data-scope';
import { findIdentifierConflict, identifierConflictMessage } from '../services/user-identifiers';
import { hashPassword, verifyPassword } from '../services/password-hash';

export const studentRouter = Router();

// ============================================================
// 文件上传配置
// ============================================================

const uploadDir = path.join(__dirname, '../../uploads');
const errorDir = path.join(__dirname, '../../uploads/errors');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(errorDir)) fs.mkdirSync(errorDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 xlsx 格式'));
    }
  },
});

// ============================================================
// Zod Schemas
// ============================================================

const phoneRegex = /^1[3-9]\d{9}$/;

const createStudentSchema = z.object({
  // 兼容旧客户端：仍可传，但服务端忽略，登录名统一由学号派生
  username: z.string().min(2).max(64).optional(),
  password: z.string().min(6).optional(), // 可选，默认用学号后6位
  realName: z.string().min(1),
  studentId: z.string().min(1), // 学号，同时也是登录名
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  phoneNumber: z.string().regex(phoneRegex, '手机号格式不正确').optional().or(z.literal('')),
  email: z.string().email().optional(),
  classRoomId: z.string().uuid().optional(),
});

const updateStudentSchema = z.object({
  realName: z.string().min(1).optional(),
  studentId: z.string().min(1).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  phoneNumber: z.string().regex(phoneRegex, '手机号格式不正确').optional().or(z.literal('')),
  email: z.string().email().optional(),
  classRoomId: z.string().uuid().optional(),
  accountStatus: z.enum(['ENABLED', 'DISABLED']).optional(),
});

// ============================================================
// 工具函数
// ============================================================

/**
 * 新建/导入账号时的初始密码规则：学号后6位，不足6位前面补0。
 *
 * ⚠️ 已知风险：学号在学生之间基本公开，因此初始密码是可推算的
 * （同学之间可以互相猜到初始密码）。这里保留该规则是规模所迫 ——
 * 批量导入几千人时无法逐个分发随机口令；降低风险的正解是
 * 「首次登录强制改密」，属尚未实现的后续项（已记录在待办里）。
 * 注意：**重置**密码已改用随机口令（见 generateResetPassword）。
 */
function generateDefaultPassword(studentId: string): string {
  const raw = studentId.slice(-6);
  return raw.padStart(6, '0');
}

/**
 * 重置密码用的一次性随机口令。
 *
 * ⚠️ 历史实现是「学号后 6 位」：学号在学生之间基本是公开信息，
 * 这等于任何人都能推算出他人初始密码并冒用其账号登录（含考试成绩、身份）。
 * 现改为随机口令，重置后由教师一次性转告学生，系统不再留可推测的默认密码。
 *
 * 字符集去掉了易混淆的 0/O/1/I/l，方便口头转述与手抄。
 */
function generateResetPassword(length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** 性别中文 → 枚举 */
function parseGenderCN(val: string | undefined): 'MALE' | 'FEMALE' | null | undefined {
  if (!val) return undefined;
  const v = val.trim();
  if (v === '男') return 'MALE';
  if (v === '女') return 'FEMALE';
  return null; // 非法值
}

/** 枚举 → 性别中文 */
function genderToCN(gender: string | null | undefined): string {
  if (gender === 'MALE') return '男';
  if (gender === 'FEMALE') return '女';
  return '';
}

// ============================================================
// 认证
// ============================================================

studentRouter.use(authenticate);
studentRouter.use(authorize('admin', 'teacher'));

// ============================================================
// GET /api/students — 学生列表（分页 + 筛选）
// ============================================================

studentRouter.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      search,
      departmentId,
      majorId,
      classRoomId,
    } = req.query;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 数据范围：admin 全校；教师仅任教班级（未分班学生不在教师名册内）。
    // 与业务筛选用 AND 组合 —— search 会占用 OR 字段。
    const conditions: any[] = [await studentWhere(scopeCtxOf(req))];
    if (search) {
      conditions.push({
        OR: [
          { username: { contains: String(search), mode: 'insensitive' } },
          { realName: { contains: String(search), mode: 'insensitive' } },
          { studentId: { contains: String(search), mode: 'insensitive' } },
          { email: { contains: String(search), mode: 'insensitive' } },
        ],
      });
    }
    if (departmentId) conditions.push({ departmentId: String(departmentId) });
    if (majorId) conditions.push({ majorId: String(majorId) });
    if (classRoomId) conditions.push({ classRoomId: String(classRoomId) });
    const where: any = { AND: conditions };

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          realName: true,
          studentId: true,
          gender: true,
          phoneNumber: true,
          email: true,
          departmentId: true,
          majorId: true,
          classRoomId: true,
          accountStatus: true,
          // 登录安全 / WPS SSO 管理
          wpsUserId: true,
          wpsBoundAt: true,
          failedLoginAttempts: true,
          lockedUntil: true,
          createdAt: true,
          department: { select: { id: true, name: true, code: true } },
          major: { select: { id: true, name: true, code: true } },
          classRoom: { select: { id: true, name: true, code: true } },
          // ✅ 练习表格配置摘要（学生管理页显示"已配置/未配置"）
          practiceTableAssignment: { select: { id: true, fileId: true, shareUrl: true, updatedAt: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// 练习表格分配（题库练习/个人题集用；teacher/admin 代学生配置）
// ============================================================

const practiceFileSchema = z.object({
  shareUrl: z.string().min(1, '请粘贴该学生练习表格的分享链接'),
  accessToken: z.string().optional(),
});

/** 从分享链接中提取 fileId：https://www.kdocs.cn/l/xxxxxx */
function extractPracticeFileId(shareUrl: string): string | null {
  const match = shareUrl.trim().match(/\/l\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// GET /api/students/:id/practice-file — 查询单个学生的练习表格配置
studentRouter.get('/:id/practice-file', async (req: Request, res: Response) => {
  try {
    const access = await checkStudentAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const { id } = req.params;
    const student = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        realName: true,
        practiceTableAssignment: {
          // accessToken 不下发：它是可直接操作学生 WPS 文件的凭据，
          // 页面只需要知道"有没有配"与"配的是哪个文件"，用 hasToken 布尔值即可
          select: { fileId: true, shareUrl: true, updatedAt: true },
        },
      },
    });
    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }
    const practiceAssignment = student.practiceTableAssignment;
    res.json({
      student: { id: student.id, username: student.username, realName: student.realName },
      assignment: practiceAssignment
        ? { ...practiceAssignment, hasToken: true }
        : null,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/students/:id/practice-file — 配置/更新学生的练习表格
studentRouter.put('/:id/practice-file', async (req: Request, res: Response) => {
  try {
    const access = await checkStudentAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const parsed = practiceFileSchema.parse(req.body);
    const { id } = req.params;

    const student = await prisma.user.findFirst({
      where: { id, role: 'student' },
      select: { id: true, username: true, realName: true },
    });
    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }

    const shareUrl = parsed.shareUrl.trim();
    const fileId = extractPracticeFileId(shareUrl);
    if (!fileId) {
      return res.status(400).json({ message: '分享链接格式不正确，需包含 /l/xxxxxx（如 https://www.kdocs.cn/l/xxxxxx）' });
    }

    // accessToken 缺省时复用系统 WPS Token（WpsTokenManager 缓存）
    let accessToken = parsed.accessToken?.trim();
    if (!accessToken) {
      const cached = await wpsConfigService.get();
      accessToken = cached?.accessToken || '';
    }
    if (!accessToken) {
      return res.status(400).json({
        message: '未提供 access_token，且系统未配置 WPS Token。请先到「缓存管理 → WPS Token 管理」配置，或在弹窗中手动粘贴。',
      });
    }

    const assignment = await prisma.practiceTableAssignment.upsert({
      where: { studentId: student.id },
      update: { fileId, shareUrl, accessToken },
      create: { studentId: student.id, fileId, shareUrl, accessToken },
    });

    // 与 GET 同口径：不下发 accessToken（凭据只进不出），只告知"是否已配置"
    const { accessToken: _omit, ...safeAssignment } = assignment;
    res.json({
      student: { id: student.id, username: student.username, realName: student.realName },
      assignment: { ...safeAssignment, hasToken: true },
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/students/:id/practice-file — 清除学生的练习表格配置
studentRouter.delete('/:id/practice-file', async (req: Request, res: Response) => {
  try {
    const access = await checkStudentAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const { id } = req.params;
    const student = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }
    await prisma.practiceTableAssignment.deleteMany({ where: { studentId: student.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// GET /api/students/export — 导出学生列表为 Excel
// ============================================================

studentRouter.get('/export', async (req: Request, res: Response) => {
  try {
    const { departmentId, majorId, classRoomId, search } = req.query;

    const conditions: any[] = [await studentWhere(scopeCtxOf(req))];
    if (departmentId) conditions.push({ departmentId: String(departmentId) });
    if (majorId) conditions.push({ majorId: String(majorId) });
    if (classRoomId) conditions.push({ classRoomId: String(classRoomId) });
    if (search) {
      conditions.push({
        OR: [
          { username: { contains: String(search), mode: 'insensitive' } },
          { realName: { contains: String(search), mode: 'insensitive' } },
          { studentId: { contains: String(search), mode: 'insensitive' } },
        ],
      });
    }
    const where: any = { AND: conditions };

    const students = await prisma.user.findMany({
      where,
      orderBy: { studentId: 'asc' },
      select: {
        studentId: true,
        realName: true,
        gender: true,
        phoneNumber: true,
        email: true,
        department: { select: { name: true } },
        major: { select: { name: true } },
        classRoom: { select: { name: true, code: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('学生列表');

    // 表头
    worksheet.columns = [
      { header: '学号', key: 'studentId', width: 16 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: '性别', key: 'gender', width: 8 },
      { header: '手机号', key: 'phoneNumber', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '院系', key: 'department', width: 20 },
      { header: '专业', key: 'major', width: 20 },
      { header: '班级', key: 'classRoom', width: 20 },
      { header: '班级编码', key: 'classRoomCode', width: 16 },
    ];

    // 数据行
    for (const s of students) {
      worksheet.addRow({
        studentId: s.studentId || '',
        realName: s.realName || '',
        gender: genderToCN(s.gender),
        phoneNumber: s.phoneNumber || '',
        email: s.email || '',
        department: s.department?.name || '',
        major: s.major?.name || '',
        classRoom: s.classRoom?.name || '',
        classRoomCode: s.classRoom?.code || '',
      });
    }

    // 设置响应头
    const fileName = encodeURIComponent(`学生列表_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch {
    res.status(500).json({ message: '导出失败' });
  }
});

// ============================================================
// GET /api/students/import-template — 下载导入模板
// ============================================================

studentRouter.get('/import-template', async (_req: Request, res: Response) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('导入模板');

    worksheet.columns = [
      { header: '学号', key: 'studentId', width: 16 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: '性别(男/女)', key: 'gender', width: 10 },
      { header: '手机号', key: 'phoneNumber', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '班级编码', key: 'classRoomCode', width: 16 },
    ];

    // 设置表头样式（加粗）
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    const fileName = encodeURIComponent('学生导入模板.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    await workbook.xlsx.write(res);
    res.end();
  } catch {
    res.status(500).json({ message: '下载模板失败' });
  }
});

// ============================================================
// GET /api/students/:id — 学生详情（含组织关系）
// ============================================================

studentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const access = await checkStudentAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const student = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'student' },
      select: {
        id: true,
        username: true,
        realName: true,
        studentId: true,
        gender: true,
        phoneNumber: true,
        email: true,
        departmentId: true,
        majorId: true,
        classRoomId: true,
        accountStatus: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        department: { select: { id: true, name: true, code: true } },
        major: { select: { id: true, name: true, code: true } },
        classRoom: { select: { id: true, name: true, code: true } },
      },
    });

    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }

    res.json(student);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/students — 单个新增学生
// ============================================================

studentRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = createStudentSchema.parse(req.body);

    // 教师只能在本人任教的班级下建学生；「未分班学生」也属管理员职责（设计 §3.1）
    if (req.user!.role === 'teacher') {
      const classIds = await myClassIds(scopeCtxOf(req));
      if (!data.classRoomId || !classIds.includes(data.classRoomId)) {
        return res.status(403).json({ message: '只能在自己任教的班级下创建学生' });
      }
    }

    // 学号同时是登录名：检查它是否已被任意账号的 username/studentId/employeeId 占用
    const conflict = await findIdentifierConflict(data.studentId);
    if (conflict) {
      return res.status(409).json({ message: identifierConflictMessage(conflict) });
    }

    // 查询班级，获取 departmentId / majorId（仅当提供了 classRoomId 时）
    let departmentId: string | undefined;
    let majorId: string | undefined;
    if (data.classRoomId) {
      const classRoom = await prisma.classRoom.findUnique({ where: { id: data.classRoomId } });
      if (!classRoom) {
        return res.status(400).json({ message: '班级不存在' });
      }
      departmentId = classRoom.departmentId;
      majorId = classRoom.majorId;
    }

    const password = data.password || generateDefaultPassword(data.studentId);
    const passwordHash = await hashPassword(password);

    const student = await prisma.user.create({
      data: {
        // 学生登录名 = 学号；不再接受独立用户名
        username: data.studentId,
        passwordHash,
        realName: data.realName,
        studentId: data.studentId,
        gender: data.gender,
        phoneNumber: data.phoneNumber,
        email: data.email,
        role: 'student',
        classRoomId: data.classRoomId,
        departmentId,
        majorId,
      },
      select: {
        id: true,
        username: true,
        realName: true,
        studentId: true,
        gender: true,
        phoneNumber: true,
        email: true,
        departmentId: true,
        majorId: true,
        classRoomId: true,
        role: true,
        createdAt: true,
      },
    });

    res.status(201).json(student);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/students/:id — 更新学生信息
// ============================================================

studentRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const access = await checkStudentAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const data = updateStudentSchema.parse(req.body);

    // 检查学生存在
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, role: 'student' } });
    if (!existing) {
      return res.status(404).json({ message: '学生不存在' });
    }

    // 如果更新了 studentId：学号即登录名，必须同步检查全局标识冲突
    if (data.studentId && data.studentId !== existing.studentId) {
      const conflict = await findIdentifierConflict(data.studentId, existing.id);
      if (conflict) {
        return res.status(409).json({ message: identifierConflictMessage(conflict) });
      }
    }

    // 如果更新了 classRoomId，同步更新 departmentId / majorId
    let departmentId = existing.departmentId;
    let majorId = existing.majorId;
    if (data.classRoomId && data.classRoomId !== existing.classRoomId) {
      const classRoom = await prisma.classRoom.findUnique({ where: { id: data.classRoomId } });
      if (!classRoom) {
        return res.status(400).json({ message: '班级不存在' });
      }
      departmentId = classRoom.departmentId;
      majorId = classRoom.majorId;
    }

    // 空字符串手机号转为 null
    const phoneNumber = data.phoneNumber === '' ? null : data.phoneNumber;

    const student = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(data.studentId !== undefined && {
          studentId: data.studentId,
          // 学号变化时同步登录名，避免旧学号继续可登录、新旧标识分叉
          username: data.studentId,
        }),
        ...(data.realName !== undefined && { realName: data.realName }),
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.phoneNumber !== undefined && { phoneNumber }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.accountStatus !== undefined && { accountStatus: data.accountStatus }),
        ...(data.classRoomId !== undefined && {
          classRoomId: data.classRoomId,
          departmentId,
          majorId,
        }),
      },
      select: {
        id: true,
        username: true,
        realName: true,
        studentId: true,
        gender: true,
        phoneNumber: true,
        email: true,
        departmentId: true,
        majorId: true,
        classRoomId: true,
        updatedAt: true,
      },
    });

    res.json(student);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '学生不存在' });
    }
    if (err.code === 'P2002') {
      return res.status(409).json({ message: '学号或登录名已存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/students/:id/reset-password — 重置学生密码
// ============================================================

studentRouter.put('/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const access = await checkStudentAccess(req, req.params.id);
    if (access !== 'ok') return denyAccess(res, access);

    const student = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'student' },
      select: { id: true, studentId: true },
    });

    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }

    const password = generateResetPassword();
    const passwordHash = await hashPassword(password);

    await prisma.user.update({
      where: { id: student.id },
      data: { passwordHash },
    });

    // 口令只在这一处返回，系统不留明文；教师需当场转告学生
    res.json({ message: '密码已重置，请把新密码转告学生', password });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// DELETE /api/students/:id — 删除学生（admin only）
// ============================================================

studentRouter.delete('/:id', authorize('admin'), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, role: 'student' } });
    if (!existing) {
      return res.status(404).json({ message: '学生不存在' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '学生不存在' });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// POST /api/students/import — 批量导入
// ============================================================

studentRouter.post('/import', upload.single('file'), async (req: Request, res: Response) => {
  let importTaskId: string | null = null;
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
      return res.status(400).json({ message: 'Excel 文件为空' });
    }

    const totalRows = worksheet.rowCount - 1; // 去掉表头
    if (totalRows <= 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ message: 'Excel 无有效数据行' });
    }

    // 创建 ImportTask
    const importTask = await prisma.importTask.create({
      data: {
        type: 'student_import',
        fileName: originalName,
        totalRows,
        status: 'PENDING',
        createdBy: req.user!.userId,
      },
    });
    importTaskId = importTask.id;

    // 大文件（>100行）走异步队列，小文件同步处理
    if (totalRows > 100) {
      await enqueueImport(importTask.id, filePath);
      return res.json({
        message: '导入任务已提交，正在后台处理',
        taskId: importTask.id,
        async: true,
      });
    }

    // 同步处理
    const result = await processImport(importTask.id, filePath, req.user!.userId);

    // 清理临时文件
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      message: '导入完成',
      taskId: importTask.id,
      totalRows: result.totalRows,
      successRows: result.successRows,
      failedRows: result.failedRows,
      errorFile: result.errorFile ? `/api/import-tasks/${importTask.id}/error-file` : null,
      async: false,
    });
  } catch (err: any) {
    // 同步导入失败时，把任务标记为 FAILED，避免卡在 PENDING
    if (importTaskId) {
      try {
        await prisma.importTask.update({
          where: { id: importTaskId },
          data: { status: 'FAILED', completedAt: new Date() },
        });
      } catch {}
    }
    res.status(500).json({ message: '导入失败', detail: err.message });
  }
});

// ============================================================
// 导入处理核心逻辑（同步 & 异步共用）
// ============================================================

interface ImportErrorRow {
  studentId: string;
  realName: string;
  gender: string;
  phoneNumber: string;
  email: string;
  classRoomCode: string;
  error: string;
}

interface ImportResult {
  totalRows: number;
  successRows: number;
  failedRows: number;
  errorFile: string | null;
}

export async function processImport(
  taskId: string,
  filePath: string,
  userId: string,
): Promise<ImportResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    await prisma.importTask.update({
      where: { id: taskId },
      data: { status: 'FAILED', completedAt: new Date() },
    });
    return { totalRows: 0, successRows: 0, failedRows: 0, errorFile: null };
  }

  // 更新状态为处理中
  await prisma.importTask.update({
    where: { id: taskId },
    data: { status: 'PROCESSING' },
  });

  const errors: ImportErrorRow[] = [];
  let successRows = 0;
  let failedRows = 0;

  // 教师导入只能落到本人任教的班级（管理员的导入不受限）；超范围的行记为错误行，
  // 与其它行级校验同一口径 —— 不让整份文件失败，而是逐行报告（导入页展示错误明细）
  let allowedClassIds: Set<string> | null = null;
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (u?.role === 'teacher') {
      const myClasses = await prisma.teacherClass.findMany({
        where: { teacherId: userId },
        select: { classId: true },
      });
      allowedClassIds = new Set(myClasses.map((c) => c.classId));
    }
  }

  // 预加载所有班级编码映射
  const classRooms = await prisma.classRoom.findMany({
    select: { id: true, code: true, departmentId: true, majorId: true },
  });
  const classRoomMap = new Map(classRooms.map(c => [c.code, c]));

  // 预加载已有学号集合
  const existingStudentIds = new Set(
    (await prisma.user.findMany({
      where: { studentId: { not: null } },
      select: { studentId: true },
    })).map(u => u.studentId!),
  );

  // 用于检测本次导入中的学号重复
  const importedStudentIds = new Set<string>();

  const rows = [];
  for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
    const row = worksheet.getRow(rowNum);
    const studentId = String(row.getCell(1).value || '').trim();
    const realName = String(row.getCell(2).value || '').trim();
    const gender = String(row.getCell(3).value || '').trim();
    const phoneNumber = String(row.getCell(4).value || '').trim();
    const email = String(row.getCell(5).value || '').trim();
    const classRoomCode = String(row.getCell(6).value || '').trim();

    // 空行跳过
    if (!studentId && !realName) continue;

    // 验证
    const rowErrors: string[] = [];

    if (!studentId) rowErrors.push('学号不能为空');
    if (!realName) rowErrors.push('姓名不能为空');
    if (!classRoomCode) rowErrors.push('班级编码不能为空');

    // 学号唯一性
    if (studentId) {
      if (existingStudentIds.has(studentId)) {
        rowErrors.push('学号已存在');
      }
      if (importedStudentIds.has(studentId)) {
        rowErrors.push('学号在导入文件中重复');
      }
    }

    // 班级编码
    const classRoom = classRoomCode ? classRoomMap.get(classRoomCode) : undefined;
    if (classRoomCode && !classRoom) {
      rowErrors.push('班级编码不存在');
    } else if (classRoom && allowedClassIds && !allowedClassIds.has(classRoom.id)) {
      rowErrors.push('该班级不在你任教的班级内');
    }

    // 邮箱格式
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rowErrors.push('邮箱格式不正确');
    }

    // 手机号格式
    if (phoneNumber && !phoneRegex.test(phoneNumber)) {
      rowErrors.push('手机号格式不正确');
    }

    // 性别校验（parseGenderCN 对非法值返回 null）
    if (gender && parseGenderCN(gender) === null) {
      rowErrors.push('性别只能填男或女');
    }

    if (rowErrors.length > 0) {
      failedRows++;
      errors.push({
        studentId,
        realName,
        gender,
        phoneNumber,
        email,
        classRoomCode,
        error: rowErrors.join('; '),
      });
      continue;
    }

    // 有效行 — 记录待创建
    importedStudentIds.add(studentId!);
    rows.push({
      studentId: studentId!,
      realName: realName!,
      gender: parseGenderCN(gender),
      phoneNumber: phoneNumber || undefined,
      email: email || undefined,
      classRoom: classRoom!,
    });
  }

  // 全局标识守卫：学号=登录名，不能与教师工号/管理员登录名跨列冲突。
  // 批量预查一次，不逐行查库；已存在的 studentId 冲突在逐行校验里已经处理。
  if (rows.length > 0) {
    const ids = rows.map((row) => row.studentId);
    const crossColumn = await prisma.user.findMany({
      where: {
        OR: [{ username: { in: ids } }, { employeeId: { in: ids } }],
      },
      select: { username: true, employeeId: true },
    });
    if (crossColumn.length > 0) {
      const conflictIds = new Set<string>();
      for (const item of crossColumn) {
        if (item.username) conflictIds.add(item.username);
        if (item.employeeId) conflictIds.add(item.employeeId);
      }
      for (let i = rows.length - 1; i >= 0; i--) {
        if (!conflictIds.has(rows[i].studentId)) continue;
        const row = rows[i];
        failedRows++;
        errors.push({
          studentId: row.studentId,
          realName: row.realName,
          gender: row.gender === 'MALE' ? '男' : row.gender === 'FEMALE' ? '女' : '',
          phoneNumber: row.phoneNumber || '',
          email: row.email || '',
          classRoomCode: row.classRoom.code,
          error: '学号与已有账号的登录名/工号冲突',
        });
        rows.splice(i, 1);
      }
    }
  }

  // 批量创建学生（事务）— 先计算所有密码哈希
  if (rows.length > 0) {
    try {
      // 预先计算所有用户的密码哈希，避免密码空窗口
      const rowsWithHash = await Promise.all(
        rows.map(async (row) => {
          const password = generateDefaultPassword(row.studentId);
          const passwordHash = await hashPassword(password);
          return { ...row, passwordHash };
        }),
      );

      await prisma.$transaction(
        rowsWithHash.map(row =>
          prisma.user.create({
            data: {
              username: row.studentId,
              passwordHash: row.passwordHash,
              realName: row.realName,
              studentId: row.studentId,
              gender: row.gender,
              phoneNumber: row.phoneNumber,
              email: row.email,
              role: 'student',
              classRoomId: row.classRoom.id,
              departmentId: row.classRoom.departmentId,
              majorId: row.classRoom.majorId,
            },
          }),
        ),
      );

      successRows = rows.length;
    } catch (err: any) {
      // 事务失败，全部算失败
      failedRows += rows.length;
      for (const row of rows) {
        errors.push({
          studentId: row.studentId,
          realName: row.realName,
          gender: row.gender === 'MALE' ? '男' : row.gender === 'FEMALE' ? '女' : '',
          phoneNumber: row.phoneNumber || '',
          email: row.email || '',
          classRoomCode: row.classRoom.code,
          error: '数据库写入失败: ' + (err.message || '未知错误'),
        });
      }
    }
  }

  // 生成错误文件（如果有失败行）
  let errorFile: string | null = null;
  if (errors.length > 0) {
    const errorWorkbook = new ExcelJS.Workbook();
    const errorWorksheet = errorWorkbook.addWorksheet('导入失败记录');

    errorWorksheet.columns = [
      { header: '学号', key: 'studentId', width: 16 },
      { header: '姓名', key: 'realName', width: 12 },
      { header: '性别', key: 'gender', width: 8 },
      { header: '手机号', key: 'phoneNumber', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '班级编码', key: 'classRoomCode', width: 16 },
      { header: '错误原因', key: 'error', width: 40 },
    ];

    const headerRow = errorWorksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.commit();

    for (const e of errors) {
      errorWorksheet.addRow(e);
    }

    const errorFileName = `import_errors_${taskId}.xlsx`;
    const errorFilePath = path.join(errorDir, errorFileName);
    await errorWorkbook.xlsx.writeFile(errorFilePath);
    errorFile = errorFileName;
  }

  // 更新 ImportTask
  await prisma.importTask.update({
    where: { id: taskId },
    data: {
      totalRows: successRows + failedRows,
      successRows,
      failedRows,
      status: 'FINISHED',
      errorFile,
      completedAt: new Date(),
    },
  });

  return { totalRows: successRows + failedRows, successRows, failedRows, errorFile };
}
