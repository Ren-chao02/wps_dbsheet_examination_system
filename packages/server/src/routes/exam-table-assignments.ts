import express, { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { rejectExamConfigMutationWhenEnded } from '../middleware/exam-lock';
import { scopeCtxOf, assertExamAccess, denyAccess } from '../services/data-scope';
import { checkTablesReadable } from '../services/table-health-service';

export const examTableAssignmentRouter = Router();
examTableAssignmentRouter.use(authenticate);
examTableAssignmentRouter.use(authorize('teacher', 'admin'));

// 批量分配表格的请求体可达 3000 学生 × 约 1KB（含超长 WPS accessToken），
// 远超 app.ts 全局 express.json() 的默认 100KB 上限 → 考前分配这一步会 413。
// 这里为本路由挂载独立的 10MB 解析器；对已解析过的小请求体 body-parser 会
// 直接跳过，不影响本路由外的任何接口。
examTableAssignmentRouter.use(express.json({ limit: '10mb' }));

// ✅ 考试已结束(ended)后，禁止继续修改该考试的 WPS 表格分配
examTableAssignmentRouter.use('/:examId', rejectExamConfigMutationWhenEnded());

function extractFileId(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('http')) {
    const match = trimmed.match(/\/l\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      throw new Error('Invalid share URL');
    }
    return match[1];
  }
  return trimmed;
}

// GET /api/exam-table-assignments/:examId
examTableAssignmentRouter.get('/:examId', async (req: Request, res: Response) => {
  try {
    const access = await assertExamAccess(scopeCtxOf(req), req.params.examId);
    if (access !== 'ok') return denyAccess(res, access);
    const { examId } = req.params;
    const assignments = await prisma.examTableAssignment.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, realName: true, username: true, studentId: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });
    // 凭据保护：accessToken 是 WPS 访问凭据，不能原样返回给列表接口
    // （前端只用于显示「已分配/未分配」与回填分享链接，用布尔 hasToken 代替）。
    // 教师端 WpsTableAssignStep 仅读取 studentId/shareUrl，剥离不影响其显示。
    res.json({
      assignments: assignments.map(({ accessToken, ...rest }) => ({
        ...rest,
        hasToken: !!accessToken,
      })),
    });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exam-table-assignments/:examId/bulk
examTableAssignmentRouter.post('/:examId/bulk', async (req: Request, res: Response) => {
  try {
    const access = await assertExamAccess(scopeCtxOf(req), req.params.examId);
    if (access !== 'ok') return denyAccess(res, access);
    const { examId } = req.params;
    const { items } = req.body as { items: { studentId: string; shareUrl: string; accessToken: string }[] };

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: '缺少分配数据' });
    }

    const exam = await prisma.exam.findUnique({ where: { id: examId } });
    if (!exam) return res.status(404).json({ message: '考试不存在' });

    let assignments;
    try {
      assignments = items.map(item => {
        const fileId = extractFileId(item.shareUrl);
        return {
          examId,
          studentId: item.studentId,
          fileId,
          shareUrl: item.shareUrl.trim(),
          accessToken: item.accessToken,
          assignedBy: req.user!.userId,
        };
      });
    } catch {
      return res.status(400).json({ message: '分享链接格式不正确' });
    }

    const fileIds = new Set();
    for (const a of assignments) {
      if (fileIds.has(a.fileId)) {
        return res.status(400).json({ message: '表格不能重复分配给多名考生' });
      }
      fileIds.add(a.fileId);
    }

    // 保存前先确认这些表格真的读得到。
    // 此前不校验的后果是：老师贴一个已删除/分享被撤销的链接 → 看到「分配保存成功」
    // → 学生坐到考场上，右侧 iframe 里是「文档已删除」，做不了题；判分也读不到表格，
    // 答卷会一直卡在「已交卷」。这个坑已经真实发生过（3 场考试引用了同一份失效表格）。
    // 校验放在 deleteMany 之前：不合格就一个字节都不写，避免把原有分配也清掉。
    const health = await checkTablesReadable(
      assignments.map(a => ({ fileId: a.fileId, accessToken: a.accessToken })),
    );
    if (health.failed.length > 0) {
      return res.status(400).json({
        message: `以下表格无法读取，请确认文档未被删除、且应用有访问权限：${health.failed.map(f => f.fileId).join('、')}`,
        failures: health.failed,
      });
    }

    await prisma.examTableAssignment.deleteMany({
      where: {
        examId,
        studentId: { in: assignments.map(a => a.studentId) },
      },
    });

    try {
      await prisma.examTableAssignment.createMany({ data: assignments });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return res.status(400).json({ message: '表格已被分配给其他考生' });
      }
      throw err;
    }

    res.json({
      count: assignments.length,
      // 极端批量（远超并发×时间预算）时会有没查完的：放行但明确告知，不静默跳过
      ...(health.unchecked.length > 0 && {
        warning: `共 ${health.unchecked.length} 个表格因数量过多未能在本次分配时校验，请自行确认其可用性`,
        unchecked: health.unchecked,
      }),
    });
  } catch (err: any) {
    res.status(500).json({ message: '服务器错误', detail: err.message });
  }
});

// DELETE /api/exam-table-assignments/:examId/:studentId
examTableAssignmentRouter.delete('/:examId/:studentId', async (req: Request, res: Response) => {
  try {
    const access = await assertExamAccess(scopeCtxOf(req), req.params.examId);
    if (access !== 'ok') return denyAccess(res, access);
    const { examId, studentId } = req.params;
    await prisma.examTableAssignment.deleteMany({
      where: { examId, studentId },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
