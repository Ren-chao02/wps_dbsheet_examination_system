import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';

/**
 * 考试配置变更守卫：考试状态为 ended（已结束）后，禁止再修改该考试的
 * 考场 / 考生 / WPS 表格等配置（批量分配、移除等 POST/DELETE 请求）。
 *
 * 用法：在路由定义前挂载到对应路径前缀，例如
 *   router.use('/exams/:examId', rejectExamConfigMutationWhenEnded())
 *
 * - GET / HEAD 等只读请求直接放行，详情查看不受影响；
 * - 非只读请求按路径参数 examId 校验考试状态，ended 返回 400。
 */
export function rejectExamConfigMutationWhenEnded() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const examId = req.params.examId;
    if (!examId) return next();

    try {
      const exam = await prisma.exam.findUnique({
        where: { id: examId },
        select: { status: true },
      });
      if (!exam) {
        return res.status(404).json({ message: '考试不存在' });
      }
      if (exam.status === 'ended') {
        return res.status(400).json({ message: '考试已结束，无法修改考试配置' });
      }
      next();
    } catch {
      res.status(500).json({ message: '服务器错误' });
    }
  };
}
