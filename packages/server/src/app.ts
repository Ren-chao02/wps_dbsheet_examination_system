import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/users';
import { questionRouter } from './routes/questions';
import { categoryRouter } from './routes/categories';
import { examRouter } from './routes/exams';
import { myExamRouter } from './routes/my-exams';
import { gradingRouter } from './routes/grading';
import { statisticsRouter } from './routes/statistics';
import { demoRouter } from './routes/demo';
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
  app.use('/api/questions', questionRouter);
  app.use('/api/categories', categoryRouter);
  app.use('/api/exams', examRouter);
  app.use('/api/my-exams', myExamRouter);
  app.use('/api/grading', gradingRouter);
  app.use('/api/statistics', statisticsRouter);
app.use('/api/demo', demoRouter);

  // Error handling
  app.use(errorHandler);

  return app;
}
