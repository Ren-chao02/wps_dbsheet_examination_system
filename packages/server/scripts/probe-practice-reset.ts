/**
 * 只读探测：练习/考试表格分配使用的 fileId + token 究竟哪种鉴权组合可用。
 * 仅调用 schema/query（只读），用于诊断「练习文件重置失败」。
 * 运行：cd packages/server && npx tsx scripts/probe-practice-reset.ts
 */
import { prisma } from '../src/config/prisma';
import { KingsoftAdapter } from '../src/engine/adapters/kingsoft-adapter';
import { config } from '../src/config';
import { wpsConfigService } from '../src/services/wps-config-service';

async function tryGet(label: string, fileId: string, adapter: KingsoftAdapter) {
  const started = Date.now();
  try {
    const s = await adapter.getSchema();
    console.log(`[OK ${Date.now() - started}ms] ${label} sheets=${(s.detail?.sheets || []).length}`);
  } catch (e: any) {
    console.log(`[ERR ${Date.now() - started}ms] ${label}: ${String(e.message || e).slice(0, 400)}`);
  }
}

async function main() {
  const cfg = await prisma.wpsConfig.findUnique({ where: { id: 'wps_config' } });
  // 只打印"有没有"，不打印凭据片段：这个脚本会入库，任何人都可能把输出贴进 issue
  console.log('wps_config:', cfg ? {
    hasAccessToken: !!cfg.accessToken,
    accessTokenLength: cfg.accessToken?.length ?? 0,
    hasRefreshToken: !!cfg.refreshToken,
    expiresAt: cfg.expiresAt ? new Date(Number(cfg.expiresAt)).toISOString() : null,
  } : null);

  const rows = await prisma.practiceTableAssignment.findMany();
  console.log(`practice assignments: ${rows.length}`);
  for (const r of rows) {
    console.log(`--- practice fileId=${r.fileId} shareUrl=${(r.shareUrl || '').slice(0, 70)} token=${r.accessToken ? '有快照' : '(none)'}`);
    await tryGet('v3 storedToken', r.fileId, new KingsoftAdapter(r.fileId, r.accessToken || '', undefined, 'v3'));
    await tryGet('v3 envAK-key', r.fileId, new KingsoftAdapter(r.fileId, config.kingsoft.apiKey, undefined, 'v3'));
    await tryGet('v7 storedToken(快照)', r.fileId, new KingsoftAdapter(r.fileId, r.accessToken || '', undefined, 'v7'));
    const liveToken = await wpsConfigService.getValidAccessToken();
    await tryGet('v7 liveToken(实时/自动刷新)', r.fileId, new KingsoftAdapter(r.fileId, liveToken || '', undefined, 'v7'));
    await tryGet('v7 envAK-key', r.fileId, new KingsoftAdapter(r.fileId, config.kingsoft.apiKey, undefined, 'v7'));
  }

  const ex = await prisma.examTableAssignment.findMany({ orderBy: { assignedAt: 'desc' }, take: 3 });
  console.log(`exam assignments sample: ${ex.length}`);
  for (const r of ex) {
    console.log(`--- exam fileId=${r.fileId} token=${r.accessToken ? '有快照' : '(none)'}`);
    await tryGet('exam v7 storedToken', r.fileId, new KingsoftAdapter(r.fileId, r.accessToken || '', undefined, 'v7'));
    await tryGet('exam v3 storedToken', r.fileId, new KingsoftAdapter(r.fileId, r.accessToken || '', undefined, 'v3'));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
