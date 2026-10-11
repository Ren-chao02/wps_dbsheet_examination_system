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

  // ⚠️ trust proxy 必须在任何读取 req.ip 的逻辑之前设置。
  // 生产环境应用端口只绑定 127.0.0.1（见 docker-compose），只有同机反向代理能访问，
  // 因此信任 1 跳是安全的；不设置的话 req.ip 一律是代理 IP，IP 白名单会全部失效。
  // 通过 TRUST_PROXY 环境变量可覆盖（多级代理填跳数、直连填 false）。
  const trustProxyEnv = process.env.TRUST_PROXY;
  app.set(
    'trust proxy',
    trustProxyEnv !== undefined
      ? (trustProxyEnv === 'false' ? false : (Number(trustProxyEnv) || trustProxyEnv))
      : (process.env.NODE_ENV === 'production' ? 1 : false),
  );

  // Middleware
  // CORS：默认放开（前后端同源部署，浏览器本不需要跨域；放开是为了兼容内网穿透域名）。
  // 如需收紧，设置 CORS_ORIGINS（逗号分隔白名单）即可，无需改代码。
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);
  app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : {}));

  // 批量分配 WPS 表格的请求体很大：每名学生一条 { studentId, shareUrl, accessToken }，
  // accessToken 是长 JWT（约 1KB），3000 人 ≈ 3MB，远超 express.json() 默认的 100KB。
  // ⚠️ 必须挂在全局解析器**之前**：Express 按注册顺序执行，全局解析器先跑的话，
  // 超限请求在路由层拿到控制权之前就已经 413 了（路由内再挂一个 limit 也没用）。
  app.use('/api/exam-table-assignments', express.json({ limit: '10mb' }));
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
