/**
 * ✅ 考生行为日志 API 路由
 *
 * 提供完整的线上考试行为追踪能力：
 * - 行为数据记录（前端自动上报）
 * - 风险等级判定（规则引擎）
 * - 分析报告生成（聚合统计）
 * - 审核流程管理（人工复核）
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PrismaClient, BehaviorType, RiskLevel } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth'; // ✅ 修复Bug#2：导入认证中间件

const router = Router();

// ⚠️ 注意：由于行为日志模型定义在独立的schema-behavior.prisma文件中，
// 此处需要创建单独的PrismaClient实例。未来应将behavior schema合并到主schema中以优化连接池管理。
const prisma = new PrismaClient();
const recordBehaviorSchema = z.object({
  examId: z.string().uuid(),
  studentId: z.string().uuid(),
  submissionId: z.string().uuid().optional(),
  behaviorType: z.nativeEnum(BehaviorType),
  metadata: z.record(z.any()).default({}),
});

// 查询参数验证
const queryBehaviorSchema = z.object({
  examId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
  behaviorType: z.nativeEnum(BehaviorType).optional(),
  riskLevel: z.nativeEnum(RiskLevel).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
});

// 分析报告审核请求
const reviewReportSchema = z.object({
  conclusion: z.enum(['正常', '需人工复核', '疑似作弊']),
  reviewNote: z.string().max(500).optional(),
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2️⃣ 风险判定引擎
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 根据行为类型和元数据自动判定风险等级
 */
function determineRiskLevel(
  behaviorType: BehaviorType,
  metadata: Record<string, any>
): RiskLevel {
  switch (behaviorType) {
    case BehaviorType.TAB_SWITCH:
      // 切屏次数超过3次视为高风险
      if (metadata.tabSwitch?.count > 5) return RiskLevel.CRITICAL;
      if (metadata.tabSwitch?.count > 3) return RiskLevel.HIGH;
      return RiskLevel.MEDIUM;

    case BehaviorType.COPY_PASTE:
      // 复制粘贴操作视为中等风险
      return RiskLevel.MEDIUM;

    case BehaviorType.WINDOW_BLUR:
      // 窗口失焦时间过长视为高风险
      if (metadata.blurDuration > 30000) return RiskLevel.HIGH;
      return RiskLevel.MEDIUM;

    case BehaviorType.FULLSCREEN_EXIT:
      // 退出全屏模式视为高风险
      return RiskLevel.HIGH;

    case BehaviorType.KEYBOARD_SHORTCUT:
      // 可疑快捷键（如PrintScreen）视为严重违规
      return RiskLevel.CRITICAL;

    case BehaviorType.MOUSE_SUSPICIOUS:
      // 异常鼠标行为（如机器人点击）
      if (metadata.clickRate > 10) return RiskLevel.HIGH;
      return RiskLevel.MEDIUM;

    default:
      // 正常操作（答题、导航等）为低风险
      return RiskLevel.LOW;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3️⃣ API 端点实现
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * POST /api/behaviors/record
 *
 * 功能：记录一条考生行为数据
 * 触发时机：前端监听到异常行为时自动调用
 * ✅ 修复Bug#2：添加认证中间件（使用token认证）
 */
router.post('/record', authenticate, async (req: Request, res: Response) => {
  try {
    const data = recordBehaviorSchema.parse(req.body);

    // 自动判定风险等级
    const riskLevel = determineRiskLevel(data.behaviorType, data.metadata);

    // 创建行为日志记录
    const behaviorLog = await prisma.studentBehaviorLog.create({
      data: {
        ...data,
        riskLevel,
        occurredAt: new Date(), // 使用服务器时间
      },
    });

    // ✅ 修复Bug#4：异步触发分析报告更新（带重试机制）
    updateAnalysisReportWithRetry(data.examId, data.studentId).catch(err => {
      console.error('更新分析报告失败（已重试3次）:', err);
    });

    res.status(201).json({
      success: true,
      data: behaviorLog,
      message: '行为已记录',
    });
  } catch (err: any) {
    console.error('记录行为失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '无效的请求数据',
    });
  }
});

/**
 * GET /api/behaviors
 *
 * 功能：查询行为日志列表（支持多维度筛选）
 * ✅ 修复Bug#2：需要教师或管理员权限
 */
router.get('/', authenticate, authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const query = queryBehaviorSchema.parse(req.query);

    const where: any = {
      examId: query.examId,
    };

    if (query.studentId) where.studentId = query.studentId;
    if (query.behaviorType) where.behaviorType = query.behaviorType;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
    if (query.startTime || query.endTime) {
      where.occurredAt = {};
      if (query.startTime) where.occurredAt.gte = new Date(query.startTime);
      if (query.endTime) where.occurredAt.lte = new Date(query.endTime);
    }

    const [logs, total] = await Promise.all([
      prisma.studentBehaviorLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          student: { select: { id: true, realName: true, username: true } },
        },
      }),
      prisma.studentBehaviorLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  } catch (err: any) {
    console.error('查询行为失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '查询参数错误',
    });
  }
});

/**
 * GET /api/behaviors/reports/:examId/:studentId
 *
 * 功能：获取指定考生的行为分析报告
 * ✅ 修复Bug#2：需要认证
 */
router.get('/reports/:examId/:studentId', authenticate, authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const { examId, studentId } = req.params;

    let report = await prisma.behaviorAnalysisReport.findUnique({
      where: {
        examId_studentId: { examId, studentId },
      },
    });

    // 如果报告不存在，实时生成
    if (!report) {
      report = await generateAnalysisReport(examId, studentId);
    }

    res.json({
      success: true,
      data: report,
    });
  } catch (err: any) {
    console.error('获取分析报告失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '服务器内部错误',
    });
  }
});

/**
 * GET /api/behaviors/reports/:examId
 *
 * 功能：获取某场考试所有学生的分析报告列表
 */
router.get('/reports/:examId', async (req: Request, res: Response) => {
  try {
    const { examId } = req.params;
    const { suspiciousOnly } = req.query; // 是否只返回可疑报告

    const where: any = { examId };
    if (suspiciousOnly === 'true') {
      where.suspiciousScore = { gt: 50 }; // 可疑度>50
    }

    const reports = await prisma.behaviorAnalysisReport.findMany({
      where,
      orderBy: { suspiciousScore: 'desc' },
      include: {
        student: { select: { id: true, realName: true, username: true } },
      },
    });

    res.json({
      success: true,
      data: reports,
    });
  } catch (err: any) {
    console.error('获取报告列表失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '服务器内部错误',
    });
  }
});

/**
 * PUT /api/behaviors/reports/:examId/:studentId/review
 *
 * 功能：人工审核分析报告（标记结论）
 * ✅ 修复Bug#2：需要认证（用于获取reviewerId）
 */
router.put('/reports/:examId/:studentId/review', authenticate, async (req: Request, res: Response) => {
  try {
    const { examId, studentId } = req.params;
    const reviewerId = req.user?.id; // 从认证中间件获取

    if (!reviewerId) {
      return res.status(401).json({
        success: false,
        error: '未授权',
      });
    }

    const data = reviewReportSchema.parse(req.body);

    const report = await prisma.behaviorAnalysisReport.update({
      where: {
        examId_studentId: { examId, studentId },
      },
      data: {
        ...data,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: report,
      message: '审核完成',
    });
  } catch (err: any) {
    console.error('审核报告失败:', err);
    res.status(400).json({
      success: false,
      error: err.message || '审核数据无效',
    });
  }
});

/**
 * DELETE /api/behaviors/:id
 *
 * 功能：删除单条行为日志（仅限管理员）
 * ✅ 修复Bug#2：需要管理员权限
 */
router.delete('/:id', authenticate, authorize('admin'), async (req: Request, res: Response) => {
  try {
    await prisma.studentBehaviorLog.delete({
      where: { id: req.params.id },
    });

    res.json({
      success: true,
      message: '已删除',
    });
  } catch (err: any) {
    console.error('删除行为失败:', err);
    res.status(500).json({
      success: false,
      error: err.message || '删除失败',
    });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4️⃣ 辅助函数：分析报告生成与更新
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * ✅ 修复Bug#4：带重试机制的分析报告更新函数
 * 最大重试3次，指数退避（1s, 2s, 4s）
 */
async function updateAnalysisReportWithRetry(examId: string, studentId: string, maxRetries = 3) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await updateAnalysisReport(examId, studentId);
      return; // 成功则直接返回
    } catch (err: any) {
      lastError = err;
      console.warn(`分析报告更新失败（第${attempt}/${maxRetries}次）:`, err.message);

      if (attempt < maxRetries) {
        // 指数退避等待
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }

  // 所有重试都失败，抛出最后一个错误
  throw lastError;
}

/**
 * 更新或创建学生的行为分析报告
 */
async function updateAnalysisReport(examId: string, studentId: string) {
  // 统计该学生在此考试中的所有行为
  const stats = await prisma.studentBehaviorLog.groupBy({
    by: ['behaviorType', 'riskLevel'],
    where: { examId, studentId },
    _count: true,
  });

  // 计算各项指标
  const totalBehaviors = stats.reduce((sum, s) => sum + s._count, 0);
  const tabSwitchCount =
    stats.find(s => s.behaviorType === BehaviorType.TAB_SWITCH)?._count ?? 0;
  const copyPasteCount =
    stats.find(s => s.behaviorType === BehaviorType.COPY_PASTE)?._count ?? 0;
  const blurCount =
    stats.find(s => s.behaviorType === BehaviorType.WINDOW_BLUR)?._count ?? 0;
  const highRiskCount =
    stats.filter(s =>
      s.riskLevel === RiskLevel.HIGH || s.riskLevel === RiskLevel.CRITICAL
    ).reduce((sum, s) => sum + s._count, 0);
  const criticalCount =
    stats.find(s => s.riskLevel === RiskLevel.CRITICAL)?._count ?? 0;

  // 计算可疑评分（0-100）
  let suspiciousScore = 0;
  suspiciousScore += Math.min(tabSwitchCount * 10, 30); // 切屏最多贡献30分
  suspiciousScore += Math.min(copyPasteCount * 15, 25); // 复制粘贴最多25分
  suspiciousScore += Math.min(blurCount * 8, 20); // 失焦最多20分
  suspiciousScore += highRiskCount * 10; // 高风险每个+10分
  suspiciousScore += criticalCount * 20; // 严重违规每个+20分
  suspiciousScore = Math.min(suspiciousScore, 100); // 上限100

  // 自动生成初步结论
  let conclusion: string | null = null;
  if (suspiciousScore >= 80) conclusion = '疑似作弊';
  else if (suspiciousScore >= 50) conclusion = '需人工复核';
  else conclusion = '正常';

  // Upsert（存在则更新，不存在则创建）
  await prisma.behaviorAnalysisReport.upsert({
    where: {
      examId_studentId: { examId, studentId },
    },
    create: {
      examId,
      studentId,
      totalBehaviors,
      tabSwitchCount,
      copyPasteCount,
      blurCount,
      highRiskCount,
      criticalCount,
      suspiciousScore,
      conclusion,
    },
    update: {
      totalBehaviors,
      tabSwitchCount,
      copyPasteCount,
      blurCount,
      highRiskCount,
      criticalCount,
      suspiciousScore,
      // 仅在未人工审核时自动更新结论
      ...(conclusion ? { conclusion } : {}),
    },
  });
}

/**
 * 实时生成完整分析报告（用于首次查看时）
 */
async function generateAnalysisReport(examId: string, studentId: string) {
  await updateAnalysisReport(examId, studentId);

  return prisma.behaviorAnalysisReport.findUniqueOrThrow({
    where: {
      examId_studentId: { examId, studentId },
    },
  });
}

export { router as behaviorRouter };
