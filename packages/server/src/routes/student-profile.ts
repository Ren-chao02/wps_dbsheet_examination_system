import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';
import { studentExamVisibilityOR } from '../utils/exam-utils';

export const studentProfileRouter = Router();
studentProfileRouter.use(authenticate);
studentProfileRouter.use(authorize('student'));

studentProfileRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        department: { select: { name: true } },
        major: { select: { name: true } },
        classRoom: { select: { name: true, academicYear: true } },
        _count: {
          select: {
            submissions: true,
            practiceRecords: true,
            favoriteQuestions: true,
            wrongQuestions: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // examCount: 统计学生可以参加的考试数量，与 my-exams 接口口径一致
    const examCount = await prisma.exam.count({
      where: {
        status: { in: ['published', 'in_progress', 'ended'] },
        OR: studentExamVisibilityOR(user.id),
      },
    });
    // gradedCount: 已出成绩且对学生可见的提交数（口径同 my-exams）
    const gradedCount = await prisma.studentSubmission.count({
      where: {
        studentId: user.id,
        status: 'graded',
        exam: {
          status: { in: ['published', 'in_progress', 'ended'] },
          OR: studentExamVisibilityOR(user.id),
        },
      },
    });

    res.json({
      id: user.id,
      realName: user.realName,
      username: user.username,
      studentId: user.studentId,
      gender: user.gender,
      phoneNumber: user.phoneNumber,
      email: user.email,
      department: user.department?.name,
      major: user.major?.name,
      classRoom: user.classRoom?.name,
      academicYear: user.classRoom?.academicYear,
      stats: {
        examCount,
        gradedCount,
        practiceCount: user._count.practiceRecords,
        favoriteCount: user._count.favoriteQuestions,
        wrongCount: user._count.wrongQuestions,
      },
    });
  } catch (err) {
    console.error('Student profile error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
