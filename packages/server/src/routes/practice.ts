import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { KingsoftAdapter } from '../engine/adapters/kingsoft-adapter';
import { gradePracticeRecord } from '../services/practice-grading-service';
import { wpsConfigService } from '../services/wps-config-service';
import { loadTablePreview } from '../services/wps-table-service';

export const practiceRouter = Router();

/** 练习支持的题型：仅实操题（判分依赖 WPS 表格 Schema）。as const 是为了让 Prisma
 *  的 `type: { in: ... }`（枚举过滤）通过类型检查，直接传 string[] 会被拒 */
const PRACTICE_QUESTION_TYPES = ['create_table', 'add_field', 'config_view', 'create_form', 'comprehensive'] as const;
practiceRouter.use(authenticate);
practiceRouter.use(authorize('student'));

export const practiceSubmitSchema = z.object({
  paperId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    answerJson: z.record(z.any()).default({}),
  })),
});

export const favoriteSchema = z.object({
  questionId: z.string().uuid(),
});

export const feedbackSchema = z.object({
  questionId: z.string().uuid(),
  feedbackType: z.enum(['question', 'explanation']),
  content: z.string().min(1),
});

export const assignmentSchema = z.object({
  fileId: z.string().min(1),
  shareUrl: z.string().optional(),
  accessToken: z.string().optional(),
});

export const startSchema = z
  .object({
    primaryCategoryId: z.string().uuid().optional(),
    secondaryCategoryId: z.string().uuid().optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    count: z.number().int().min(1).max(20).default(5),
    // ✅ 个人题集「再练一次 / 勾选组卷」：按指定题目开练（与分类/难度随机抽题互斥）
    questionIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  })
  .refine(
    (data) =>
      !data.questionIds ||
      (!data.primaryCategoryId && !data.secondaryCategoryId && !data.difficulty),
    { message: 'questionIds 与 分类/难度 筛选不能同时使用', path: ['questionIds'] },
  );

// POST /api/practice/assignment — 注册/更新当前学生的练习文件
practiceRouter.post('/assignment', async (req: Request, res: Response) => {
  try {
    const { fileId, shareUrl, accessToken } = assignmentSchema.parse(req.body);
    const studentId = req.user!.userId;

    const assignment = await prisma.practiceTableAssignment.upsert({
      where: { studentId },
      update: { fileId, shareUrl, accessToken },
      create: { studentId, fileId, shareUrl, accessToken },
    });

    res.json(assignment);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/assignment — 查自己是否已注册练习文件
practiceRouter.get('/assignment', async (req: Request, res: Response) => {
  try {
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId: req.user!.userId },
    });
    res.json(assignment);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ── 练习页右侧面板辅助接口（与考试页同款，只读，不参与判分）──
// 内嵌 iframe 能否显示表格取决于链接权限与浏览器三方 Cookie 策略，
// 因此提供一条不依赖浏览器登录态的「实时数据预览」兜底，实现见 wps-table-service。

// GET /api/practice/wps-preview — 练习表格实时数据预览（只读）
practiceRouter.get('/wps-preview', async (req: Request, res: Response) => {
  try {
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId: req.user!.userId },
    });
    if (!assignment) {
      return res.status(404).json({ message: '尚未注册练习表格，请联系教师' });
    }

    // 优先用系统当前（自动刷新）的 token；注册记录里的 token 是注册时的快照，会过期
    const current = await wpsConfigService.get();
    const payload = await loadTablePreview({
      cacheKey: `practice:${req.user!.userId}`,
      fileId: assignment.fileId,
      accessTokens: [current?.accessToken, assignment.accessToken],
      sheetId: typeof req.query.sheetId === 'string' ? req.query.sheetId : undefined,
    });
    res.json(payload);
  } catch (err: any) {
    console.error('[practice/wps-preview] 读取表格失败:', err?.message || err);
    res.status(err?.statusCode || 502).json({ message: `读取表格失败：${err?.message || '未知错误'}` });
  }
});

// GET /api/practice/questions/catalog — 返回分类/难度树，供前端选择器
practiceRouter.get('/questions/catalog', async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.questionCategory.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, name: true, parentId: true, level: true, sortOrder: true,
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });

    // 仅返回有 published 题目的分类，避免空选项
    const questions = await prisma.question.findMany({
      where: { status: 'published' },
      select: { primaryCategoryId: true, secondaryCategoryId: true, difficulty: true },
    });
    const usedPrimary = new Set(questions.map(q => q.primaryCategoryId).filter(Boolean) as string[]);
    const usedSecondary = new Set(questions.map(q => q.secondaryCategoryId).filter(Boolean) as string[]);
    const difficulties = Array.from(new Set(questions.map(q => q.difficulty)));

    res.json({
      categories: categories.filter(c =>
        (c.level === 1 && usedPrimary.has(c.id)) ||
        (c.level === 2 && usedSecondary.has(c.id)),
      ),
      difficulties,
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * GET /api/practice/scenarios —— 「场景实战」卡片列表。
 *
 * 只出题数 ≥ 2 的场景（单题场景在自由练习里抽得到，做成卡片反而奇怪）。
 * 进度取该生最近一条记录：进行中的给 running，已判分的给 latest。
 */
practiceRouter.get('/scenarios', async (req: Request, res: Response) => {
  try {
    const studentId = req.user!.userId;

    const groups = await prisma.question.groupBy({
      by: ['scenario'],
      where: { scenario: { not: null }, status: 'published', type: { in: [...PRACTICE_QUESTION_TYPES] } },
      _count: { _all: true },
      _sum: { score: true },
    });

    const multi = groups.filter(g => g.scenario && g._count._all >= 2);

    // 该生最近 200 条练习记录里，每个场景取"最新一条"：进行中优先于已完成
    const records = await prisma.practiceRecord.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, status: true, score: true, maxScore: true, passed: true,
        startedAt: true, submittedAt: true, questions: true,
      },
    });

    const byScenario = new Map<string, typeof records[number]>();
    for (const r of records) {
      const key = (r.questions as any[])?.[0]?.scenarioKey;
      if (!key) continue;
      const cur = byScenario.get(key);
      // 进行中的记录优先展示（学生更关心"没做完的那条"）
      if (!cur || (cur.status === 'graded' && r.status === 'in_progress')) byScenario.set(key, r);
    }

    res.json({
      scenarios: multi
        .map(g => {
          const rec = byScenario.get(g.scenario!);
          return {
            key: g.scenario!,
            name: g.scenario!,
            questionCount: g._count._all,
            totalScore: g._sum.score ?? 0,
            running: rec?.status === 'in_progress'
              ? { recordId: rec.id, startedAt: rec.startedAt.toISOString() }
              : undefined,
            latest: rec?.status === 'graded'
              ? {
                  recordId: rec.id,
                  score: rec.score ?? 0,
                  maxScore: rec.maxScore,
                  passed: rec.passed ?? false,
                  submittedAt: rec.submittedAt?.toISOString() ?? rec.startedAt.toISOString(),
                }
              : undefined,
          };
        })
        .sort((a, b) => a.key.localeCompare(b.key)),
    });
  } catch (err: any) {
    console.error('Practice scenarios error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/start — 抽题 + 重置文件 + 建记录
practiceRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const { primaryCategoryId, secondaryCategoryId, difficulty, count, questionIds } = startSchema.parse(req.body);
    const studentId = req.user!.userId;

    // 1. 检查练习文件注册
    const assignment = await prisma.practiceTableAssignment.findUnique({
      where: { studentId },
    });
    if (!assignment) {
      return res.status(400).json({ message: '尚未分配练习表格，请联系教师注册' });
    }

    // 2. 抽题
    // 个人题集再练：按指定题目抽取（去重、保持传入顺序）；否则按分类/难度随机抽题
    const requestedIds = questionIds ? Array.from(new Set(questionIds)) : null;
    const where: any = { status: 'published' };
    // 练习判分完全依赖 WPS 表格 Schema，只支持实操题：
    // 客观题混进来会因"没有判分规则"而被静默判 0 分，必须在抽题阶段就排除
    where.type = { in: PRACTICE_QUESTION_TYPES };
    if (requestedIds) {
      where.id = { in: requestedIds };
    } else {
      if (primaryCategoryId) where.primaryCategoryId = primaryCategoryId;
      if (secondaryCategoryId) where.secondaryCategoryId = secondaryCategoryId;
      if (difficulty) where.difficulty = difficulty;
    }

    const pool = await prisma.question.findMany({
      where,
      select: { id: true, title: true, description: true, type: true, difficulty: true, score: true, answerRules: true, analysis: true, hints: true },
    });

    let selected: typeof pool;
    if (requestedIds) {
      if (pool.length !== requestedIds.length) {
        // 可能是"不存在/已下线"，也可能是"选中了客观题"（练习不支持）
        const found = await prisma.question.count({ where: { id: { in: requestedIds } } });
        if (found === requestedIds.length) {
          return res.status(400).json({
            message: '所选题目中包含客观题，题库练习目前只支持 WPS 实操题，请重新选择',
          });
        }
        return res.status(400).json({ message: '部分题目不存在或已下线，请刷新个人题集后再试' });
      }
      const byId = new Map(pool.map((q) => [q.id, q]));
      selected = requestedIds.map((id) => byId.get(id)!);
    } else {
      if (pool.length === 0) {
        return res.status(400).json({ message: '当前筛选条件下无可用题目，请放宽条件' });
      }
      // 随机排序取前 count 条
      selected = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length));
    }

    const questionsSnapshot = selected.map((q, i) => ({
      questionId: q.id,
      score: q.score,
      sortOrder: i,
    }));
    const maxScore = selected.reduce((sum, q) => sum + q.score, 0);

    // 3. 重置练习文件（失败则不建 record，直接报错）
    // 用「当前有效」的系统 token（临近过期会自动刷新），避免配置时刻的快照过期
    // 导致 403 Token expired；v3 网关签名已失效，统一走 v7 REST（Bearer JWT）。
    const wpsToken = (await wpsConfigService.getValidAccessToken()) || assignment.accessToken;
    if (!wpsToken) {
      return res.status(400).json({ message: '未获取到可用的 WPS access_token，请检查「WPS Token 管理」配置后重试' });
    }
    const adapter = new KingsoftAdapter(
      assignment.fileId,
      wpsToken,
      undefined,
      'v7',
    );
    try {
      await adapter.resetFile();
    } catch (err: any) {
      console.error('Practice start resetFile failed:', err);
      return res.status(500).json({ message: '练习文件重置失败，请重试' });
    }

    // 4. 重置成功后建 PracticeRecord
    const tableSpaceId = `${assignment.fileId}:${wpsToken}`;

    const record = await prisma.practiceRecord.create({
      data: {
        studentId,
        paperId: null,
        questions: questionsSnapshot as any,
        tableSpaceId,
        status: 'in_progress',
        maxScore,
        startedAt: new Date(),
      },
    });

    // 5. 丢弃该学生遗留的未完成旧练习（无成绩、无价值）
    // 防止多轮/多标签同时进行：每次开练都会 resetFile 清空同一份文件，
    // 遗留 in_progress 会让后续判分读到被清空的现场 → 「未找到表」误判。
    await prisma.practiceRecord.deleteMany({
      where: { studentId, status: 'in_progress', id: { not: record.id } },
    });

    res.json({
      recordId: record.id,
      questions: selected.map((q, i) => ({
        questionId: q.id,
        sortOrder: i,
        title: q.title,
        description: q.description,
        type: q.type,
        difficulty: q.difficulty,
        score: q.score,
        hints: q.hints,
      })),
      maxScore,
      shareUrl: assignment.shareUrl,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Practice start error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/:recordId/submit — 提交练习并即时判分
practiceRouter.post('/:recordId/submit', async (req: Request, res: Response) => {
  try {
    const { recordId } = req.params;
    const studentId = req.user!.userId;

    // 校验归属
    const record = await prisma.practiceRecord.findUnique({
      where: { id: recordId },
      select: { id: true, studentId: true, status: true },
    });
    if (!record) {
      return res.status(404).json({ message: '练习记录不存在' });
    }
    if (record.studentId !== studentId) {
      return res.status(403).json({ message: '无权操作他人练习记录' });
    }

    // 幂等抢占：仅 in_progress 状态可提交。条件更新原子地把状态翻转为 graded（占位），
    // 双击/重复提交时第二次 updateMany 命中 0 行 → 直接返回「已提交」，
    // 避免同一份记录被重复判分、错题本 wrongCount 重复累加。
    const claimed = await prisma.practiceRecord.updateMany({
      where: { id: recordId, studentId, status: 'in_progress' },
      data: { status: 'graded' },
    });
    if (claimed.count === 0) {
      return res.status(409).json({ message: '该练习已提交，请勿重复提交' });
    }

    try {
      const result = await gradePracticeRecord(recordId);
      res.json(result);
    } catch (err: any) {
      // 判分失败：回滚占位状态，保持 in_progress，学生可重新提交
      await prisma.practiceRecord.updateMany({
        where: { id: recordId, studentId, status: 'graded', score: null },
        data: { status: 'in_progress' },
      });
      throw err;
    }
  } catch (err: any) {
    console.error('Practice submit error:', err);
    // 判分失败保持 in_progress，学生可重新提交
    res.status(500).json({ message: err.message || '判分失败，请重试' });
  }
});

// POST /api/practice/submit — 提交练习并持久化记录
practiceRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const { paperId, answers } = practiceSubmitSchema.parse(req.body);
    const studentId = req.user!.userId;

    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        paperQuestions: { include: { question: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!paper) {
      return res.status(404).json({ message: '试卷不存在' });
    }

    let totalScore = 0;
    const details = answers.map((ans) => {
      const pq = paper.paperQuestions.find(pq => pq.questionId === ans.questionId);
      if (!pq) return null;

      const hasAnswer = Object.keys(ans.answerJson || {}).length > 0;
      const isCorrect = hasAnswer;
      const score = isCorrect ? pq.score : 0;
      totalScore += score;

      return {
        questionId: ans.questionId,
        score,
        isCorrect,
        maxScore: pq.score,
      };
    }).filter(Boolean);

    const maxScore = paper.totalScore;
    const passed = paper.passScore ? totalScore >= paper.passScore : totalScore > 0;

    const record = await prisma.practiceRecord.create({
      data: {
        studentId,
        paperId,
        score: totalScore,
        maxScore,
        passed,
        answers: answers as any,
        details: details as any,
        startedAt: new Date(),
        submittedAt: new Date(),
      },
    });

    // 更新错题本
    const wrong = details.filter((d): d is NonNullable<typeof d> => d !== null && !d.isCorrect);
    for (const d of wrong) {
      await prisma.wrongQuestion.upsert({
        where: { studentId_questionId: { studentId, questionId: d.questionId } },
        update: {
          wrongCount: { increment: 1 },
          lastWrongAt: new Date(),
          sourceType: 'practice',
          sourceId: record.id,
        },
        create: {
          studentId,
          questionId: d.questionId,
          sourceType: 'practice',
          sourceId: record.id,
          lastWrongAt: new Date(),
        },
      });
    }

    res.json({
      totalScore,
      maxScore,
      passed,
      details,
      recordId: record.id,
      submittedAt: record.submittedAt,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Practice submit error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/history — 练习历史（仅 graded）
practiceRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const records = await prisma.practiceRecord.findMany({
      where: { studentId: req.user!.userId, status: 'graded' },
      select: {
        id: true, status: true, score: true, maxScore: true, passed: true,
        startedAt: true, submittedAt: true, createdAt: true,
        paper: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(records);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/wrong — 错题本
practiceRouter.get('/wrong', async (req: Request, res: Response) => {
  try {
    const items = await prisma.wrongQuestion.findMany({
      where: { studentId: req.user!.userId },
      include: {
        question: {
          select: {
            id: true, title: true, type: true, difficulty: true, score: true,
            status: true, description: true, analysis: true, hints: true,
            primaryCategory: { select: { id: true, name: true } },
            secondaryCategory: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { lastWrongAt: 'desc' },
    });

    res.json(items);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/favorite — 切换收藏
practiceRouter.post('/favorite', async (req: Request, res: Response) => {
  try {
    const { questionId } = favoriteSchema.parse(req.body);
    const studentId = req.user!.userId;

    const existing = await prisma.favoriteQuestion.findUnique({
      where: { studentId_questionId: { studentId, questionId } },
    });

    if (existing) {
      await prisma.favoriteQuestion.delete({ where: { id: existing.id } });
      return res.json({ favorited: false });
    }

    await prisma.favoriteQuestion.create({ data: { studentId, questionId } });
    res.json({ favorited: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});

// GET /api/practice/favorite — 收藏列表
practiceRouter.get('/favorite', async (req: Request, res: Response) => {
  try {
    const items = await prisma.favoriteQuestion.findMany({
      where: { studentId: req.user!.userId },
      include: {
        question: {
          select: {
            id: true, title: true, type: true, difficulty: true, score: true,
            status: true, description: true, analysis: true, hints: true,
            primaryCategory: { select: { id: true, name: true } },
            secondaryCategory: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(items);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/practice/feedback — 题目/解析反馈
practiceRouter.post('/feedback', async (req: Request, res: Response) => {
  try {
    const { questionId, feedbackType, content } = feedbackSchema.parse(req.body);
    const studentId = req.user!.userId;

    const item = await prisma.questionFeedback.create({
      data: { studentId, questionId, feedbackType, content },
    });

    res.json(item);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    res.status(500).json({ message: '服务器错误' });
  }
});
