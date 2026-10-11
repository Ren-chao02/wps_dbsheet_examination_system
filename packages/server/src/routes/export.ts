/**
 * ✅ 统一数据导出 API 路由
 *
 * 提供完整的导出管理功能：
 * - 触发导出任务（同步/异步）
 * - 查询导出历史
 * - 下载文件
 * - 预设模板管理
 */

import { Router, Request, Response } from 'express';
import { join } from 'path';
import { existsSync, unlinkSync, createReadStream } from 'fs';
import { z } from 'zod';
import { ExportFormat, exportService, TaskStatus } from '../services/export-service';
import { authenticate, authorize } from '../middleware/auth';
import { prisma } from '../config/prisma';

const router = Router();
router.use(authenticate);
router.use(authorize('teacher', 'admin'));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 导出安全护栏（防内存打满 / 事件循环卡死）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 单次导出行数上限：超出时明确报错提示缩小范围，绝不静默截断
const MAX_EXPORT_ROWS = 50000;
// 日志/成绩类实体长期累积可达十万级，无显式时间筛选时默认只导出最近 N 天
const DEFAULT_EXPORT_WINDOW_DAYS = 30;
// 并发导出上限：同时最多 2 个导出在跑，超出直接拒绝（不排队，前端可稍后重试）
const MAX_CONCURRENT_EXPORTS = 2;
// 模块级在跑计数（进程内即可：导出是本服务内 CPU/内存消耗，无需跨实例锁）
let activeExportCount = 0;

/**
 * 给日志类实体补默认时间窗口：仅当调用方未显式给出该字段筛选时才补。
 * 需要导出更早的历史数据时，在 filters 里显式传时间范围即可覆盖。
 */
function withDefaultTimeWindow(
  filters: Record<string, any> | undefined,
  field: string,
): Record<string, any> {
  const f = { ...(filters || {}) };
  if (f[field] === undefined) {
    f[field] = { gte: new Date(Date.now() - DEFAULT_EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000) };
  }
  return f;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1️⃣ Zod Schema 定义
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 触发导出的请求体
const triggerExportSchema = z.object({
  entityType: z.enum([
    'exam',        // 考试列表
    'student',     // 学生列表
    'submission',  // 成绩记录
    'behavior',    // 行为日志
    'audit',       // 审计日志
    'batch',       // 批次管理
    'room',        // 考场管理
    'gradeReview', // 批改留痕（人工复核记录，成绩存档用）
    'custom',      // 自定义数据
  ]),
  entityId: z.string().uuid().optional(),  // 可选：特定实体ID
  format: z.nativeEnum(ExportFormat).default(ExportFormat.EXCEL),
  options: z.object({
    filename: z.string().optional(),
    columns: z.array(z.object({
      key: z.string(),
      title: z.string(),
      width: z.number().optional(),
    })).optional(),
    filters: z.record(z.any()).optional(),  // 筛选条件
    async: z.boolean().default(false),      // 是否异步执行
  }).optional(),
});

// 查询参数验证
const queryTasksSchema = z.object({
  status: z.nativeEnum(TaskStatus).optional(),
  entityType: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).default(20),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2️⃣ 数据获取器（根据实体类型）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 根据实体类型获取对应的数据
 */
async function fetchEntityData(
  entityType: string,
  entityId?: string,
  filters?: Record<string, any>
): Promise<any[]> {
  // 统一取 MAX_EXPORT_ROWS + 1 行：多取 1 行用于在调用方检测「超限」并报错，
  // 而不是静默截断给用户一份不完整的数据
  const cap = MAX_EXPORT_ROWS + 1;

  switch (entityType) {
    case 'exam':
      return prisma.exam.findMany({
        where: entityId ? { id: entityId } : (filters || {}),
        include: { creator: { select: { realName: true, username: true } }, batch: true },
        orderBy: { createdAt: 'desc' },
        take: cap,
      });

    case 'student':
      return prisma.user.findMany({
        where: { role: 'student', ...(filters || {}) },
        select: {
          id: true, username: true, realName: true, studentId: true,
          email: true, department: { select: { name: true } },
        },
        orderBy: { username: 'asc' },
        take: cap,
      });

    case 'submission':
      return prisma.studentSubmission.findMany({
        // 无 entityId 时补默认 30 天时间窗口（submissions 长期累积可达十万级），
        // 显式传入 filters.createdAt 可覆盖；指定 entityId（单场考试）无需窗口
        where: entityId
          ? { examId: entityId }
          : withDefaultTimeWindow(filters, 'createdAt'),
        include: {
          student: { select: { realName: true, username: true, studentId: true } },
          exam: { select: { title: true } },
        },
        orderBy: { totalScore: 'desc' },
        take: cap,
      });

    case 'behavior':
      return prisma.studentBehaviorLog.findMany({
        where: withDefaultTimeWindow(filters, 'occurredAt'),
        include: { student: { select: { realName: true, username: true } } },
        orderBy: { occurredAt: 'desc' },
        take: cap,
      });

    case 'audit':
      return prisma.auditLog.findMany({
        where: withDefaultTimeWindow(filters, 'occurredAt'),
        include: { operator: { select: { realName: true, username: true } } },
        orderBy: { occurredAt: 'desc' },
        take: cap,
      });

    case 'batch':
      return prisma.examBatch.findMany({
        where: filters || {},
        include: { creator: { select: { realName: true } } },
        orderBy: { createdAt: 'desc' },
        take: cap,
      });

    case 'room':
      return prisma.examRoom.findMany({
        where: filters || {},
        include: { invigilators: { select: { realName: true } } },
        orderBy: { createdAt: 'desc' },
        take: cap,
      });

    case 'gradeReview':
      // 批改留痕：谁、何时、把哪道题从多少分改成多少分、理由是什么
      // 支持按 examId 过滤（批改记录按考试归档），默认 90 天窗口
      return prisma.gradeReviewLog.findMany({
        where: withDefaultTimeWindow(filters, 'createdAt'),
        include: {
          detail: {
            select: {
              question: { select: { id: true, title: true } },
              submission: {
                select: {
                  id: true,
                  examId: true,
                  student: { select: { realName: true, username: true } },
                  exam: { select: { title: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: cap,
      });

    default:
      throw new Error(`不支持的实体类型: ${entityType}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3️⃣ API 端点实现
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/export/trigger
 *
 * 功能：触发导出任务（支持同步和异步模式）
 */
router.post('/trigger', async (req: Request, res: Response) => {
  try {
    const body = triggerExportSchema.parse(req.body);

    // PDF 导出当前仅为 HTML 占位，明确拒绝避免用户拿到非 PDF 文件
    if (body.format === ExportFormat.PDF) {
      return res.status(400).json({
        success: false,
        error: 'PDF 导出暂未实现，请选择 Excel 或 CSV',
      });
    }

    // 并发限制：检查 + 递增必须同步完成（中间不能有 await），
    // 否则并发请求会同时通过检查、绕过上限
    if (activeExportCount >= MAX_CONCURRENT_EXPORTS) {
      return res.status(429).json({
        success: false,
        error: `当前已有 ${MAX_CONCURRENT_EXPORTS} 个导出任务在执行，请稍后再试`,
      });
    }
    activeExportCount++;

    // 创建 DB 任务记录（持久化：重启不丢历史）；创建失败需释放并发名额
    let task: any;
    try {
      task = await prisma.exportTask.create({
        data: {
          userId: req.user!.userId,
          entityType: body.entityType,
          entityId: body.entityId || null,
          format: body.format,
          status: TaskStatus.PROCESSING,
          progress: 0,
        },
      });
    } catch (err) {
      activeExportCount = Math.max(0, activeExportCount - 1);
      throw err;
    }

    // 执行导出逻辑（同步模式：等待完成；异步模式：后台执行）
    const executeExport = async () => {
      try {
        await prisma.exportTask.update({
          where: { id: task.id },
          data: { progress: 10 },
        });

        // 1. 获取数据
        const data = await fetchEntityData(
          body.entityType,
          body.entityId,
          body.options?.filters
        );

        if (data.length === 0) {
          throw new Error('没有可导出的数据');
        }

        // 行数上限：超出时明确报错让用户缩小范围，绝不静默截断
        if (data.length > MAX_EXPORT_ROWS) {
          throw new Error(
            `数据量超过导出上限（${MAX_EXPORT_ROWS} 行），请缩小时间范围或筛选条件后重试`
          );
        }

        await prisma.exportTask.update({
          where: { id: task.id },
          data: { progress: 50 },
        });

        // 2. 执行导出（服务内为 exceljs 流式写盘，不阻塞事件循环）
        const result = await exportService.export(data, body.format, {
          ...body.options,
          filename: body.options?.filename ||
            `${body.entityType}${body.entityId ? `-${body.entityId.substring(0, 8)}` : ''}`,
        });

        // 3. 回写任务结果
        await prisma.exportTask.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.COMPLETED,
            progress: 100,
            fileName: result.fileName,
            fileSize: result.fileSize,
            recordCount: result.recordCount,
            downloadUrl: result.downloadUrl,
            filePath: result.filePath,
            completedAt: new Date(),
          },
        });
      } catch (err: any) {
        console.error('导出失败:', err);
        await prisma.exportTask.update({
          where: { id: task.id },
          data: {
            status: TaskStatus.FAILED,
            error: err.message || '导出过程出错',
            completedAt: new Date(),
          },
        });
      } finally {
        // 无论成败都要释放并发名额
        activeExportCount = Math.max(0, activeExportCount - 1);
      }
    };

    // 同步或异步执行
    if (body.options?.async) {
      // 异步模式：立即返回任务ID，后台执行。
      // .catch 兜底：executeExport 内部的 FAILED 回写若再次抛错（如 DB 抖动），
      // 不能让未处理的 rejection 把进程打崩
      executeExport().catch(err => {
        console.error('异步导出任务异常:', err);
      });
      return res.json({
        success: true,
        taskId: task.id,
        message: '导出任务已创建，请稍后查询结果',
        statusUrl: `/export/tasks/${task.id}`,
      });
    }

    // 同步模式：等待完成
    await executeExport();

    const finalTask = await prisma.exportTask.findUnique({ where: { id: task.id } });
    if (finalTask?.status === TaskStatus.COMPLETED && finalTask.downloadUrl) {
      res.json({
        success: true,
        taskId: task.id,
        data: {
          fileName: finalTask.fileName,
          fileSize: finalTask.fileSize,
          recordCount: finalTask.recordCount,
          downloadUrl: finalTask.downloadUrl,
        },
        message: '导出完成',
      });
    } else {
      res.status(500).json({
        success: false,
        error: finalTask?.error || '导出失败',
        taskId: task.id,
      });
    }
  } catch (err: any) {
    console.error('触发导出失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '请求参数错误',
    });
  }
});

// ✅ DB 行 → 对外摘要（不含 filePath 等内部字段）
function toExportSummary(row: any) {
  return {
    id: row.id,
    userId: row.userId,
    entityType: row.entityType,
    entityId: row.entityId,
    format: row.format,
    status: row.status,
    progress: row.progress,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    result: row.downloadUrl ? {
      fileName: row.fileName,
      fileSize: row.fileSize,
      recordCount: row.recordCount,
      downloadUrl: row.downloadUrl,
    } : null,
  };
}

/**
 * GET /api/export/tasks
 *
 * 功能：查询导出任务列表（分页）
 */
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const query = queryTasksSchema.parse(req.query);
    const user = req.user!;

    // 普通用户只看自己的任务；admin 可见全部（DB 持久化）
    const where: any = {};
    if (user.role !== 'admin') {
      where.userId = user.userId;
    }
    if (query.status) where.status = query.status;
    if (query.entityType) where.entityType = query.entityType;

    const [rows, total] = await Promise.all([
      prisma.exportTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.exportTask.count({ where }),
    ]);

    res.json({
      success: true,
      data: rows.map(toExportSummary),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (err: any) {
    console.error('查询任务失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '查询参数错误',
    });
  }
});

/**
 * GET /api/export/tasks/:id
 *
 * 功能：查询单个任务状态和结果
 */
router.get('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const row = await prisma.exportTask.findUnique({
      where: { id: req.params.taskId },
    });

    if (!row || (user.role !== 'admin' && row.userId !== user.userId)) {
      return res.status(404).json({
        success: false,
        error: '任务不存在',
      });
    }

    res.json({ success: true, data: toExportSummary(row) });
  } catch (err: any) {
    console.error('查询任务失败:', err);
    res.status(400).json({ success: false, error: err.message || '查询失败' });
  }
});

/**
 * GET /api/export/download
 *
 * 功能：下载导出文件
 */
router.get('/download', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: '缺少文件路径参数',
      });
    }

    // 安全检查：防止路径遍历攻击
    const safePath = join(process.cwd(), filePath);
    if (!safePath.includes('/exports/')) {
      return res.status(403).json({
        success: false,
        error: '非法的文件路径',
      });
    }

    // 校验：反查 DB 导出任务，确认当前用户有权下载该文件
    const user = req.user!;
    const matchedTask = await prisma.exportTask.findFirst({
      where: {
        filePath: safePath,
        ...(user.role === 'admin' ? {} : { userId: user.userId }),
      },
    });
    if (!matchedTask) {
      return res.status(403).json({
        success: false,
        error: '未找到对应的导出任务，无权下载',
      });
    }

    const fs = require('fs');
    if (!existsSync(safePath)) {
      return res.status(404).json({
        success: false,
        error: '文件不存在或已过期',
      });
    }

    // 设置下载头
    const fileName = safePath.split('/').pop() || 'export';
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    // 流式传输文件
    const fileStream = createReadStream(safePath);
    fileStream.pipe(res);

    fileStream.on('error', (err: any) => {
      console.error('文件读取错误:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: '文件读取失败' });
      }
    });
  } catch (err: any) {
    console.error('下载失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '下载失败',
    });
  }
});

/**
 * GET /api/export/templates
 *
 * 功能：获取可用的预设导出模板
 */
router.get('/templates', (_req: Request, res: Response) => {
  const templates = [
    {
      id: 'exam-list',
      name: '考试列表',
      entityType: 'exam',
      description: '包含考试基本信息、状态、批次等',
      columns: [
        { key: 'title', title: '考试名称', width: 30 },
        { key: 'mode', title: '考试模式', width: 12 },
        { key: 'status', title: '状态', width: 12 },
        { key: 'durationMinutes', title: '时长(分钟)', width: 12 },
        { key: 'totalScore', title: '总分', width: 8 },
        { key: 'batch.name', title: '所属批次', width: 18 },
        { key: 'creator.realName', title: '创建者', width: 12 },
        { key: 'createdAt', title: '创建时间', width: 20 },
      ],
    },
    {
      id: 'score-report',
      name: '成绩报表',
      entityType: 'submission',
      description: '学生成绩明细，含排名和通过情况',
      columns: [
        { key: 'student.realName', title: '姓名', width: 12 },
        { key: 'student.studentId', title: '学号', width: 15 },
        { key: 'student.username', title: '用户名', width: 15 },
        { key: 'exam.title', title: '考试名称', width: 25 },
        { key: 'status', title: '提交状态', width: 12 },
        { key: 'totalScore', title: '得分', width: 8 },
        { key: 'startedAt', title: '开始时间', width: 20 },
        { key: 'submittedAt', title: '提交时间', width: 20 },
      ],
    },
    {
      id: 'behavior-log',
      name: '行为日志',
      entityType: 'behavior',
      description: '考生行为追踪记录',
      columns: [
        { key: 'occurredAt', title: '时间', width: 22 },
        { key: 'student.realName', title: '学生', width: 12 },
        { key: 'behaviorType', title: '行为类型', width: 15 },
        { key: 'riskLevel', title: '风险等级', width: 12 },
        { key: 'metadata', title: '详细信息', width: 35 },
      ],
    },
    {
      id: 'audit-log',
      name: '审计日志',
      entityType: 'audit',
      description: '系统操作审计记录',
      columns: [
        { key: 'occurredAt', title: '操作时间', width: 22 },
        { key: 'action', title: '操作类型', width: 12 },
        { key: 'entityType', title: '目标实体', width: 15 },
        { key: 'username', title: '操作者', width: 15 },
        { key: 'ipAddress', title: 'IP地址', width: 16 },
        { key: 'requestUrl', title: '请求URL', width: 35 },
      ],
    },
  ];

  res.json({ success: true, data: templates });
});

/**
 * DELETE /api/export/tasks/:id
 *
 * 功能：删除导出任务及关联文件
 */
router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const row = await prisma.exportTask.findUnique({
      where: { id: req.params.taskId },
    });

    if (!row) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    // 只允许任务属主或 admin 删除
    if (row.userId !== user.userId && user.role !== 'admin') {
      return res.status(403).json({ success: false, error: '无权删除该任务' });
    }

    // 删除关联的文件
    if (row.filePath) {
      try {
        unlinkSync(row.filePath);
      } catch (err) {
        console.warn('删除文件失败:', err);
      }
    }

    // 删除任务记录
    await prisma.exportTask.delete({ where: { id: row.id } });

    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    console.error('删除任务失败:', err);
    res.status(500).json({ success: false, error: err.message || '删除失败' });
  }
});

/**
 * POST /api/export/cleanup
 *
 * 功能：批量清理过期任务和文件
 */
router.post('/cleanup', async (req: Request, res: Response) => {
  const maxAgeHours = 24;
  const now = Date.now();
  const user = req.user!;

  // 只清理自己的过期任务（admin 可清理全部）
  const rows = await prisma.exportTask.findMany({
    where: {
      ...(user.role === 'admin' ? {} : { userId: user.userId }),
      createdAt: { lt: new Date(now - maxAgeHours * 60 * 60 * 1000) },
    },
  });

  for (const row of rows) {
    if (row.filePath) {
      try { unlinkSync(row.filePath); } catch (e) { /* 文件可能已不存在 */ }
    }
    await prisma.exportTask.delete({ where: { id: row.id } });
  }

  // 同时清理磁盘上的孤儿过期文件
  const fileDeletedCount = exportService.cleanupExpiredFiles(maxAgeHours);

  res.json({
    success: true,
    message: `清理完成`,
    deletedTasks: rows.length,
    deletedFiles: fileDeletedCount,
  });
});

export { router as exportRouter };
