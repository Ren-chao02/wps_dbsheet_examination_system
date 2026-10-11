/**
 * ✅ 操作审计中间件 (Audit Middleware)
 *
 * 核心功能：
 * - 自动拦截所有CRUD操作并记录
 * - 捕获变更前后数据快照
 * - 提取操作者信息和环境信息
 * - 异步写入审计日志（不阻塞业务流程）
 *
 * 使用方式：
 * app.use(auditMiddleware)  // 全局注册
 *
 * 配置项：
 * - excludePaths: 排除的路径（如健康检查、静态资源）
 * - sensitiveFields: 敏感字段脱敏（如password, token）
 */

import { Request, Response, NextFunction } from 'express';
import { AuditAction } from '@prisma/client';
import { prisma } from '../config/prisma';

// ✅ 配置常量
// 前缀排除（startsWith 匹配）：健康检查、登录、审计自身
const EXCLUDE_PATHS = [
  '/api/health',
  '/api/auth/login',
  '/api/audit', // 避免循环记录
];

// ✅ 高频上报路径排除（正则精确匹配）。
// 为什么排除：单场 3000 人 × 2 小时考试，光心跳（每 10 秒一次）就会产生
// 约 36 万行审计日志——既没有审计价值，又会拖垮 auditLog 表的写入与查询。
// 注意：必须精确匹配，绝不能把 /api/my-exams/:id/submit（交卷）也排掉——
// 交卷是关键审计事件，必须保留（这也是为什么不用前缀 /api/my-exams/ 一刀切）。
const EXCLUDE_PATH_PATTERNS = [
  /^\/api\/my-exams\/[^/]+\/heartbeat$/, // 学生心跳上报（POST，每 10 秒一次）
  /^\/api\/behaviors\/record$/,          // 切屏等行为上报（POST，高频）
];

const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
];

// ✅ HTTP方法到操作类型的映射
const METHOD_ACTION_MAP: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PUT: AuditAction.UPDATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

// ✅ 路径到实体类型的映射
function extractEntityType(url: string): string | null {
  const pathParts = url.split('/').filter(Boolean);

  if (pathParts.length < 2 || pathParts[0] !== 'api') return null;

  // 提取实体类型（如 /api/exams -> Exam）
  const entityName = pathParts[1];
  return entityName
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase()) // kebab-case转camelCase
    .replace(/^./, str => str.toUpperCase()); // 首字母大写
}

// ✅ 从URL中提取实体ID
function extractEntityId(url: string): string | null {
  const match = url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  return match ? match[1] : null;
}

// ✅ 敏感数据脱敏
function sanitizeData(data: any): any {
  if (!data || typeof data !== 'object') return data;

  const sanitized = { ...data };

  for (const field of SENSITIVE_FIELDS) {
    if (field in sanitized) {
      sanitized[field] = '***REDACTED***';
    }
  }

  return sanitized;
}

// ✅ 计算变更字段列表
function computeChangedFields(oldData: any, newData: any): string[] {
  if (!oldData || !newData) return [];

  const fields: string[] = [];
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);

  for (const key of allKeys) {
    if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
      fields.push(key);
    }
  }

  return fields;
}

// ✅ 主中间件函数
export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  // 检查是否需要跳过（前缀匹配 + 精确正则匹配）
  const shouldSkip =
    EXCLUDE_PATHS.some(path => req.path.startsWith(path)) ||
    EXCLUDE_PATH_PATTERNS.some(pattern => pattern.test(req.path));
  if (shouldSkip) return next();

  // 仅拦截写操作
  const action = METHOD_ACTION_MAP[req.method];
  if (!action) return next();

  // 备份原始res.json方法以捕获响应数据
  const originalJson = res.json.bind(res);
  let responseData: any = null;

  res.json = function (data: any) {
    responseData = data;
    return originalJson(data);
  };

  // 响应完成后异步写入审计日志
  res.on('finish', () => {
    try {
      // 仅在成功时记录（状态码2xx）
      if (res.statusCode >= 200 && res.statusCode < 300 && responseData) {
        writeAuditLog(req, res, action, responseData);
      }
    } catch (err) {
      console.error('写入审计日志失败:', err);
    }
  });

  next();
}

// ✅ 写入审计日志（异步非阻塞）
async function writeAuditLog(
  req: Request,
  res: Response,
  action: AuditAction,
  responseData: any
) {
  try {
    const entityType = extractEntityType(req.path);
    const entityId = extractEntityId(req.path);

    // 提取操作者信息（从认证中间件注入）
    const userId = (req as any).user?.id;
    const username = (req as any).user?.username;
    const userRole = (req as any).user?.role;

    // 准备变更数据
    let oldData = null;
    let newData = null;
    let changedFields = null;

    switch (action) {
      case AuditAction.CREATE:
        newData = sanitizeData(responseData.data || responseData);
        break;

      case AuditAction.UPDATE:
        newData = sanitizeData(responseData.data || responseData);
        // TODO: 可选：从数据库查询旧数据（性能考虑）
        break;

      case AuditAction.DELETE:
        // 删除操作通常不返回完整数据
        break;
    }

    // 计算变更字段
    if (oldData && newData) {
      changedFields = computeChangedFields(oldData, newData);
    }

    // 写入审计日志
    await prisma.auditLog.create({
      data: {
        action,
        entityType: entityType || 'Unknown',
        entityId,
        oldData: oldData ?? undefined,
        newData: newData ?? undefined,
        changedFields: changedFields ? JSON.stringify(changedFields) : undefined,
        userId,
        username,
        userRole,
        ipAddress: req.ip || req.headers['x-forwarded-for'] as string || undefined,
        userAgent: req.headers['user-agent'] as string || undefined,
        requestUrl: `${req.method} ${req.originalUrl}`,
        occurredAt: new Date(),
      },
    });
  } catch (err) {
    // 审计日志失败不应影响主业务流程
    console.error('审计日志写入异常:', err);
  }
}

// ✅ 手动记录审计日志（用于特殊场景）
export async function manualAuditLog(params: {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  userId?: string;
  username?: string;
  userRole?: string;
  oldData?: any;
  newData?: any;
  ipAddress?: string;
  userAgent?: string;
  requestUrl?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        ...params,
        changedFields:
          params.oldData && params.newData
            ? JSON.stringify(computeChangedFields(params.oldData, params.newData))
            : undefined,
        occurredAt: new Date(),
      },
    });
  } catch (err) {
    console.error('手动审计日志写入失败:', err);
  }
}
