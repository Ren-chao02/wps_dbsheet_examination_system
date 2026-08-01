import express from 'express';
import cors from 'cors';
import path from 'path';
import { authRouter } from './routes/auth';
import { authenticate } from './middleware/auth';
import { userRouter } from './routes/users';
import { departmentRouter } from './routes/departments';
import { questionRouter } from './routes/questions';
import { categoryRouter } from './routes/categories';
import { capabilityRouter } from './routes/capabilities';
import { examRouter } from './routes/exams';
import { myExamRouter } from './routes/my-exams';
import { examTableAssignmentRouter } from './routes/exam-table-assignments';
import { paperRouter } from './routes/papers';
import { practiceRouter } from './routes/practice';
import { gradingRouter } from './routes/grading';
import { statisticsRouter } from './routes/statistics';
import { demoRouter } from './routes/demo';
import { kingsoftRouter } from './routes/kingsoft';
import { studentRouter } from './routes/students';
import { importTaskRouter } from './routes/import-tasks';
import { invitationRouter, applicationRouter } from './routes/invitations';
import { roleRouter } from './routes/roles';
import { accountRouter } from './routes/accounts';
import { cacheRouter } from './routes/cache';
import { wpsTokenRouter } from './routes/wps-token';
import { wpsConfigRouter } from './routes/wps-config';
// ✅ 新增：批次管理和考场管理路由
import { batchRouter } from './routes/batches';
import { roomRouter } from './routes/rooms';
import { examRoomAssignmentRouter } from './routes/exam-room-assignments';
// ✅ Phase 3 新增：考生行为日志路由
import { behaviorRouter } from './routes/behaviors';
// ✅ Phase 3.2 新增：操作审计日志路由
import { auditRouter } from './routes/audit';
import { auditMiddleware } from './middleware/audit-middleware';
// ✅ Phase 3.3 新增：统一数据导出路由
import { exportRouter } from './routes/export';
// ✅ Phase 3.4 新增：实时通知推送路由
import { notificationRouter } from './routes/notifications';
import { studentProfileRouter } from './routes/student-profile';
// ✅ Phase 2 新增：AI 对话式教练路由
import { coachingRouter } from './routes/coaching';
import { llmConfigRouter } from './routes/llm-config';
import { errorHandler } from './middleware/error-handler';

export function createApp() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  // ✅ Phase 3.2: 全局审计中间件（自动记录CRUD操作）
  app.use(auditMiddleware);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/departments', departmentRouter);
  app.use('/api/questions', questionRouter);
  app.use('/api/categories', categoryRouter);
  app.use('/api/capabilities', capabilityRouter);
  app.use('/api/exams', examRouter);
  app.use('/api/exam-table-assignments', examTableAssignmentRouter);
  app.use('/api/my-exams', myExamRouter);
  app.use('/api/papers', paperRouter);
  app.use('/api/practice', practiceRouter);
  app.use('/api/grading', gradingRouter);
  app.use('/api/statistics', statisticsRouter);
  app.use('/api/demo', demoRouter);
  app.use('/api/kingsoft', kingsoftRouter);
  app.use('/api/students', studentRouter);
  app.use('/api/import-tasks', importTaskRouter);
  app.use('/api/invitations', invitationRouter);
  app.use('/api/applications', applicationRouter);
  app.use('/api/roles', roleRouter);
  app.use('/api/accounts', accountRouter);
  app.use('/api/cache', cacheRouter);
  app.use('/api/wps-token', wpsTokenRouter);
  app.use('/api/wps-config', wpsConfigRouter);
  // ✅ 新增：批次管理和考场管理API
  app.use('/api/batches', batchRouter);
  app.use('/api/rooms', roomRouter);
  app.use('/api/exam-room-assignments', examRoomAssignmentRouter);
  // ✅ Phase 3 新增：考生行为日志API
  app.use('/api/behaviors', behaviorRouter);
  // ✅ Phase 3.2 新增：操作审计日志API
  app.use('/api/audit', auditRouter);
  // ✅ Phase 3.3 新增：统一数据导出API
  app.use('/api/export', exportRouter);
  // ✅ Phase 3.4 新增：实时通知推送API
  app.use('/api/notifications', authenticate, notificationRouter);
  // 学生个人资料API
  app.use('/api/student-profile', studentProfileRouter);
  // ✅ Phase 2 新增：AI 对话式教练 API
  app.use('/api/coaching', coachingRouter);
  app.use('/api/llm-config', llmConfigRouter);

  // 生产环境：托管前端构建产物（vite build → packages/client/dist）
  // 开发环境用 Vite dev server（5173），不走这里
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    // SPA fallback：非 /api、非 /socket.io 路由统一回退到 index.html，交给前端路由
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Error handling
  app.use(errorHandler);

  return app;
}
