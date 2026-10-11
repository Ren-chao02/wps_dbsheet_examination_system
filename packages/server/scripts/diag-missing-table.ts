/**
 * 诊断「判分未找到表」：打印最近练习记录 + 实时读目标文件当前包含哪些表。
 * 运行：cd packages/server && npx tsx scripts/diag-missing-table.ts
 */
import { prisma } from '../src/config/prisma';
import { KingsoftAdapter } from '../src/engine/adapters/kingsoft-adapter';
import { wpsConfigService } from '../src/services/wps-config-service';

async function main() {
  const records = await prisma.practiceRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true, status: true, score: true, maxScore: true, startedAt: true, submittedAt: true,
      tableSpaceId: true, details: true,
    },
  });
  console.log('最近练习记录:');
  for (const r of records) {
    console.log(JSON.stringify({
      id: r.id.slice(0, 8), status: r.status, score: r.score, maxScore: r.maxScore,
      startedAt: r.startedAt?.toISOString(), submittedAt: r.submittedAt?.toISOString(),
      // tableSpaceId 形如 `fileId:accessToken`，冒号后面是一整条可用凭据，
      // 只打印 fileId —— 这个脚本会入库，输出也常被贴进 issue。
      fileId: r.tableSpaceId?.split(':')[0],
    }));
  }

  const assignment = await prisma.practiceTableAssignment.findFirst();
  const token = await wpsConfigService.getValidAccessToken();
  if (!assignment || !token) { console.log('无练习分配或 token'); return; }
  console.log(`\n判分目标 fileId=${assignment.fileId}（实时 token）`);
  const adapter = new KingsoftAdapter(assignment.fileId, token, undefined, 'v7');
  try {
    const schema = await adapter.getSchema();
    const names = (schema.detail?.sheets || []).map((s: any) => `${s.name}(id=${s.id})`);
    console.log('当前文件包含的表:', names.length ? names.join(', ') : '(无)');
  } catch (e: any) {
    console.log('读 schema 失败:', String(e.message).slice(0, 300));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
