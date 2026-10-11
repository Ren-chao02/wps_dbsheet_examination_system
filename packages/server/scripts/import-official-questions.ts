/**
 * 官方题库 Excel 导入（单选 / 多选 / 判断）
 *
 * 用法（在 packages/server 目录下执行）：
 *   npx tsx scripts/import-official-questions.ts                # 试运行：只解析、校验、打印差异，不写库
 *   npx tsx scripts/import-official-questions.ts --commit       # 实际写入（先整体清掉 official 再写入）
 *   npx tsx scripts/import-official-questions.ts --commit a.xlsx b.xlsx   # 指定文件（默认仓库根目录两份）
 *
 * 行为说明：
 * - 解析「单项选择题 / 多项选择题 / 判断题」，OLAP 表是判断题格式（√/×）按判断题收；
 *   公式简答、综合实操不含在内（客观题导入范围由用户指定）。
 * - 题目文本统一中性化「飞书」字样（见 src/utils/official-question-import.ts 的 neutralizeBrand）。
 * - 落库为 source='official'、status=published；--commit 采用整体替换（官方题库完全由本脚本托管），
 *   重复执行结果一致（幂等）。
 * - 试运行会打印全部品牌词替换对照与解析失败明细，确认无误后再 --commit。
 */
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import {
  buildOfficialQuestion,
  parseSingleChoiceAnswer,
  parseMultipleChoiceAnswer,
  parseTrueFalseAnswer,
  neutralizeBrand,
  type ObjectiveType,
} from '../src/utils/official-question-import';

const prisma = new PrismaClient();

const DEFAULT_FILES = [
  path.join(__dirname, '../../../多维表格考试题库.xlsx'),
  path.join(__dirname, '../../../飞书多维表格技能认证_考试题库.xlsx'),
];

/** 工作表名 → 题型（其余工作表不在导入范围） */
const SHEET_TYPE: Record<string, ObjectiveType> = {
  单项选择题: 'single_choice',
  多项选择题: 'multiple_choice',
  判断题: 'true_false',
  OLAP多维分析理论题: 'true_false',
};

const TYPE_LABELS: Record<ObjectiveType, string> = {
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
};

const TRUE_FALSE_OPTIONS = [
  { key: 'A', text: '正确' },
  { key: 'B', text: '错误' },
];

interface ParsedRow {
  file: string;
  sheet: string;
  rowNo: number;
  payload: ReturnType<typeof buildOfficialQuestion>;
}

/** 收集一行的选项：列名形如 选项A/选项B/…（按字母序） */
function collectOptions(row: Record<string, unknown>): Array<{ key: string; text: string }> {
  return Object.keys(row)
    .map((k) => (/^选项([A-Z])$/.exec(k) ? { key: RegExp.$1, text: String(row[k] ?? '') } : null))
    .filter((o): o is { key: string; text: string } => o !== null && o.text.trim().length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function parseRow(type: ObjectiveType, row: Record<string, unknown>) {
  const stem = String(row['题目'] ?? '');
  const analysis = row['解析'] !== undefined ? String(row['解析']) : null;
  const knowledgePoint = row['知识点'] !== undefined ? String(row['知识点']) : null;

  if (type === 'true_false') {
    return buildOfficialQuestion({
      type, stem, options: TRUE_FALSE_OPTIONS,
      correct: [parseTrueFalseAnswer(String(row['答案'] ?? ''))],
      analysis, knowledgePoint,
    });
  }
  if (type === 'single_choice') {
    return buildOfficialQuestion({
      type, stem, options: collectOptions(row),
      correct: [parseSingleChoiceAnswer(String(row['答案'] ?? ''))],
      analysis, knowledgePoint,
    });
  }
  return buildOfficialQuestion({
    type, stem, options: collectOptions(row),
    correct: parseMultipleChoiceAnswer(String(row['答案'] ?? '')),
    analysis, knowledgePoint,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const files = args.filter((a) => !a.startsWith('--'));
  const fileList = files.length > 0 ? files : DEFAULT_FILES;

  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const brandChanges = new Map<string, string>(); // 原文 → 新文（去重打印）
  const tfAnswers = new Set<string>();           // 判断题原始答案写法收集

  for (const file of fileList) {
    if (!XLSX.readFile) throw new Error('xlsx 未加载');
    const wb = XLSX.readFile(file);
    console.log(`\n📖 ${path.basename(file)}：${wb.SheetNames.join(' / ')}`);
    for (const sheetName of wb.SheetNames) {
      const type = SHEET_TYPE[sheetName];
      if (!type) continue;
      const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
      let ok = 0;
      sheet.forEach((row, idx) => {
        const rowNo = idx + 2; // 含表头
        try {
          if (type === 'true_false') tfAnswers.add(String(row['答案'] ?? '').trim());
          const payload = parseRow(type, row);
          // 记录品牌词替换（打印对照供人工复核）
          for (const text of [String(row['题目'] ?? ''), String(row['解析'] ?? ''), ...(payload.tags ?? [])]) {
            const after = neutralizeBrand(text);
            if (text && text !== after) brandChanges.set(text, after);
          }
          rows.push({ file: path.basename(file), sheet: sheetName, rowNo, payload });
          ok += 1;
        } catch (e: any) {
          errors.push(`[${path.basename(file)} · ${sheetName} · 第 ${rowNo} 行] ${e.message}`);
        }
      });
      console.log(`   ${sheetName}: ${sheet.length} 行 → 解析成功 ${ok}`);
    }
  }

  // 同卷去重：同题型 + 同题干只留第一条（两道完全相同的题对考试没有意义）
  const seen = new Map<string, ParsedRow>();
  const duplicates: string[] = [];
  for (const r of rows) {
    const key = `${r.payload.type}::${r.payload.title}`;
    if (seen.has(key)) duplicates.push(`${r.payload.title.slice(0, 40)}（${r.file}·${r.sheet}）`);
    else seen.set(key, r);
  }
  const unique = Array.from(seen.values());

  const byType = unique.reduce((acc, r) => {
    acc[r.payload.type] = (acc[r.payload.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('\n==================== 解析汇总 ====================');
  console.log(`解析成功 ${rows.length} 条，去重后 ${unique.length} 条：` +
    Object.entries(byType).map(([t, n]) => `${TYPE_LABELS[t as ObjectiveType]} ${n}`).join('，'));
  if (duplicates.length > 0) {
    console.log(`\n⚠️ 重复题干 ${duplicates.length} 条（已去重保留第一条）：`);
    duplicates.forEach((d) => console.log('   -', d));
  }
  if (tfAnswers.size > 0) {
    console.log(`\n判断题答案写法：${Array.from(tfAnswers).map((a) => `"${a}"`).join('、')}`);
  }
  if (brandChanges.size > 0) {
    console.log(`\n品牌词替换 ${brandChanges.size} 处（原文 → 新文）：`);
    for (const [before, after] of brandChanges) {
      console.log(`   - ${before.slice(0, 60)}  →  ${after.slice(0, 60)}`);
    }
  }
  if (errors.length > 0) {
    console.log(`\n❌ 解析失败 ${errors.length} 条：`);
    errors.forEach((e) => console.log('   -', e));
  }

  if (!commit) {
    console.log('\n（试运行模式，未写库。确认无误后加 --commit 重新执行）');
    return;
  }
  if (errors.length > 0) {
    console.log('\n❌ 存在解析失败的行，已中止写入（请先修正数据或调整解析）');
    process.exitCode = 1;
    return;
  }
  if (unique.length < 100) {
    console.log(`\n❌ 解析数量异常（${unique.length} 条），为防误清官方题库已中止写入`);
    process.exitCode = 1;
    return;
  }

  const { deleted, created } = await prisma.$transaction(async (tx) => {
    const del = await tx.question.deleteMany({ where: { source: 'official' } });
    const ins = await tx.question.createMany({ data: unique.map((r) => r.payload as any) });
    return { deleted: del.count, created: ins.count };
  });
  console.log(`\n✅ 写入完成：清除旧官方题 ${deleted} 条，新增 ${created} 条`);
}

main()
  .catch((e) => {
    console.error('导入失败：', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
