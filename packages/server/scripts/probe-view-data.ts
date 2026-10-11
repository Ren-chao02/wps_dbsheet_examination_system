/**
 * 只读探测：WPS `/schema/query` 到底返回了哪些视图/字段配置。
 *
 * 存在的理由（一个至今没定论的问题）：
 * 规则引擎里有 3 条规则依赖视图的 `filter`(筛选) / `sort`(排序) / `group`(分组)，
 * 但实测抓到的视图对象只有 `id / name / type / fields_attribute` ——
 * 没有 filter/sort/group，官方 API 文档也只列了 id/name/type。
 * 如果确实不返回，这 3 条规则会对**每个学生**都判不通过（做对了也 0 分），
 * 而且不会有任何提示，直到有学生来申诉。
 *
 * 怎么用它做结论性验证：
 *   1. 在任意一张测试表里，给某个视图**加上一个筛选条件**（WPS 界面点两下，30 秒）；
 *   2. 跑这个脚本；
 *   3. 看该视图的原始对象里有没有冒出 `filter` 键：
 *      - 有 → 接口会返回，那 3 条规则是好的，之前只是恰好没配筛选；
 *      - 没有 → 数据根本到不了引擎，这 3 条规则需要改成"转人工复核"或换数据源。
 *
 * 运行：cd packages/server && npx tsx scripts/probe-view-data.ts
 */
import { prisma } from '../src/config/prisma';
import { KingsoftAdapter } from '../src/engine/adapters/kingsoft-adapter';
import { wpsConfigService } from '../src/services/wps-config-service';

async function main() {
  const token = await wpsConfigService.getValidAccessToken();
  if (!token) {
    console.log('WpsConfig 里没有可用 token，先在管理页配置 WPS 凭据');
    return;
  }

  // 收集所有被分配过的文件，尽量多覆盖
  const fileIds = new Set<string>();
  for (const a of await prisma.examTableAssignment.findMany({ select: { fileId: true }, take: 8 })) fileIds.add(a.fileId);
  for (const a of await prisma.practiceTableAssignment.findMany({ select: { fileId: true }, take: 8 })) fileIds.add(a.fileId);

  if (fileIds.size === 0) {
    console.log('库里没有任何表格分配记录');
    return;
  }
  console.log(`待检查文件: ${fileIds.size} 个\n`);

  let viewTotal = 0, withFilter = 0, withSort = 0, withGroup = 0, withAttr = 0;
  const fieldTopKeys = new Set<string>();
  const fieldDataKeys = new Set<string>();

  for (const fileId of fileIds) {
    try {
      const adapter: any = new KingsoftAdapter(fileId, token, undefined, 'v7');
      // 故意用未归一化的原始响应：适配器的映射会把空值吞成 undefined，
      // 分不清「键不存在」和「键存在但为空」。
      const raw = await adapter.requestV7('/schema/query', {});
      const sheets = (raw.data || raw.detail || raw).sheets || [];

      for (const sheet of sheets) {
        for (const f of sheet.fields || []) {
          Object.keys(f).forEach(k => fieldTopKeys.add(k));
          Object.keys(f.data || {}).forEach(k => fieldDataKeys.add('data.' + k));
        }
        for (const v of sheet.views || []) {
          viewTotal++;
          if (v.filter) withFilter++;
          if (v.sort) withSort++;
          if (v.group) withGroup++;
          if (v.fields_attribute) withAttr++;
          console.log(`[${fileId}] 表「${sheet.name}」视图「${v.name}」`);
          console.log(`   原始对象: ${JSON.stringify(v).slice(0, 300)}`);
        }
      }
    } catch (e: any) {
      // 读不到的文件本身就是问题：它对应的答卷判分时会失败
      console.log(`[${fileId}] ✗ 读取失败: ${String(e.message).slice(0, 120)}`);
    }
  }

  console.log(`\n合计 ${viewTotal} 个视图：filter ${withFilter}、sort ${withSort}、group ${withGroup}、fields_attribute ${withAttr}`);
  console.log(`字段顶层键: ${[...fieldTopKeys].join(', ')}`);
  console.log(`字段 data 键: ${[...fieldDataKeys].join(', ')}`);
  console.log('\n（字段配置在 data 里 —— check_field_required 曾因为只看顶层 f.required 而永远判不过）');

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
