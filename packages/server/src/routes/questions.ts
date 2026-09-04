import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { skeletonGenerator } from '../engine/skeleton-generator';
import { answerReverser } from '../engine/answer-reverser';
import { wpsConfigService } from '../services/wps-config-service';

export const questionRouter = Router();
questionRouter.use(authenticate);

const answerRuleSchema = z.object({
  id: z.string(),
  action: z.string(),
  params: z.record(z.any()),
  score: z.number().int().min(0),
});

// ✅ 更新Zod验证Schema：支持两级分类和元数据字段
const questionSchema = z.object({
  // ❌ 删除原有字段
  // categoryId: z.string().uuid().nullable().optional(),

  // ✅ 新增字段
  primaryCategoryId: z.string().uuid().nullable().optional(),
  secondaryCategoryId: z.string().uuid().nullable().optional(),
  teacherName: z.string().max(64).optional(),

  // 保留现有字段
  title: z.string().min(1).max(512),
  description: z.string().optional(),
  // type字段已移除，统一默认为实操题(comprehensive)
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  score: z.number().int().min(0).default(10),
  answerRules: z.array(answerRuleSchema).default([]),
  hints: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

// GET /api/questions - 支持高级筛选（9个维度）
questionRouter.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      search,
      difficulty,
      status,
      teacherName,
      primaryCategory,
      secondaryCategory,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
    } = req.query;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 构建动态查询条件
    const where: any = {};

    // 基础搜索
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    // 基础筛选
    if (difficulty) where.difficulty = String(difficulty);
    if (status) where.status = String(status);

    // ✨ 新增：出题老师模糊匹配
    if (teacherName) {
      where.teacherName = { contains: String(teacherName), mode: 'insensitive' };
    }

    // ✨ 新增：一级分类筛选（支持ID或名称）
    if (primaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(primaryCategory));
      if (isUuid) {
        where.primaryCategoryId = String(primaryCategory);
      } else {
        where.primaryCategory = { name: { contains: String(primaryCategory), mode: 'insensitive' } };
      }
    }

    // ✨ 新增：二级分类筛选（支持ID或名称）
    if (secondaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(secondaryCategory));
      if (isUuid) {
        where.secondaryCategoryId = String(secondaryCategory);
      } else {
        where.secondaryCategory = { name: { contains: String(secondaryCategory), mode: 'insensitive' } };
      }
    }

    // ✨ 新增：创建时间范围筛选
    if (createdAtStart || createdAtEnd) {
      where.createdAt = {};
      if (createdAtStart) where.createdAt.gte = new Date(String(createdAtStart));
      if (createdAtEnd) where.createdAt.lte = new Date(String(createdAtEnd));
    }

    // ✨ 新增：更新时间范围筛选
    if (updatedAtStart || updatedAtEnd) {
      where.updatedAt = {};
      if (updatedAtStart) where.updatedAt.gte = new Date(String(updatedAtStart));
      if (updatedAtEnd) where.updatedAt.lte = new Date(String(updatedAtEnd));
    }

    const [questions, total] = await Promise.all([
      prisma.question.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          // ✅ 替换为两个分类关联
          primaryCategory: { select: { id: true, name: true } },
          secondaryCategory: { select: { id: true, name: true } },
          creator: { select: { id: true, realName: true } },
        },
      }),
      prisma.question.count({ where }),
    ]);

    res.json({ data: questions, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error('Error fetching questions:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/questions/:id - 返回完整题目信息
questionRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const question = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: {
        // ✅ 返回完整的分类信息
        primaryCategory: true,
        secondaryCategory: true,
        creator: { select: { id: true, realName: true } },
      },
    });

    if (!question) {
      return res.status(404).json({ message: '题目不存在' });
    }

    res.json(question);
  } catch (error) {
    console.error('Error fetching question:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/questions - 创建题目（自动填充元数据）
questionRouter.post('/', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = questionSchema.parse(req.body);

    // ✅ 自动填充元数据，统一设置为实操题
    const question = await prisma.question.create({
      data: {
        ...data,
        type: 'comprehensive',
        createdBy: req.user!.userId,
        // 如果未提供teacherName，使用当前用户姓名
        teacherName: data.teacherName || req.user?.realName || undefined,
      },
      include: {
        primaryCategory: { select: { id: true, name: true } },
        secondaryCategory: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(question);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error creating question:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/questions/:id - 更新题目（自动填充更新人）
questionRouter.put('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const existingQuestion = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existingQuestion) {
      return res.status(404).json({ message: '题目不存在' });
    }

    // ✅ 所有权检查：非 admin 只能编辑自己创建的题目
    if (req.user!.role !== 'admin' && existingQuestion.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能编辑自己创建的题目' });
    }

    const data = questionSchema.parse(req.body);

    // ✅ 自动填充更新人
    const updated = await prisma.question.update({
      where: { id: req.params.id },
      data: {
        ...data,
        type: 'comprehensive',
        updatedBy: req.user?.realName || undefined,
      },
      include: {
        primaryCategory: { select: { id: true, name: true } },
        secondaryCategory: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error updating question:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/questions/:id
questionRouter.delete('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    // ✅ 先查询题目，检查所有权
    const existingQuestion = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existingQuestion) {
      return res.status(404).json({ message: '题目不存在' });
    }
    if (req.user!.role !== 'admin' && existingQuestion.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能删除自己创建的题目' });
    }

    // 检查题目是否被考试或试卷引用
    const [usedInExam, usedInPaper] = await Promise.all([
      prisma.examQuestion.count({ where: { questionId: req.params.id } }),
      prisma.paperQuestion.count({ where: { questionId: req.params.id } }),
    ]);
    if (usedInExam > 0 || usedInPaper > 0) {
      return res.status(400).json({ message: '该题目已被考试或试卷引用，无法删除。可先将其禁用' });
    }
    await prisma.question.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '题目不存在' });
    }
    console.error('Error deleting question:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/questions/:id/status - 切换题目启用/禁用状态
questionRouter.put('/:id/status', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    // ✅ 所有权检查
    const existingQuestion = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existingQuestion) {
      return res.status(404).json({ message: '题目不存在' });
    }
    if (req.user!.role !== 'admin' && existingQuestion.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能修改自己创建的题目状态' });
    }

    const { status } = z.object({ status: z.enum(['draft', 'published']) }).parse(req.body);
    const question = await prisma.question.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(question);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误，状态值只能是 published（启用）或 draft（禁用）' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '题目不存在' });
    }
    console.error('Error updating question status:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// 出题辅助：题目骨架生成 + 标准答案反向生成规则
// @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §4.4
// ============================================================

/**
 * POST /api/questions/skeleton
 * 根据勾选能力生成题目骨架（标题/描述/规则模板/建议分值）。
 * 生成的 ruleTemplates 含占位符，后续由 reverse-rules 用标准答案填充。
 */
const skeletonSchema = z.object({
  capabilityIds: z.array(z.string().min(1)).min(1, '至少选择一个能力'),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

questionRouter.post('/skeleton', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const parsed = skeletonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: '参数错误', errors: parsed.error.flatten() });
    }
    const skeleton = skeletonGenerator.generate(parsed.data);
    res.json(skeleton);
  } catch (err: any) {
    console.error('Error generating skeleton:', err);
    res.status(500).json({ message: '生成题目骨架失败', detail: err.message });
  }
});

/**
 * POST /api/questions/reverse-rules
 * 从标准答案的真实 Schema 反向生成 answerRules（参数 100% 真实）。
 * 调用 KingsoftAdapter.getSchema()，accessToken 过期透传 401。
 *
 * accessToken 可不传：缺省时自动从「WPS Token 管理」缓存中读取，
 * 避免出题人在此步骤重复粘贴 token。
 */
const reverseRulesSchema = z.object({
  capabilities: z.array(z.string().min(1)).min(1, '至少选择一个能力'),
  fileId: z.string().min(1, 'fileId 必填'),
  accessToken: z.string().optional(),
  apiSecret: z.string().optional(),
});

questionRouter.post('/reverse-rules', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const parsed = reverseRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: '参数错误', errors: parsed.error.flatten() });
    }
    // accessToken 缺省时从服务端缓存读取（WpsTokenManager 持久化的 token）
    let { accessToken, apiSecret } = parsed.data;
    if (!accessToken) {
      const cached = await wpsConfigService.get();
      if (!cached?.accessToken) {
        return res.status(400).json({
          message: '未传入 accessToken，且服务端缓存中无可用的 WPS Token，请先在「缓存管理 → WPS Token 管理」中配置',
        });
      }
      accessToken = cached.accessToken;
    }
    const output = await answerReverser.reverse({
      ...parsed.data,
      accessToken,
      apiSecret: apiSecret || undefined,
    });
    res.json(output);
  } catch (err: any) {
    const msg = err.message || '';
    // accessToken 过期/无效 → 400（非 401，避免触发前端全局登录跳转）
    const isAuthError =
      err.status === 401 ||
      err.response?.status === 401 ||
      /401|Unauthorized|invalid token|access_token/i.test(msg);
    if (isAuthError) {
      return res.status(400).json({ message: 'WPS 访问令牌无效或已过期，请重新获取', detail: msg });
    }
    console.error('Error reversing rules:', err);
    res.status(500).json({ message: '反向生成规则失败', detail: msg });
  }
});
