import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { KingsoftAdapter } from '../engine/adapters/kingsoft-adapter';

/**
 * 金山多维表格 API 代理路由
 *
 * 前端通过此路由代理调用 WPS API，避免直接暴露 API 密钥。
 * 所有请求需要教师或管理员认证。
 */

export const kingsoftRouter = Router();
kingsoftRouter.use(authenticate);
kingsoftRouter.use(authorize('teacher', 'admin'));

// POST /api/kingsoft/proxy — 通用代理
kingsoftRouter.post('/proxy', async (req: Request, res: Response) => {
  try {
    const { fileId, accessToken, action, params } = req.body;

    if (!fileId || !accessToken || !action) {
      return res.status(400).json({ message: '缺少必要参数: fileId, accessToken, action' });
    }

    const adapter = new KingsoftAdapter(fileId, accessToken);

    // 路由到对应的 API 方法
    let result: any;
    switch (action) {
      case 'schema/query':
        result = await adapter.getSchema();
        break;
      case 'record/list':
        if (!params?.sheetId) {
          return res.status(400).json({ message: 'record/list 需要 sheetId 参数' });
        }
        result = await adapter.getRecords(params.sheetId, {
          pageSize: params.pageSize,
          viewId: params.viewId,
          fields: params.fields,
        });
        break;
      default:
        return res.status(400).json({ message: `不支持的 action: ${action}` });
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: 'API 调用失败', detail: err.message });
  }
});

// GET /api/kingsoft/table/:file_id/tables — 获取表列表
kingsoftRouter.get('/table/:file_id/tables', async (req: Request, res: Response) => {
  try {
    const { file_id } = req.params;
    const accessToken = req.query.access_token as string;

    if (!accessToken) {
      return res.status(400).json({ message: '缺少 access_token 参数' });
    }

    const adapter = new KingsoftAdapter(file_id, accessToken);
    const tables = await adapter.getTables();
    res.json({ tables });
  } catch (err: any) {
    res.status(500).json({ message: '获取表列表失败', detail: err.message });
  }
});

// GET /api/kingsoft/table/:file_id/:table_name/fields — 获取字段
kingsoftRouter.get('/table/:file_id/:table_name/fields', async (req: Request, res: Response) => {
  try {
    const { file_id, table_name } = req.params;
    const accessToken = req.query.access_token as string;

    if (!accessToken) {
      return res.status(400).json({ message: '缺少 access_token 参数' });
    }

    const adapter = new KingsoftAdapter(file_id, accessToken);
    const fields = await adapter.getFields(decodeURIComponent(table_name));
    res.json({ fields });
  } catch (err: any) {
    res.status(500).json({ message: '获取字段失败', detail: err.message });
  }
});

// GET /api/kingsoft/table/:file_id/:table_name/views — 获取视图
kingsoftRouter.get('/table/:file_id/:table_name/views', async (req: Request, res: Response) => {
  try {
    const { file_id, table_name } = req.params;
    const accessToken = req.query.access_token as string;

    if (!accessToken) {
      return res.status(400).json({ message: '缺少 access_token 参数' });
    }

    const adapter = new KingsoftAdapter(file_id, accessToken);
    const views = await adapter.getViews(decodeURIComponent(table_name));
    res.json({ views });
  } catch (err: any) {
    res.status(500).json({ message: '获取视图失败', detail: err.message });
  }
});
