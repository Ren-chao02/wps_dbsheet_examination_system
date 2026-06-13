import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error('Unhandled error:', err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      message: '请求参数验证失败',
      errors: err.errors,
    });
  }

  return res.status(500).json({
    message: '服务器内部错误',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}
