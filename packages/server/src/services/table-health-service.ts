import { createAdapterFromSpaceId } from '../engine/adapters/kingsoft-adapter';
import { wpsConfigService } from './wps-config-service';
import { logger } from '../utils/logger';

/**
 * 表格可用性检查
 *
 * ── 为什么需要 ──
 * 分配表格时，系统此前**从不验证这个链接指向的文档还活着**：老师贴一个已删除、
 * 或分享已被撤销的链接，会看到「分配保存成功」；然后学生坐到考场上，右侧 iframe
 * 里显示的是「文档已删除」，做不了题。更糟的是判分时也读不到表格，答卷会一直
 * 卡在「已交卷」判不出分。
 *
 * 这不是假设：2026-10-13 在真实库里查到一份失效表格（`cuqJOJ0WNPQd`，接口 403、
 * iframe 显示「文档已删除」）被 3 场考试引用着，卡住了 3 份答卷。
 *
 * ── 为什么用「读一次 Schema」来判定 ──
 * 学生看到的是 iframe 里的 kdocs 分享页，而系统判分读的是开放平台接口 —— 两者
 * 不是同一条链路。但实测三个真实文件，两条链路的结果完全一致：
 *   接口能读 ⇒ iframe 能渲染；接口 403 ⇒ iframe 显示「文档已删除」。
 * 所以这里以接口可读性作为代理指标，它同时也是判分链路本身的前提。
 *
 * 注意：**不能**用「匿名请求分享链接返回什么」来判断 —— 分享链接对匿名访客
 * 总是 302 到 passport（静默登录的一部分），真实浏览器执行 JS 后会回到文档。
 * 拿 curl 的 302 去判定会误杀所有正常表格。
 */

export interface TableCheckFailure {
  fileId: string;
  reason: string;
}

export interface TableCheckResult {
  /** 确认可读 */
  ok: string[];
  /** 确认不可读（应阻止保存） */
  failed: TableCheckFailure[];
  /** 时间预算内没来得及检查的（只可能出现在超大批量，此时放行但提示） */
  unchecked: string[];
}

/** 把外部错误翻成一句人能看懂、且能指导下一步的话 */
function describeError(err: unknown): string {
  const msg = String((err as Error)?.message || err || '未知错误');
  if (/403|permission|forbidden/i.test(msg)) return '文档已被删除，或应用没有该文档的访问权限';
  if (/404|not.?found/i.test(msg)) return '文档不存在（可能已被删除或链接已失效）';
  if (/超时|timeout|ETIMEDOUT|aborted/i.test(msg)) return 'WPS 接口超时';
  if (/401|invalid_token|token/i.test(msg)) return 'WPS 凭据失效，请在管理页重新配置';
  return msg.slice(0, 200);
}

async function checkOne(fileId: string, accessToken?: string): Promise<TableCheckFailure | null> {
  // ⚠️ 顺序不能反：WpsConfig 里的**实时** token 优先，分配时带的快照 token 只作兜底。
  // 快照 token 24 小时就失效（见 CLAUDE.md），拿它去查会把正常表格误判成"已删除" ——
  // 我第一版就写反了，实测时把一个本来好好的文件报成了失效。
  // 判分走的是同一条实时 token 路径，所以这样检查才和判分看到的一致。
  const liveToken =
    (await wpsConfigService.getValidAccessToken().catch(() => null)) || accessToken;
  const adapter = createAdapterFromSpaceId(liveToken ? `${fileId}:${liveToken}` : fileId);
  if (!adapter) {
    return { fileId, reason: '无法构造 WPS 适配器（缺少可用凭据，请先在管理页配置 WPS Token）' };
  }
  try {
    const schema = await adapter.getSchema();
    if (!schema?.detail || !Array.isArray(schema.detail.sheets)) {
      return { fileId, reason: '接口未返回表格结构（文档可能不是多维表格）' };
    }
    return null;
  } catch (err) {
    return { fileId, reason: describeError(err) };
  }
}

/**
 * 并发检查一批表格是否可读。
 *
 * 并发上限是为了不把 WPS 平台打限流（项目里 GRADING_CONCURRENCY 也是同样的考虑）；
 * 时间预算是为了让"一次分配上千个表格"这种极端情况不至于把请求挂死 ——
 * 超预算的会被列为 unchecked，由调用方决定放行并提示。
 */
export async function checkTablesReadable(
  targets: { fileId: string; accessToken?: string }[],
  options: { concurrency?: number; budgetMs?: number } = {},
): Promise<TableCheckResult> {
  const { concurrency = 8, budgetMs = 30_000 } = options;

  // 同一个 fileId 只查一次（批量分配时学生往往共用少量文件）
  const unique = new Map<string, string | undefined>();
  for (const t of targets) if (!unique.has(t.fileId)) unique.set(t.fileId, t.accessToken);
  const entries = [...unique.entries()];

  const result: TableCheckResult = { ok: [], failed: [], unchecked: [] };
  const deadline = Date.now() + budgetMs;

  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      if (Date.now() > deadline) return; // 剩余的在下面统一标为 unchecked
      const [fileId, token] = entries[cursor++];
      const failure = await checkOne(fileId, token);
      if (failure) {
        result.failed.push(failure);
        logger.warn({ fileId, reason: failure.reason }, '[table-health] 表格不可读');
      } else {
        result.ok.push(fileId);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));

  const seen = new Set([...result.ok, ...result.failed.map(f => f.fileId)]);
  for (const [fileId] of entries) if (!seen.has(fileId)) result.unchecked.push(fileId);

  return result;
}
