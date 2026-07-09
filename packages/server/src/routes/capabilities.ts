import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import {
  CAPABILITY_GRAPH,
  ALL_DOMAINS,
  DOMAIN_LABELS,
  capabilitiesByDomain,
  type CapabilityDomain,
} from '../data/capability-graph';

export const capabilityRouter = Router();

// 能力图谱是出题辅助工具，仅教师/管理员可访问
capabilityRouter.use(authenticate);
capabilityRouter.use(authorize('teacher', 'admin'));

// 合法域集合，用于 :domain 参数校验
const VALID_DOMAINS = new Set<string>(ALL_DOMAINS);

/**
 * GET /api/capabilities
 * 返回完整能力图谱（66 项，6 域）
 *
 * 响应：
 * {
 *   data: {
 *     domains: [{ id, label, count }],
 *     capabilities: Capability[]
 *   },
 *   total: 66
 * }
 */
capabilityRouter.get('/', (_req: Request, res: Response) => {
  const domains = ALL_DOMAINS.map(id => ({
    id,
    label: DOMAIN_LABELS[id],
    count: capabilitiesByDomain(id).length,
  }));

  res.json({
    data: {
      domains,
      capabilities: CAPABILITY_GRAPH,
    },
    total: CAPABILITY_GRAPH.length,
  });
});

/**
 * GET /api/capabilities/:domain
 * 按域查询能力列表
 *
 * 路径参数：
 * - domain: tables | fields | field_props | views | forms | records
 */
capabilityRouter.get('/:domain', (req: Request, res: Response) => {
  const domain = req.params.domain as CapabilityDomain;

  if (!VALID_DOMAINS.has(domain)) {
    return res.status(400).json({
      message: `无效的域「${domain}」，合法值为：${ALL_DOMAINS.join(', ')}`,
      validDomains: ALL_DOMAINS,
    });
  }

  const capabilities = capabilitiesByDomain(domain);
  res.json({
    data: {
      domain,
      label: DOMAIN_LABELS[domain],
      capabilities,
    },
    total: capabilities.length,
  });
});
