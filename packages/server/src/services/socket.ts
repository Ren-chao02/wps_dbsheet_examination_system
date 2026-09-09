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
import jwt from 'jsonwebtoken';
import { config } from '../config';
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
// socket.id → { examId, studentId }
const socketStudentMap = new Map<string, { examId: string; studentId: string }>();

let io: SocketServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      // 允许的来源可通过 SOCKET_CORS_ORIGIN 环境变量配置（逗号分隔）；
      // 默认 '*' 时安全性由下方 JWT 握手鉴权保证：未携带有效令牌的连接一律拒绝
      origin: process.env.SOCKET_CORS_ORIGIN
        ? process.env.SOCKET_CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
        : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ✅ 握手鉴权：所有连接必须携带有效 JWT（客户端通过 io(url, { auth: { token } }) 传入）。
  // 否则任何人都可以连接后订阅考场监控、伪造学生心跳/交卷事件，污染监考数据。
  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth as Record<string, string> | undefined)?.token ||
        socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) {
        return next(new Error('unauthorized: missing token'));
      }
      const payload = jwt.verify(token, config.jwt.secret) as {
        id?: string;
        userId: string;
        username: string;
        role: string;
        realName?: string;
      };
      socket.data.userId = payload.userId || payload.id;
      socket.data.username = payload.username;
      socket.data.role = payload.role;
      socket.data.realName = payload.realName;
      next();
    } catch {
      next(new Error('unauthorized: invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] 连接: ${socket.id} (${socket.data.username}/${socket.data.role})`);

    // 学生加入考试监控（✅ 身份校验：学生只能以自己的身份加入，防止伪造他人在线状态）
    socket.on('exam:join', (data: { examId: string; studentId: string; studentName: string }) => {
      if (socket.data.role !== 'student' || data.studentId !== socket.data.userId) {
        socket.emit('exam:error', { message: '无权限以他人身份加入考试' });
        return;
      }
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
      socketStudentMap.set(socket.id, { examId, studentId });

      // 通知教师
      io!.to(`monitor:${examId}`).emit('monitor:join', {
        studentId,
        studentName,
        online: true,
      });

      console.log(`[Socket] 学生加入: ${studentName} -> exam:${examId}`);
    });

    // 教师加入监控（✅ 角色校验：仅教师/管理员可订阅考场监控）
    socket.on('monitor:join', (data: { examId: string }) => {
      if (socket.data.role !== 'teacher' && socket.data.role !== 'admin') {
        socket.emit('monitor:error', { message: '无权限查看考场监控' });
        return;
      }
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

    // 学生心跳（✅ 身份校验：只能上报自己的心跳）
    socket.on('exam:heartbeat', (data: { examId: string; studentId: string; currentQuestion?: number; tabSwitchCount?: number }) => {
      if (socket.data.role !== 'student' || data.studentId !== socket.data.userId) return;
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

    // 学生提交（✅ 身份校验：只能上报自己的交卷事件）
    socket.on('exam:submit', (data: { examId: string; studentId: string; studentName: string }) => {
      if (socket.data.role !== 'student' || data.studentId !== socket.data.userId) return;
      io!.to(`monitor:${data.examId}`).emit('monitor:submit', {
        studentId: data.studentId,
        studentName: data.studentName,
        submittedAt: new Date(),
      });
    });

    // 学生退出全屏（✅ 身份校验：只能上报自己的事件）
    socket.on('exam:fullscreen-exit', (data: { examId: string; studentId: string; studentName: string }) => {
      if (socket.data.role !== 'student' || data.studentId !== socket.data.userId) return;
      const students = examStudents.get(data.examId);
      const student = students?.get(data.studentId);
      if (student) {
        io!.to(`monitor:${data.examId}`).emit('monitor:fullscreen-exit', {
          studentId: data.studentId,
          studentName: data.studentName,
          occurredAt: new Date(),
        });
      }
    });

    // 断开连接
    socket.on('disconnect', () => {
      const mapping = socketStudentMap.get(socket.id);
      if (mapping) {
        const { examId, studentId } = mapping;
        socketStudentMap.delete(socket.id);
        const students = examStudents.get(examId);
        const student = students?.get(studentId);
        if (student) {
          student.online = false;
          io!.to(`monitor:${examId}`).emit('monitor:update', {
            studentId: student.studentId,
            studentName: student.studentName,
            currentQuestion: student.currentQuestion,
            tabSwitchCount: student.tabSwitchCount,
            lastHeartbeat: student.lastHeartbeat,
            online: false,
          });
          console.log(`[Socket] 学生离线: ${student.studentName} -> exam:${examId}`);
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
