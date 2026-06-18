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
import { z } from 'zod';
import { ExportFormat, exportService, TaskStatus } from '../services/export-service';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

// ✅ 内存中的任务存储（生产环境应使用数据库或Redis）
const exportTasks: Map<string, any> = new Map();

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
  switch (entityType) {
    case 'exam':
      return prisma.exam.findMany({
        where: entityId ? { id: entityId } : (filters || {}),
        include: { creator: { select: { realName: true, username: true } }, batch: true },
        orderBy: { createdAt: 'desc' },
      });

    case 'student':
      return prisma.user.findMany({
        where: { role: 'STUDENT', ...(filters || {}) },
        select: {
          id: true, username: true, realName: true, studentId: true,
          email: true, department: { select: { name: true } },
        },
        orderBy: { username: 'asc' },
      });

    case 'submission':
      return prisma.studentSubmission.findMany({
        where: entityId ? { examId: entityId } : (filters || {}),
        include: {
          student: { select: { realName: true, username: true, studentId: true } },
          exam: { select: { title: true } },
        },
        orderBy: { totalScore: 'desc' },
      });

    case 'behavior':
      return prisma.studentBehaviorLog.findMany({
        where: filters || {},
        include: { student: { select: { realName: true, username: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 10000, // 限制最大数量
      });

    case 'audit':
      return prisma.auditLog.findMany({
        where: filters || {},
        include: { operator: { select: { realName: true, username: true } } },
        orderBy: { occurredAt: 'desc' },
        take: 10000,
      });

    case 'batch':
      return prisma.examBatch.findMany({
        where: filters || {},
        include: { creator: { select: { realName: true } } },
        orderBy: { createdAt: 'desc' },
      });

    case 'room':
      return prisma.examRoom.findMany({
        where: filters || {},
        include: { invigilators: { select: { realName: true } } },
        orderBy: { createdAt: 'desc' },
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
    const taskId = uuidv4();
    const userId = (req as any).user?.id || 'anonymous';

    // 创建任务记录
    const task = {
      id: taskId,
      userId,
      entityType: body.entityType,
      entityId: body.entityId,
      format: body.format,
      status: TaskStatus.PROCESSING,
      progress: 0,
      error: null,
      result: null,
      createdAt: new Date(),
      completedAt: null,
    };

    exportTasks.set(taskId, task);

    // 执行导出逻辑
    const executeExport = async () => {
      try {
        task.progress = 10;

        // 1. 获取数据
        const data = await fetchEntityData(
          body.entityType,
          body.entityId,
          body.options?.filters
        );
        task.progress = 50;

        if (data.length === 0) {
          throw new Error('没有可导出的数据');
        }

        // 2. 执行导出
        const result = await exportService.export(data, body.format, {
          ...body.options,
          filename: body.options?.filename ||
            `${body.entityType}${body.entityId ? `-${body.entityId.substring(0, 8)}` : ''}`,
        });
        task.progress = 90;

        // 3. 更新任务状态
        task.status = TaskStatus.COMPLETED;
        task.progress = 100;
        task.result = result;
        task.completedAt = new Date();
      } catch (err: any) {
        console.error('导出失败:', err);
        task.status = TaskStatus.FAILED;
        task.error = err.message || '导出过程出错';
        task.completedAt = new Date();
      }
    };

    // 同步或异步执行
    if (body.options?.async) {
      // 异步模式：立即返回任务ID，后台执行
      executeExport();
      res.json({
        success: true,
        taskId,
        message: '导出任务已创建，请稍后查询结果',
        statusUrl: `/api/export/tasks/${taskId}`,
      });
    } else {
      // 同步模式：等待完成
      await executeExport();

      if (task.status === TaskStatus.COMPLETED) {
        res.json({
          success: true,
          taskId,
          data: task.result,
          message: '导出完成',
        });
      } else {
        res.status(500).json({
          success: false,
          error: task.error,
          taskId,
        });
      }
    }
  } catch (err: any) {
    console.error('触发导出失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '请求参数错误',
    });
  }
});

/**
 * GET /api/export/tasks
 *
 * 功能：查询导出任务列表（分页）
 */
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const query = queryTasksSchema.parse(req.query);

    // 从内存中获取所有任务并筛选
    let tasks = Array.from(exportTasks.values());

    if (query.status) {
      tasks = tasks.filter(t => t.status === query.status);
    }
    if (query.entityType) {
      tasks = tasks.filter(t => t.entityType === query.entityType);
    }

    // 按时间倒序排序
    tasks.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // 分页
    const start = (query.page - 1) * query.pageSize;
    const paginatedTasks = tasks.slice(start, start + query.pageSize);

    res.json({
      success: true,
      data: paginatedTasks.map(task => ({
        ...task,
        // 不返回完整result对象（节省带宽），仅返回摘要
        result: task.result ? {
          fileName: task.result.fileName,
          fileSize: task.result.fileSize,
          recordCount: task.result.recordCount,
          downloadUrl: task.result.downloadUrl,
        } : null,
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: tasks.length,
        totalPages: Math.ceil(tasks.length / query.pageSize),
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
router.get('/tasks/:taskId', (req: Request, res: Response) => {
  const task = exportTasks.get(req.params.taskId);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: '任务不存在',
    });
  }

  res.json({
    success: true,
    data: {
      ...task,
      result: task.result ? {
        fileName: task.result.fileName,
        fileSize: task.result.fileSize,
        recordCount: task.result.recordCount,
        downloadUrl: task.result.downloadUrl,
      } : null,
    },
  });
});

/**
 * GET /api/export/download
 *
 * 功能：下载导出文件
 */
router.get('/download', (req: Request, res: Response) => {
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
router.delete('/tasks/:taskId', (req: Request, res: Response) => {
  const task = exportTasks.get(req.params.taskId);

  if (!task) {
    return res.status(404).json({
      success: false,
      error: '任务不存在',
    });
  }

  // 删除关联的文件
  if (task.result?.filePath) {
    try {
      unlinkSync(task.result.filePath);
    } catch (err) {
      console.warn('删除文件失败:', err);
    }
  }

  // 删除任务记录
  exportTasks.delete(req.params.taskId);

  res.json({ success: true, message: '已删除' });
});

/**
 * POST /api/export/cleanup
 *
 * 功能：批量清理过期任务和文件
 */
router.post('/cleanup', (_req: Request, res: Response) => {
  const maxAgeHours = 24;
  const now = Date.now();
  let deletedCount = 0;

  for (const [taskId, task] of exportTasks.entries()) {
    const ageHours = (now - new Date(task.createdAt).getTime()) / (1000 * 60 * 60);

    if (ageHours > maxAgeHours) {
      // 删除文件
      if (task.result?.filePath) {
        try { unlinkSync(task.result.filePath); } catch (e) { /* ignore */ }
      }
      // 删除任务
      exportTasks.delete(taskId);
      deletedCount++;
    }
  }

  // 同时清理过期文件
  const fileDeletedCount = exportService.cleanupExpiredFiles(maxAgeHours);

  res.json({
    success: true,
    message: `清理完成`,
    deletedTasks: deletedCount,
    deletedFiles: fileDeletedCount,
  });
});

// 补充缺失的导入
import { join } from 'path';
import { existsSync, unlinkSync, createReadStream } from 'fs';

export { router as exportRouter };
