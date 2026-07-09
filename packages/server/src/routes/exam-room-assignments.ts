import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const examRoomAssignmentRouter = Router();
examRoomAssignmentRouter.use(authenticate);
examRoomAssignmentRouter.use(authorize('teacher', 'admin'));

const assignSchema = z.object({
  roomId: z.string().uuid(),
});

const batchAssignSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1).max(50),
});

// POST /api/exam-room-assignments/exams/:examId/rooms - 分配考场（含冲突检测）
examRoomAssignmentRouter.post('/exams/:examId/rooms', async (req: Request, res: Response) => {
  try {
    const { roomId } = assignSchema.parse(req.body);
    const examId = req.params.examId;

    const [exam, room] = await Promise.all([
      prisma.exam.findUnique({ where: { id: examId }, select: { id: true, title: true, startTime: true, endTime: true } }),
      prisma.examRoom.findUnique({ where: { id: roomId } }),
    ]);
    if (!exam) return res.status(404).json({ message: '考试不存在' });
    if (!room) return res.status(404).json({ message: '考场不存在' });

    if (room.status === 'maintenance') {
      return res.status(400).json({ message: '该考场正在维护中，无法分配' });
    }

    const existing = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
    });
    if (existing) {
      return res.status(400).json({ message: '该考场已分配给此考试，请勿重复分配' });
    }

    // 时间冲突检测
    if (exam.startTime && exam.endTime) {
      const conflicts = await prisma.examRoomAssignment.findMany({
        where: {
          roomId,
          status: { in: ['scheduled', 'in_progress'] },
          exam: {
            startTime: { lt: exam.endTime },
            endTime: { gt: exam.startTime },
          },
        },
        include: {
          exam: { select: { id: true, title: true, startTime: true, endTime: true } },
        },
      });

      if (conflicts.length > 0) {
        return res.status(409).json({
          message: `时间冲突！该考场已被其他考试占用`,
          conflicts: conflicts.map(c => ({
            examId: c.examId,
            examTitle: c.exam.title,
            startTime: c.exam.startTime,
            endTime: c.exam.endTime,
          })),
        });
      }
    }

    const assignment = await prisma.examRoomAssignment.create({
      data: { examId, roomId, status: 'scheduled' },
      include: {
        exam: { select: { id: true, title: true, startTime: true, endTime: true } },
        room: { select: { id: true, code: true, name: true, capacity: true } },
      },
    });

    res.status(201).json(assignment);
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('分配考场失败:', err);
    res.status(500).json({ message: '分配失败' });
  }
});

// GET /api/exam-room-assignments/exams/:examId/rooms - 查询某考试已分配的考场
examRoomAssignmentRouter.get('/exams/:examId/rooms', async (req: Request, res: Response) => {
  try {
    const examId = req.params.examId;
    const assignments = await prisma.examRoomAssignment.findMany({
      where: { examId },
      include: {
        room: true,
        students: {
          include: {
            student: { select: { id: true, realName: true, studentId: true } },
          },
          orderBy: { seatNumber: 'asc' },
        },
        invigilators: { select: { id: true, realName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ data: assignments });
  } catch (error) {
    console.error('获取考试考场列表失败:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// DELETE /api/exam-room-assignments/exams/:examId/rooms/:roomId - 取消分配
examRoomAssignmentRouter.delete('/exams/:examId/rooms/:roomId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId } = req.params;
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      include: { _count: { select: { students: true } } },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    if (assignment._count.students > 0) {
      return res.status(400).json({
        message: `该考场已分配 ${assignment._count.students} 名学生，请先移除学生后再取消分配`,
      });
    }

    await prisma.examRoomAssignment.delete({
      where: { examId_roomId: { examId, roomId } },
    });

    res.json({ message: '取消分配成功' });
  } catch (error) {
    console.error('取消分配失败:', error);
    res.status(500).json({ message: '取消分配失败' });
  }
});

// POST /api/exam-room-assignments/exams/:examId/rooms/:roomId/students/batch-assign - 批量分配学生
examRoomAssignmentRouter.post('/exams/:examId/rooms/:roomId/students/batch-assign', async (req: Request, res: Response) => {
  try {
    const { studentIds } = batchAssignSchema.parse(req.body);
    const { examId, roomId } = req.params;

    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      include: {
        room: { select: { capacity: true } },
        _count: { select: { students: true } },
        students: { select: { studentId: true } },
      },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    const currentCount = assignment._count.students;
    const availableCapacity = assignment.room.capacity - currentCount;
    if (studentIds.length > availableCapacity) {
      return res.status(400).json({
        message: `考场容量不足，剩余座位: ${availableCapacity}`,
        available: availableCapacity,
      });
    }

    const existingIds = assignment.students.map(s => s.studentId);
    const newStudents = studentIds.filter(id => !existingIds.includes(id));
    if (newStudents.length === 0) {
      return res.status(400).json({ message: '所有选中的学生已经在该考场中' });
    }

    const startSeatNumber = currentCount + 1;
    await prisma.examRoomStudent.createMany({
      data: newStudents.map((studentId, index) => ({
        assignmentId: assignment.id,
        studentId,
        seatNumber: startSeatNumber + index,
      })),
    });

    res.status(201).json({
      message: `成功分配 ${newStudents.length} 名学生`,
      assignedCount: newStudents.length,
      skippedCount: existingIds.length,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('批量分配学生失败:', err);
    res.status(500).json({ message: '分配失败' });
  }
});

// DELETE /api/exam-room-assignments/exams/:examId/rooms/:roomId/students/:studentId - 移除单个学生
examRoomAssignmentRouter.delete('/exams/:examId/rooms/:roomId/students/:studentId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId, studentId } = req.params;
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      select: { id: true },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    await prisma.examRoomStudent.delete({
      where: {
        assignmentId_studentId: {
          assignmentId: assignment.id,
          studentId,
        },
      },
    });

    res.json({ message: '移除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '该学生未在此考场中' });
    }
    console.error('移除学生失败:', err);
    res.status(500).json({ message: '移除失败' });
  }
});

// POST /api/exam-room-assignments/exams/:examId/rooms/:roomId/invigilators/:userId - 分配监考老师
examRoomAssignmentRouter.post('/exams/:examId/rooms/:roomId/invigilators/:userId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId, userId } = req.params;
    const assignment = await prisma.examRoomAssignment.findUnique({
      where: { examId_roomId: { examId, roomId } },
      include: { invigilators: { select: { id: true } } },
    });
    if (!assignment) {
      return res.status(404).json({ message: '未找到该考场分配记录' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, realName: true },
    });
    if (!user || !['teacher', 'admin'].includes(user.role)) {
      return res.status(400).json({ message: '只能分配老师或管理员作为监考' });
    }
    if (assignment.invigilators.some(inv => inv.id === userId)) {
      return res.status(400).json({ message: `${user.realName} 已经是该考场的监考老师` });
    }

    const updated = await prisma.examRoomAssignment.update({
      where: { examId_roomId: { examId, roomId } },
      data: { invigilators: { connect: { id: userId } } },
      include: { invigilators: { select: { id: true, realName: true } } },
    });

    res.json({ message: `成功分配监考老师: ${user.realName}`, data: updated.invigilators });
  } catch (error) {
    console.error('分配监考失败:', error);
    res.status(500).json({ message: '分配失败' });
  }
});

// DELETE /api/exam-room-assignments/exams/:examId/rooms/:roomId/invigilators/:userId - 移除监考老师
examRoomAssignmentRouter.delete('/exams/:examId/rooms/:roomId/invigilators/:userId', async (req: Request, res: Response) => {
  try {
    const { examId, roomId, userId } = req.params;
    const updated = await prisma.examRoomAssignment.update({
      where: { examId_roomId: { examId, roomId } },
      data: { invigilators: { disconnect: { id: userId } } },
      include: { invigilators: { select: { id: true, realName: true } } },
    });
    res.json({ message: '移除成功', data: updated.invigilators });
  } catch (error) {
    console.error('移除监考失败:', error);
    res.status(500).json({ message: '移除失败' });
  }
});
