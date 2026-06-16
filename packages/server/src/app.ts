import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/users';
import { departmentRouter } from './routes/departments';
import { questionRouter } from './routes/questions';
import { categoryRouter } from './routes/categories';
import { examRouter } from './routes/exams';
import { myExamRouter } from './routes/my-exams';
import { gradingRouter } from './routes/grading';
import { statisticsRouter } from './routes/statistics';
import { demoRouter } from './routes/demo';
import { kingsoftRouter } from './routes/kingsoft';
import { studentRouter } from './routes/students';
import { importTaskRouter } from './routes/import-tasks';
import { invitationRouter, applicationRouter } from './routes/invitations';
import { roleRouter } from './routes/roles';
import { accountRouter } from './routes/accounts';
import { errorHandler } from './middleware/error-handler';

export function createApp() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

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
  app.use('/api/exams', examRouter);
  app.use('/api/my-exams', myExamRouter);
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

  // Error handling
  app.use(errorHandler);

  return app;
}
