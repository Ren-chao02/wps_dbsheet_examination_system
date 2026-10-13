import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { previewSlotCandidates } from '../services/paper-generator';
import { authenticate, authorize } from '../middleware/auth';

export const paperRouter = Router();
paperRouter.use(authenticate);
paperRouter.use(authorize('teacher', 'admin'));

const paperSchema = z.object({
  name: z.string().min(1).max(256),
  // description/difficulty 允许显式 null：编辑页清空这两个字段后要以"写 NULL"落库，
  // 只收 undefined 的话"清空"会静默变成"不改"（历史实现里清空直接 400，保存不了）
  description: z.string().nullable().optional(),
  difficulty: z.string().nullable().optional(),
  passScore: z.number().int().min(0).nullable().optional(),
});

/**
 * 试卷题位：
 * - fixed：就考这道题（questionId 必填）
 * - rule ：按知识点抽题（rule 必填，开考时按学生抽 1 道同构题）
 * 两者的 score 都必填 —— 抽题等值替换要求同题位候选题目分值一致。
 */
const slotRuleSchema = z.object({
  capabilityIds: z.array(z.string().min(1)).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  type: z.enum([
    'create_table', 'add_field', 'config_view', 'create_form', 'comprehensive',
    'single_choice', 'multiple_choice', 'true_false',
  ]).optional(),
  schemaRefs: z.object({
    tables: z.array(z.string()).optional(),
    fields: z.array(z.string()).optional(),
  }).optional(),
});

const paperQuestionSchema = z.object({
  questionIds: z.array(z.object({
    questionId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().min(0).default(0),
    score: z.number().int().min(0).default(10),
    slotType: z.enum(['fixed', 'rule']).default('fixed'),
    rule: slotRuleSchema.nullable().optional(),
  })).refine(
    items => items.every(i => (i.slotType === 'rule' ? !!i.rule : !!i.questionId)),
    { message: '固定题位必须指定题目；抽题题位必须给出抽题条件' },
  ),
});

// GET /api/papers
paperRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', search, difficulty, source } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    if (search) {
      where.name = { contains: String(search), mode: 'insensitive' };
    }
    if (difficulty) {
      where.difficulty = String(difficulty);
    }
    if (source) {
      where.source = String(source);
    }

    const [papers, total] = await Promise.all([
      prisma.paper.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { select: { id: true, realName: true } },
          _count: { select: { paperQuestions: true, exams: true } },
        },
      }),
      prisma.paper.count({ where }),
    ]);

    // 组卷方式（固定题/抽题题位各几个）：列表页要展示"手动组卷/自动组卷/混合"，
    // _count 分不出题位类型，这里对本页试卷做一次 groupBy 补齐
    const slotStats = new Map<string, { fixed: number; rule: number }>();
    if (papers.length > 0) {
      const grouped = await prisma.paperQuestion.groupBy({
        by: ['paperId', 'slotType'],
        where: { paperId: { in: papers.map(p => p.id) } },
        _count: { _all: true },
      });
      for (const g of grouped) {
        const stat = slotStats.get(g.paperId) ?? { fixed: 0, rule: 0 };
        if (g.slotType === 'rule') stat.rule += g._count._all;
        else stat.fixed += g._count._all;
        slotStats.set(g.paperId, stat);
      }
    }

    res.json({
      data: papers.map(p => ({ ...p, slotStats: slotStats.get(p.id) ?? { fixed: 0, rule: 0 } })),
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/papers/:id
paperRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, realName: true } },
        paperQuestions: {
          include: {
            question: {
              include: {
                primaryCategory: { select: { id: true, name: true } },
                secondaryCategory: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    res.json(paper);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/papers
paperRouter.post('/', async (req: Request, res: Response) => {
  try {
    const data = paperSchema.parse(req.body);

    const paper = await prisma.paper.create({
      data: {
        ...data,
        createdBy: req.user!.userId,
      },
    });

    res.status(201).json(paper);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/papers/:id
paperRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }
    // ✅ 所有权检查：非 admin 只能修改自己创建的试卷（与 /:id/questions 同口径）
    if (req.user!.role !== 'admin' && paper.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能修改自己创建的试卷' });
    }

    const data = paperSchema.parse(req.body);
    const updated = await prisma.paper.update({
      where: { id: req.params.id },
      data,
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/papers/:id
paperRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { exams: true } } },
    });
    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }
    // ✅ 所有权检查：非 admin 只能删除自己创建的试卷（与 /:id/questions 同口径）
    if (req.user!.role !== 'admin' && paper.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能删除自己创建的试卷' });
    }
    if (paper._count.exams > 0) {
      return res.status(400).json({ message: '试卷已被考试使用，无法删除' });
    }

    await prisma.paper.delete({ where: { id: req.params.id } });
    res.json({ message: '删除成功' });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// PUT /api/papers/:id/questions — 设置试卷题目
paperRouter.put('/:id/questions', async (req: Request, res: Response) => {
  try {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }
    // ✅ 所有权检查：非 admin 只能修改自己创建的试卷题目
    if (req.user!.role !== 'admin' && paper.createdBy !== req.user!.userId) {
      return res.status(403).json({ message: '只能修改自己创建的试卷' });
    }

    const { questionIds } = paperQuestionSchema.parse(req.body);
    const totalScore = questionIds.reduce((sum, q) => sum + q.score, 0);

    // 事务保护：删除旧题目、创建新题目、更新总分在同一事务中完成
    const [, , updated] = await prisma.$transaction([
      prisma.paperQuestion.deleteMany({ where: { paperId: req.params.id } }),
      ...(questionIds.length > 0
        ? [prisma.paperQuestion.createMany({
            data: questionIds.map(q => ({
              paperId: req.params.id,
              questionId: q.slotType === 'rule' ? null : (q.questionId ?? null),
              sortOrder: q.sortOrder,
              score: q.score,
              slotType: q.slotType,
              rule: (q.rule ?? undefined) as any,
            })),
          })]
        : []),
      prisma.paper.update({
        where: { id: req.params.id },
        data: { totalScore },
        include: {
          paperQuestions: {
            include: { question: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      }),
    ]);

    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * POST /api/papers/slot-preview — 抽题题位的候选池预览
 *
 * 组卷界面必须让教师看到每个题位有多少候选题：
 * 候选题只有 1 道时"每生不同"会静默退化成"全员同题"，教师毫不知情。
 */
paperRouter.post('/slot-preview', async (req: Request, res: Response) => {
  try {
    const { rule, score } = z.object({
      rule: slotRuleSchema,
      score: z.number().int().min(0),
    }).parse(req.body);

    const result = await previewSlotCandidates(rule as any, score);
    res.json(result);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/papers/:id/duplicate — 复制试卷
paperRouter.post('/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const original = await prisma.paper.findUnique({
      where: { id: req.params.id },
      include: {
        paperQuestions: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!original) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    // 数据范围（P1）：只能复制自己创建的或官方试卷；他人校本试卷不可复制
    // （官方试卷的复制是题库分发路径，刻意放开）
    const isAdmin = req.user?.role === 'admin';
    if (!isAdmin && original.createdBy !== req.user!.userId && original.source !== 'official') {
      return res.status(403).json({ message: '只能复制自己创建的或官方试卷' });
    }

    const duplicated = await prisma.paper.create({
      data: {
        name: `${original.name} - 副本`,
        description: original.description,
        difficulty: original.difficulty,
        passScore: original.passScore,
        totalScore: original.totalScore,
        createdBy: req.user!.userId,
        paperQuestions: {
          create: original.paperQuestions.map(pq => ({
            questionId: pq.questionId,
            sortOrder: pq.sortOrder,
            score: pq.score,
            // 题位类型与抽题规则必须一并复制：只拷 questionId 会把 rule 题位
            // 复制成"没有题目也没有规则"的空题位，开考时直接缺题
            slotType: pq.slotType,
            rule: (pq.rule ?? undefined) as any,
          })),
        },
      },
    });

    res.status(201).json(duplicated);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
