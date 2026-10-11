/**
 * 只读探测：WPS `/schema/query` 到底返回了哪些视图/字段配置。
 *
 * ── 已结论（2026-10-11，在真实表格上验证）──
 * 在 WPS 界面上手动配好「筛选 + 排序 + 分组」之后，接口返回的视图对象是：
 *
 *   { id, name, type, records_count,
 *     sort:  { auto_sort: true, conditions: [{ field, is_ascending }] },   ← 有
 *     group: { conditions: [{ field, is_ascending }] },                    ← 有
 *     fields_attribute: [{ field, hidden }] }                              ← 有
 *                                                                          ← filter 没有
 *
 * 也就是说：**filter（筛选条件）配了也不返回**，递归扫所有键名都找不到。
 * 后果是「验证视图筛选条件」那条规则永远拿不到数据 —— 已改成转人工复核，
 * 见 rule-engine.ts 里 check_view_filter 上方的注释。
 *
 * 字段那边同理：配置全部在 `data` 里（unique_value / formula / number_format /
 * default_value / default_value_type），顶层只有 name/type/id/data。
 *
 * ── 这个脚本留着做什么 ──
 * 1. 接口升级后重跑，确认 filter 有没有被补上 —— 一旦补上，check_view_filter
 *    会自动恢复自动判定（代码里做成了前置守卫，不是写死转人工）；
 * 2. 排查"学生明明配了却判错"这类问题时，一眼看到接口到底给了什么。
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
