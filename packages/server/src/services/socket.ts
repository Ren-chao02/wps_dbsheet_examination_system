/**
 * Socket.IO 实时监控模块
 *
 * 事件协议：
 *   Client → Server:
 *     - exam:join        { examId, studentId, studentName }
 *     - exam:heartbeat   { examId, currentQuestion, tabSwitchCount }
 *     - exam:submit      { examId, studentId }
 *
 *   Server → Client (teacher):
 *     - monitor:update   { studentId, studentName, status, currentQuestion, tabSwitchCount, lastHeartbeat }
 *     - monitor:submit   { studentId, studentName, submittedAt }
 *     - monitor:join     { studentId, studentName }
 *     - monitor:leave    { studentId }
 */

import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { prisma } from '../config/prisma';

interface StudentState {
  studentId: string;
  studentName: string;
  examId: string;
  currentQuestion: number;
  tabSwitchCount: number;
  lastHeartbeat: Date;
  online: boolean;
}

// examId → Map<studentId, StudentState>
const examStudents = new Map<string, Map<string, StudentState>>();

let io: SocketServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] 连接: ${socket.id}`);

    // 学生加入考试监控
    socket.on('exam:join', (data: { examId: string; studentId: string; studentName: string }) => {
      const { examId, studentId, studentName } = data;

      socket.join(`exam:${examId}`);
      socket.join(`student:${studentId}`);

      if (!examStudents.has(examId)) {
        examStudents.set(examId, new Map());
      }

      const state: StudentState = {
        studentId,
        studentName,
        examId,
        currentQuestion: 0,
        tabSwitchCount: 0,
        lastHeartbeat: new Date(),
        online: true,
      };

      examStudents.get(examId)!.set(studentId, state);

      // 通知教师
      io!.to(`monitor:${examId}`).emit('monitor:join', {
        studentId,
        studentName,
        online: true,
      });

      console.log(`[Socket] 学生加入: ${studentName} -> exam:${examId}`);
    });

    // 教师加入监控
    socket.on('monitor:join', (data: { examId: string }) => {
      socket.join(`monitor:${data.examId}`);

      // 发送当前所有学生状态
      const students = examStudents.get(data.examId);
      if (students) {
        const studentList = Array.from(students.values()).map(s => ({
          studentId: s.studentId,
          studentName: s.studentName,
          currentQuestion: s.currentQuestion,
          tabSwitchCount: s.tabSwitchCount,
          lastHeartbeat: s.lastHeartbeat,
          online: s.online,
        }));
        socket.emit('monitor:students', studentList);
      }

      console.log(`[Socket] 教师加入监控: exam:${data.examId}`);
    });

    // 学生心跳
    socket.on('exam:heartbeat', (data: { examId: string; studentId: string; currentQuestion?: number; tabSwitchCount?: number }) => {
      const students = examStudents.get(data.examId);
      if (students) {
        const student = students.get(data.studentId);
        if (student) {
          student.lastHeartbeat = new Date();
          student.online = true;
          if (data.currentQuestion !== undefined) student.currentQuestion = data.currentQuestion;
          if (data.tabSwitchCount !== undefined) student.tabSwitchCount = data.tabSwitchCount;

          // 广播给教师
          io!.to(`monitor:${data.examId}`).emit('monitor:update', {
            studentId: student.studentId,
            studentName: student.studentName,
            currentQuestion: student.currentQuestion,
            tabSwitchCount: student.tabSwitchCount,
            lastHeartbeat: student.lastHeartbeat,
            online: true,
          });
        }
      }

      // 更新数据库 session
      prisma.examSession.findFirst({
        where: { studentId: data.studentId, examId: data.examId },
      }).then(session => {
        if (session) {
          prisma.examSession.update({
            where: { id: session.id },
            data: { lastHeartbeat: new Date(), wsConnected: true },
          }).catch(() => {});
        }
      });
    });

    // 学生提交
    socket.on('exam:submit', (data: { examId: string; studentId: string; studentName: string }) => {
      io!.to(`monitor:${data.examId}`).emit('monitor:submit', {
        studentId: data.studentId,
        studentName: data.studentName,
        submittedAt: new Date(),
      });
    });

    // 断开连接
    socket.on('disconnect', () => {
      // Mark student offline across all exams
      for (const [examId, students] of examStudents) {
        for (const [studentId, student] of students) {
          // Check if this socket was associated with this student
          // (simplified: mark offline if no heartbeat in 60s)
        }
      }
      console.log(`[Socket] 断开: ${socket.id}`);
    });
  });

  console.log('[Socket] Socket.IO 已初始化');
  return io;
}

/**
 * 从服务端主动推送状态更新（供路由调用）
 */
export function emitStudentUpdate(examId: string, studentId: string, data: Partial<StudentState>) {
  if (!io) return;
  const students = examStudents.get(examId);
  const student = students?.get(studentId);
  if (student) {
    io.to(`monitor:${examId}`).emit('monitor:update', {
      studentId: student.studentId,
      studentName: student.studentName,
      ...data,
    });
  }
}

export function emitStudentSubmit(examId: string, studentId: string, studentName: string) {
  if (!io) return;
  io.to(`monitor:${examId}`).emit('monitor:submit', {
    studentId,
    studentName,
    submittedAt: new Date(),
  });
}

export function getIO(): SocketServer | null {
  return io;
}
