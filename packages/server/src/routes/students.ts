/**
 * 学生管理路由 — CRUD + 批量导入/导出
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { enqueueImport } from '../jobs/import-queue';

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
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 xlsx/xls/csv 格式'));
    }
  },
});

// ============================================================
// Zod Schemas
// ============================================================

const createStudentSchema = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(6).optional(), // 可选，默认用学号后6位
  realName: z.string().min(1),
  studentId: z.string().min(1), // 学号
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional(),
  classRoomId: z.string().uuid(),
});

const updateStudentSchema = z.object({
  realName: z.string().min(1).optional(),
  gender: z.enum(['MALE', 'FEMALE']).optional(),
  phoneNumber: z.string().optional(),
  email: z.string().email().optional(),
  classRoomId: z.string().uuid().optional(),
  accountStatus: z.enum(['ENABLED', 'DISABLED']).optional(),
});

// ============================================================
// 工具函数
// ============================================================

/** 默认密码规则：学号后6位，不足6位前面补0 */
function generateDefaultPassword(studentId: string): string {
  const raw = studentId.slice(-6);
  return raw.padStart(6, '0');
}

/** 性别中文 → 枚举 */
function parseGenderCN(val: string | undefined): 'MALE' | 'FEMALE' | undefined {
  if (!val) return undefined;
  const v = val.trim();
  if (v === '男') return 'MALE';
  if (v === '女') return 'FEMALE';
  return undefined;
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

    const where: any = { role: 'student' };

    if (search) {
      where.OR = [
        { username: { contains: String(search), mode: 'insensitive' } },
        { realName: { contains: String(search), mode: 'insensitive' } },
        { studentId: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
      ];
    }
    if (departmentId) where.departmentId = String(departmentId);
    if (majorId) where.majorId = String(majorId);
    if (classRoomId) where.classRoomId = String(classRoomId);

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
          createdAt: true,
          department: { select: { id: true, name: true, code: true } },
          major: { select: { id: true, name: true, code: true } },
          classRoom: { select: { id: true, name: true, code: true } },
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
// GET /api/students/:id — 学生详情（含组织关系）
// ============================================================

studentRouter.get('/:id', async (req: Request, res: Response) => {
  try {
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

    // 用户名唯一性
    const existingUsername = await prisma.user.findUnique({ where: { username: data.username } });
    if (existingUsername) {
      return res.status(409).json({ message: '用户名已存在' });
    }

    // 学号唯一性
    const existingStudentId = await prisma.user.findUnique({ where: { studentId: data.studentId } });
    if (existingStudentId) {
      return res.status(409).json({ message: '学号已存在' });
    }

    // 查询班级，获取 departmentId / majorId
    const classRoom = await prisma.classRoom.findUnique({ where: { id: data.classRoomId } });
    if (!classRoom) {
      return res.status(400).json({ message: '班级不存在' });
    }

    const password = data.password || generateDefaultPassword(data.studentId);
    const passwordHash = await bcrypt.hash(password, 10);

    const student = await prisma.user.create({
      data: {
        username: data.username,
        passwordHash,
        realName: data.realName,
        studentId: data.studentId,
        gender: data.gender,
        phoneNumber: data.phoneNumber,
        email: data.email,
        role: 'student',
        classRoomId: data.classRoomId,
        departmentId: classRoom.departmentId,
        majorId: classRoom.majorId,
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
    const data = updateStudentSchema.parse(req.body);

    // 检查学生存在
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, role: 'student' } });
    if (!existing) {
      return res.status(404).json({ message: '学生不存在' });
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

    const student = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(data.realName !== undefined && { realName: data.realName }),
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.phoneNumber !== undefined && { phoneNumber: data.phoneNumber }),
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
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// PUT /api/students/:id/reset-password — 重置学生密码
// ============================================================

studentRouter.put('/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const student = await prisma.user.findFirst({
      where: { id: req.params.id, role: 'student' },
      select: { id: true, studentId: true },
    });

    if (!student) {
      return res.status(404).json({ message: '学生不存在' });
    }

    const password = generateDefaultPassword(student.studentId || student.id);
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: student.id },
      data: { passwordHash },
    });

    res.json({ message: '密码已重置为默认密码' });
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
        type: 'student',
        fileName: originalName,
        totalRows,
        status: 'PENDING',
        createdBy: req.user!.userId,
      },
    });

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
    res.status(500).json({ message: '导入失败', detail: err.message });
  }
});

// ============================================================
// GET /api/students/export — 导出学生列表为 Excel
// ============================================================

studentRouter.get('/export', async (req: Request, res: Response) => {
  try {
    const { departmentId, majorId, classRoomId, search } = req.query;

    const where: any = { role: 'student' };
    if (departmentId) where.departmentId = String(departmentId);
    if (majorId) where.majorId = String(majorId);
    if (classRoomId) where.classRoomId = String(classRoomId);
    if (search) {
      where.OR = [
        { username: { contains: String(search), mode: 'insensitive' } },
        { realName: { contains: String(search), mode: 'insensitive' } },
        { studentId: { contains: String(search), mode: 'insensitive' } },
      ];
    }

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
    }

    // 邮箱格式
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rowErrors.push('邮箱格式不正确');
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

  // 批量创建学生（事务）
  if (rows.length > 0) {
    try {
      await prisma.$transaction(
        rows.map(row =>
          prisma.user.create({
            data: {
              username: row.studentId,
              passwordHash: '', // 占位，下面重新算
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

      // 事务成功后批量设置密码哈希
      for (const row of rows) {
        const password = generateDefaultPassword(row.studentId);
        const passwordHash = await bcrypt.hash(password, 10);
        await prisma.user.updateMany({
          where: { studentId: row.studentId },
          data: { passwordHash },
        });
      }

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
