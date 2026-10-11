import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  // 带上方法/路径/操作者：出问题时第一个想知道的就是"谁在什么时候调了哪个接口"。
  // userId 取自认证中间件注入的 req.user，未登录请求为 undefined。
  const context = {
    err,
    method: req.method,
    path: req.path,
    userId: (req as { user?: { id?: string } }).user?.id,
  };

  if (err instanceof ZodError) {
    // 参数校验失败是客户端把请求发错了，不是服务端故障。
    // 原来这里和真正的 5xx 一起按 error 记，会把告警淹没在噪声里。
    logger.warn(context, '请求参数校验失败');
    return res.status(400).json({
      message: '请求参数验证失败',
      errors: err.errors,
    });
  }

  logger.error(context, '未捕获的服务端错误');

  return res.status(500).json({
    message: '服务器内部错误',
    ...(process.env.NODE_ENV === 'development' && { detail: err.message }),
  });
}
