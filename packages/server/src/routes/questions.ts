import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { skeletonGenerator } from '../engine/skeleton-generator';
import { answerReverser } from '../engine/answer-reverser';
import { derivePrerequisites } from '../engine/prerequisite-deriver';
// 类型 import：推导接口只把规则原样喂给纯函数推导器，不触碰 rule-engine 的任何处理器（判分逻辑零改动）
import type { AnswerRule } from '../engine/rule-engine';
import { wpsConfigService } from '../services/wps-config-service';
import { scopeCtxOf, questionWhere, assertQuestionRead, denyAccess } from '../services/data-scope';

export const questionRouter = Router();
questionRouter.use(authenticate);
// 题库含 answerRules（判分规则＝标准答案）与未发布草稿，只对教师/管理员开放。
// 学生侧取题一律走 /api/practice/*（该路径会裁剪答案字段），不得直连题库。
questionRouter.use(authorize('teacher', 'admin'));

const answerRuleSchema = z.object({
  id: z.string(),
  action: z.string(),
  params: z.record(z.any()),
  score: z.number().int().min(0),
});

/** 全部题型（单一来源：schema 校验与列表筛选共用，避免两处枚举漂移） */
const QUESTION_TYPE_VALUES = [
  'create_table', 'add_field', 'config_view', 'create_form', 'comprehensive',
  'single_choice', 'multiple_choice', 'true_false',
] as const;

/** 前置契约的一组引用（表 / 表+字段 / 表+视图） */
const refGroupSchema = z.object({
  tables: z.array(z.string()).optional(),
  fields: z.array(z.object({ table: z.string(), field: z.string() })).optional(),
  views: z.array(z.object({ table: z.string(), view: z.string() })).optional(),
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
  // 题型：不传默认实操综合题（兼容旧客户端）
  type: z.enum(QUESTION_TYPE_VALUES).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  score: z.number().int().min(0).default(10),
  answerRules: z.array(answerRuleSchema).default([]),
  /** 知识点：能力点 id（抽题组卷按它做同知识点等值替换） */
  capabilityIds: z.array(z.string().min(1)).default([]),
  /** 客观题答案：选项 + 正确项（与 answerRules 互斥） */
  objectiveAnswer: z.object({
    options: z.array(z.object({ key: z.string().min(1), text: z.string().min(1) })).min(2, '至少 2 个选项').max(26),
    correct: z.array(z.string().min(1)).min(1, '至少要指定 1 个正确选项'),
  }).nullable().optional(),
  /** 实操题引用的表名/字段名声明（抽题等值校验用）+ 前置契约（学生提示条用） */
  schemaRefs: z.object({
    // requires/creates 必须显式声明：zod 默认 strip 未知键，不声明就是"一保存丢光"
    // （出题页推导出来的契约与回填的存量数据都会在教师下一次保存时被静默抹掉）
    requires: refGroupSchema.optional(),
    creates: refGroupSchema.optional(),
    // 抽题等值签名（schemaRefsSignature）只认这两串，形状必须保持 string[]
    tables: z.array(z.string()).optional(),
    fields: z.array(z.string()).optional(),
  }).nullable().optional(),
  hints: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

const OBJECTIVE_TYPES = ['single_choice', 'multiple_choice', 'true_false'] as const;

/** 可选 JSON 字段 → Prisma 输入类型：显式 null 用 JsonNull（写入 SQL NULL） */
function toJsonInput(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (v === undefined) return undefined;
  if (v === null) return Prisma.JsonNull;
  return v as Prisma.InputJsonValue;
}

/**
 * 客观题答案校验（在入库前拦下配置错误）。
 *
 * 这些校验的意义在于：配错的题一旦进了考试，学生是按错误答案被扣分的，
 * 事后只能靠人工复核挽救 —— 所以在保存时就拦住。
 */
function validateObjectiveAnswer(type: string | undefined, answer: { options: { key: string }[]; correct: string[] } | null | undefined) {
  if (!type || !OBJECTIVE_TYPES.includes(type as any)) return null; // 实操题不校验
  if (!answer) return '客观题必须配置正确答案';
  const keys = answer.options.map(o => o.key);
  if (new Set(keys).size !== keys.length) return '选项标识不能重复';
  const unknown = answer.correct.filter(c => !keys.includes(c));
  if (unknown.length > 0) return `正确选项 ${unknown.join('、')} 不在选项列表中`;
  if ((type === 'single_choice' || type === 'true_false') && answer.correct.length !== 1) {
    return type === 'true_false' ? '判断题只能有一个正确选项' : '单选题只能有一个正确选项';
  }
  return null;
}

// GET /api/questions - 支持高级筛选（9个维度）
questionRouter.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      pageSize = '20',
      search,
      type,
      difficulty,
      status,
      teacherName,
      primaryCategory,
      secondaryCategory,
      createdAtStart,
      createdAtEnd,
      updatedAtStart,
      updatedAtEnd,
      source,
    } = req.query;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    // 数据范围（P2）：教师 = 自己创建 ∪ 本院系 ∪ 校级(null) ∪ 校级池(shared)；admin 不受限。
    // 用 AND 组合而非对象展开 —— 下面的 search 会占用 OR 字段，展开会互相覆盖。
    const conditions: any[] = [await questionWhere(scopeCtxOf(req))];

    // 基础搜索
    if (search) {
      conditions.push({
        OR: [
          { title: { contains: String(search), mode: 'insensitive' } },
          { description: { contains: String(search), mode: 'insensitive' } },
        ],
      });
    }

    // 基础筛选
    if (difficulty) conditions.push({ difficulty: String(difficulty) });
    if (status) conditions.push({ status: String(status) });

    // 题型筛选：支持逗号分隔多选（题库列表与试卷选题页的"题型"过滤器共用同一参数）
    if (type) {
      const types = String(type).split(',').map(s => s.trim()).filter(Boolean);
      const valid = types.filter(t => (QUESTION_TYPE_VALUES as readonly string[]).includes(t));
      if (valid.length > 0) conditions.push({ type: { in: valid } });
    }

    // 来源筛选：official = 官方题库 / school = 校本题库（题库页页签）
    if (source) conditions.push({ source: String(source) });

    // ✨ 新增：出题老师模糊匹配
    if (teacherName) {
      conditions.push({ teacherName: { contains: String(teacherName), mode: 'insensitive' } });
    }

    // ✨ 新增：一级分类筛选（支持ID或名称）
    if (primaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(primaryCategory));
      if (isUuid) {
        conditions.push({ primaryCategoryId: String(primaryCategory) });
      } else {
        conditions.push({ primaryCategory: { name: { contains: String(primaryCategory), mode: 'insensitive' } } });
      }
    }

    // ✨ 新增：二级分类筛选（支持ID或名称）
    if (secondaryCategory) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(secondaryCategory));
      if (isUuid) {
        conditions.push({ secondaryCategoryId: String(secondaryCategory) });
      } else {
        conditions.push({ secondaryCategory: { name: { contains: String(secondaryCategory), mode: 'insensitive' } } });
      }
    }

    // ✨ 新增：创建时间范围筛选
    if (createdAtStart || createdAtEnd) {
      const createdAt: any = {};
      if (createdAtStart) createdAt.gte = new Date(String(createdAtStart));
      if (createdAtEnd) createdAt.lte = new Date(String(createdAtEnd));
      conditions.push({ createdAt });
    }

    // ✨ 新增：更新时间范围筛选
    if (updatedAtStart || updatedAtEnd) {
      const updatedAt: any = {};
      if (updatedAtStart) updatedAt.gte = new Date(String(updatedAtStart));
      if (updatedAtEnd) updatedAt.lte = new Date(String(updatedAtEnd));
      conditions.push({ updatedAt });
    }

    const where: any = { AND: conditions };

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
          // 引用次数（列表页展示"被试卷/考试引用几次"；被引用的题目按现有规则不可删除）
          _count: { select: { paperQuestions: true, examQuestions: true } },
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
    // 数据范围（P2）：题库含 answerRules（=标准答案），读范围必须与列表一致收口 ——
    // 院系池 / 校级池 / 本人之外一律拒绝，避免绕过列表直接按 ID 拉取。
    const access = await assertQuestionRead(scopeCtxOf(req), req.params.id);
    if (access !== 'ok') return denyAccess(res, access, '该题目不在你可见的题库范围内（本院系 / 校级 / 本人）');

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

    const objectiveError = validateObjectiveAnswer(data.type, data.objectiveAnswer as any);
    if (objectiveError) {
      return res.status(400).json({ message: objectiveError });
    }

    // ✅ 自动填充元数据；题型不传时默认实操综合题（兼容旧客户端）
    const question = await prisma.question.create({
      data: {
        ...data,
        type: data.type || 'comprehensive',
        objectiveAnswer: toJsonInput(data.objectiveAnswer),
        schemaRefs: toJsonInput(data.schemaRefs),
        createdBy: req.user!.userId,
        departmentId: req.user!.departmentId ?? null, // P2：默认归属创建者院系；无院系 = 校级
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

    // ⚠️ 正在进行的考试不能改题目规则：判分是「读题目当前规则 → 比对表格」实时执行的，
    // 考试中途改规则会让同一场考试前后判分口径不同（先交卷的学生按旧规则，后交卷的按新规则），
    // 申诉时也无法复现。已结束的考试重判同样受影响，因此一并拦截。
    // 需要修题时：等考试结束，或复制一份新题用于后续考试。
    const lockedExam = await prisma.examQuestion.findFirst({
      where: {
        questionId: req.params.id,
        exam: { status: { in: ['in_progress'] } },
      },
      select: { exam: { select: { title: true } } },
    });
    if (lockedExam && req.user!.role !== 'admin') {
      return res.status(400).json({
        message: `该题正被进行中的考试「${lockedExam.exam.title}」使用，考试结束前不能修改（避免同场考试判分口径不一致）`,
      });
    }

    const data = questionSchema.parse(req.body);

    const nextType = data.type || existingQuestion.type;
    const objectiveError = validateObjectiveAnswer(nextType, (data.objectiveAnswer ?? existingQuestion.objectiveAnswer) as any);
    if (objectiveError) {
      return res.status(400).json({ message: objectiveError });
    }

    // 规则/答案发生变化 → 版本号自增。
    // 判分快照 gradedWith 里记录了这个版本号，历史答卷据此可追溯到"当时用的是哪一版规则"。
    const answerChanged =
      JSON.stringify(data.answerRules ?? []) !== JSON.stringify(existingQuestion.answerRules ?? []) ||
      JSON.stringify(data.objectiveAnswer ?? null) !== JSON.stringify(existingQuestion.objectiveAnswer ?? null);

    // ✅ 自动填充更新人
    const updated = await prisma.question.update({
      where: { id: req.params.id },
      data: {
        ...data,
        type: nextType,
        objectiveAnswer: toJsonInput(data.objectiveAnswer),
        schemaRefs: toJsonInput(data.schemaRefs),
        ...(answerChanged ? { version: { increment: 1 } } : {}),
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
 * POST /api/questions/derive-refs
 * 从判分规则反推前置契约（requires/creates），供出题页「自动推导」按钮使用。
 * 纯函数、不查库不联网；推不出来的 action 在 unresolved 里点名，交人工处理。
 */
const deriveRefsSchema = z.object({
  // 题面随规则一起传：check_table_exists 是"真建表"还是"前置检查"要靠题面判
  title: z.string().optional(),
  description: z.string().optional(),
  rules: z
    .array(
      z.object({
        id: z.string().optional(),
        action: z.string().min(1, 'action 不能为空'),
        params: z.record(z.any()).default({}),
        score: z.number().optional(),
      }),
    )
    .min(1, '至少一条规则'),
});

questionRouter.post('/derive-refs', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  const parsed = deriveRefsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数错误', errors: parsed.error.flatten() });
  }
  const { title, description, rules } = parsed.data;
  res.json(derivePrerequisites(rules as AnswerRule[], { title, description }));
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
    let { accessToken } = parsed.data;
    const { apiSecret } = parsed.data;
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
