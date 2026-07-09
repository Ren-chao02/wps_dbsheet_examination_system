import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const examTableAssignmentRouter = Router();
examTableAssignmentRouter.use(authenticate);
examTableAssignmentRouter.use(authorize('teacher', 'admin'));

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
    const { examId } = req.params;
    const assignments = await prisma.examTableAssignment.findMany({
      where: { examId },
      include: {
        student: { select: { id: true, realName: true, username: true, studentId: true } },
      },
      orderBy: { assignedAt: 'asc' },
    });
    res.json({ assignments });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// POST /api/exam-table-assignments/:examId/bulk
examTableAssignmentRouter.post('/:examId/bulk', async (req: Request, res: Response) => {
  try {
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

    res.json({ count: assignments.length });
  } catch (err: any) {
    res.status(500).json({ message: '服务器错误', detail: err.message });
  }
});

// DELETE /api/exam-table-assignments/:examId/:studentId
examTableAssignmentRouter.delete('/:examId/:studentId', async (req: Request, res: Response) => {
  try {
    const { examId, studentId } = req.params;
    await prisma.examTableAssignment.deleteMany({
      where: { examId, studentId },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
