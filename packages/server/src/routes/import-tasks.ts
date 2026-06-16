/**
 * 导入任务路由 — 查询导入任务 & 下载失败记录 & 下载完成文件
 */
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../config/prisma';
import { authenticate } from '../middleware/auth';

export const importTaskRouter = Router();

const errorDir = path.join(__dirname, '../../uploads/errors');

// 所有接口需要认证
importTaskRouter.use(authenticate);

// ============================================================
// GET /api/import-tasks — 导入任务列表（分页）
//   scope=mine (默认): 当前用户创建的任务
//   scope=all: 所有任务（管理员视角）
// ============================================================

importTaskRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { page = '1', pageSize = '20', scope = 'mine', type } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};

    // scope=all 仅 admin 可用
    if (scope === 'all' && req.user!.role === 'admin') {
      // 管理员查看所有任务
    } else {
      where.createdBy = req.user!.userId;
    }

    if (type) {
      where.type = String(type);
    }

    const [data, total] = await Promise.all([
      prisma.importTask.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          fileName: true,
          taskName: true,
          totalRows: true,
          successRows: true,
          failedRows: true,
          status: true,
          errorFile: true,
          downloadUrl: true,
          createdBy: true,
          createdAt: true,
          completedAt: true,
          creator: {
            select: { realName: true, username: true },
          },
        },
      }),
      prisma.importTask.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// GET /api/import-tasks/:id/error-file — 下载失败记录文件
// ============================================================

importTaskRouter.get('/:id/error-file', async (req: Request, res: Response) => {
  try {
    const where: any = { id: req.params.id };
    // admin 可以下载任何任务的错误文件，普通用户只能下载自己的
    if (req.user!.role !== 'admin') {
      where.createdBy = req.user!.userId;
    }

    const task = await prisma.importTask.findFirst({ where });

    if (!task) {
      return res.status(404).json({ message: '导入任务不存在' });
    }

    if (!task.errorFile) {
      return res.status(404).json({ message: '无失败记录文件' });
    }

    const filePath = path.join(errorDir, task.errorFile);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: '失败记录文件已丢失' });
    }

    const fileName = encodeURIComponent(`导入失败记录_${task.fileName}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});

// ============================================================
// GET /api/import-tasks/:id/download — 下载已完成任务的文件
// ============================================================

importTaskRouter.get('/:id/download', async (req: Request, res: Response) => {
  try {
    const where: any = { id: req.params.id };
    if (req.user!.role !== 'admin') {
      where.createdBy = req.user!.userId;
    }

    const task = await prisma.importTask.findFirst({ where });

    if (!task) {
      return res.status(404).json({ message: '任务不存在' });
    }

    if (task.status !== 'FINISHED') {
      return res.status(400).json({ message: '任务尚未完成' });
    }

    if (!task.downloadUrl) {
      return res.status(404).json({ message: '无可下载文件' });
    }

    const filePath = path.join(__dirname, '../../uploads', task.downloadUrl);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: '文件已丢失' });
    }

    const fileName = encodeURIComponent(task.fileName);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch {
    res.status(500).json({ message: '服务器错误' });
  }
});
