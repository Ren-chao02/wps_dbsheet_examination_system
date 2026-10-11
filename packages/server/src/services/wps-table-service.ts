/**
 * 考生多维表格辅助服务（考试页 / 练习页共用，只读，不参与判分）
 *
 * 背景：内嵌 iframe 能否显示表格，取决于该分享链接的权限设置与浏览器三方
 * Cookie 策略（实测：同一批分配表里，有的匿名可渲染、有的直接跳 WPS 登录页）。
 * 因此除内嵌之外还需要一条「不依赖浏览器登录态」的兜底：
 *
 *   loadTablePreview —— 用该考生表格的 accessToken 从服务端直接读取表格数据，
 *   供前端「实时数据面板」轮询渲染：学生即便在独立窗口操作表格，
 *   主页面也能看到表格当前状态。
 *
 * 读不到时前端提示即可，不影响作答与判分。
 */
import { createAdapterFromSpaceId, type KingsoftAdapter } from '../engine/adapters/kingsoft-adapter';

export interface WpsPreviewPayload {
  sheetId: number;
  sheetName: string;
  sheets: { id: number; name: string }[];
  fields: { id: string; name: string; type: string }[];
  records: { id: string; fields: Record<string, unknown> }[];
  truncated: boolean;
  syncedAt: string;
}

// 注意：TTL 从 4s 放宽到 8s 不是为了缓存偏好，而是为了控制 WPS 配额——
// 前端实时数据面板每 5 秒轮询一次，每次真实穿透 = 2 次 WPS 调用（schema + records），
// 3000 人同场时每秒就是上千次调用；TTL 过短会让穿透更密。
// 8s 能保证同一考生至少隔一个轮询周期才穿透一次。
const PREVIEW_TTL_MS = 8_000;
const PREVIEW_FAILURE_TTL_MS = 10_000; // 失败也短暂缓存：token 失效时不至于每次轮询都打两遍 WPS
const PREVIEW_PAGE_SIZE = 20;

// 缓存安全上限：几千人同场时 Map 只增不减会缓慢膨胀；写入时超过上限先清过期项，
// 仍超限则淘汰最旧项。配合下方定时清理，保证长期运行内存有界。
const PREVIEW_CACHE_MAX_ENTRIES = 1_000;
// 定期清理间隔：60 秒扫一次过期条目（unref 保证该定时器不阻止进程退出）
const PREVIEW_PRUNE_INTERVAL_MS = 60_000;

const previewCache = new Map<string, { at: number; payload: WpsPreviewPayload }>();
const previewFailureCache = new Map<string, { at: number; error: any }>();
// 同 key 并发请求去重：两个请求同时穿透时共享同一个 Promise，
// 避免「缓存未命中 + 并发轮询」对同一 key 同时打多次 WPS。
const previewInFlight = new Map<string, Promise<WpsPreviewPayload>>();

/** 清理两个缓存中的过期条目 */
function prunePreviewCaches() {
  const now = Date.now();
  for (const [k, v] of previewCache) {
    if (now - v.at >= PREVIEW_TTL_MS) previewCache.delete(k);
  }
  for (const [k, v] of previewFailureCache) {
    if (now - v.at >= PREVIEW_FAILURE_TTL_MS) previewFailureCache.delete(k);
  }
}

/** 写入成功缓存前做容量控制（先清过期项，仍超限则按插入顺序淘汰最旧项） */
function setPreviewCache(key: string, value: { at: number; payload: WpsPreviewPayload }) {
  previewCache.set(key, value);
  if (previewCache.size > PREVIEW_CACHE_MAX_ENTRIES) {
    prunePreviewCaches();
    while (previewCache.size > PREVIEW_CACHE_MAX_ENTRIES) {
      const oldestKey = previewCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      previewCache.delete(oldestKey);
    }
  }
}

// 为什么需要定时清理：Map 的 get/set 不会自动删除过期键，只靠「写入时清」不够——
// 一场考试结束后这些 key 就再也不被访问，会一直留在内存里直到进程重启。
const previewPruneTimer = setInterval(prunePreviewCaches, PREVIEW_PRUNE_INTERVAL_MS);
previewPruneTimer.unref?.();

/**
 * 读取考生表格数据（只读预览）。失败时抛错，由路由层转成可读提示；
 * 成功结果按 cacheKey 缓存 8 秒（配额控制，见上方 TTL 注释），失败结果缓存 10 秒。
 *
 * accessTokens 按顺序尝试：分配记录里的 token 是「分配时的快照」，24 小时即失效，
 * 因此调用方应把系统当前（自动刷新）的 token 排在前面，快照 token 作为兜底 ——
 * 与阅卷读取表格的取用口径保持一致。
 */
export async function loadTablePreview(options: {
  cacheKey: string;
  fileId: string;
  accessTokens: (string | null | undefined)[];
  sheetId?: string;
}): Promise<WpsPreviewPayload> {
  const { cacheKey, fileId, accessTokens, sheetId = '' } = options;
  const key = `${cacheKey}:${sheetId}`;

  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.at < PREVIEW_TTL_MS) return cached.payload;

  const recentFailure = previewFailureCache.get(key);
  if (recentFailure && Date.now() - recentFailure.at < PREVIEW_FAILURE_TTL_MS) {
    throw recentFailure.error;
  }

  // 并发去重：同 key 正在加载时复用同一个 Promise（并发轮询/多副本部署只穿透一次）
  const existing = previewInFlight.get(key);
  if (existing) return existing;

  const task = loadPreviewUncached(key, fileId, accessTokens, sheetId).finally(() => {
    // 无论成败都从 in-flight 表中移除，让后续请求可重新发起
    previewInFlight.delete(key);
  });
  previewInFlight.set(key, task);
  return task;
}

/** 真正穿透 WPS 的加载逻辑（缓存与 in-flight 判断之外的旧主体） */
async function loadPreviewUncached(
  key: string,
  fileId: string,
  accessTokens: (string | null | undefined)[],
  sheetId: string,
): Promise<WpsPreviewPayload> {
  const tokens = accessTokens.filter((t): t is string => !!t);
  const candidates: (string | null)[] = tokens.length > 0 ? tokens : [null]; // 无 token 时回退环境变量凭据

  let lastError: any = Object.assign(new Error('WPS 凭据未配置或已失效，请联系教师'), {
    statusCode: 503,
  });

  for (const token of candidates) {
    const adapter = createAdapterFromSpaceId(token ? `${fileId}:${token}` : fileId);
    if (!adapter) continue;
    try {
      const payload = await fetchPreviewWithAdapter(adapter, sheetId);
      setPreviewCache(key, { at: Date.now(), payload });
      return payload;
    } catch (err) {
      lastError = err;
    }
  }

  previewFailureCache.set(key, { at: Date.now(), error: lastError });
  throw lastError;
}

async function fetchPreviewWithAdapter(
  adapter: KingsoftAdapter,
  sheetId: string,
): Promise<WpsPreviewPayload> {
  const schema = await adapter.getSchema();
  const sheets = schema.detail?.sheets || [];
  if (sheets.length === 0) {
    throw Object.assign(new Error('表格中暂无数据表'), { statusCode: 502 });
  }

  const target = sheets.find((s) => String(s.id) === sheetId) || sheets[0];
  // maxPages: 1 —— 预览只需要第一页来展示 + 判断 truncated（pageSize+1 多取一条），
  // 不需要整表翻页拉取：那会把一次预览放大成多次 WPS 调用，加剧配额消耗
  const list = await adapter.getRecords(target.id, { pageSize: PREVIEW_PAGE_SIZE + 1, maxPages: 1 });
  const allRecords = list.detail?.records || [];

  const fields =
    list.detail?.fieldsSchema?.length > 0
      ? list.detail.fieldsSchema
      : target.fields.map((f) => ({ id: f.id, name: f.name, type: f.type }));

  return {
    sheetId: target.id,
    sheetName: target.name,
    sheets: sheets.map((s) => ({ id: s.id, name: s.name })),
    fields,
    records: allRecords.slice(0, PREVIEW_PAGE_SIZE),
    truncated: allRecords.length > PREVIEW_PAGE_SIZE,
    syncedAt: new Date().toISOString(),
  };
}
