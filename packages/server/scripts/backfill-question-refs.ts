/**
 * 回填题目前置契约（schemaRefs）与场景链（scenario/scenarioOrder）。
 *
 * 用法（在 packages/server 下执行）：
 *   npx tsx scripts/backfill-question-refs.ts              # dry-run：只打印 + 导出清单
 *   npx tsx scripts/backfill-question-refs.ts --apply      # 写库（只填 scenario 为空的题）
 *   npx tsx scripts/backfill-question-refs.ts --apply --force   # 连已有 scenario 一起覆盖
 *
 * 幂等：默认只处理 scenario 为 NULL 的题；--force 才会覆盖（教师改过的场景名要保住）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/config/prisma';
import { buildBackfillPlan } from '../src/services/question-refs-backfill';

/** 练习支持的实操题型（与 routes/practice.ts 的 PRACTICE_QUESTION_TYPES 一致） */
const HANDS_ON_TYPES = ['create_table', 'add_field', 'config_view', 'create_form', 'comprehensive'] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const questions = await prisma.question.findMany({
    where: { type: { in: HANDS_ON_TYPES as unknown as any } },
    // description 必须取：推导器要用题面判断 check_table_exists 是"真建表"还是"前置检查"
    select: { id: true, title: true, description: true, answerRules: true, scenario: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = force ? questions : questions.filter(q => q.scenario === null);
  console.log(`实操题 ${questions.length} 道；本次处理 ${targets.length} 道（${force ? '--force 覆盖模式' : '只填空场景'}）`);

  const plan = buildBackfillPlan(targets.map(q => ({ id: q.id, title: q.title, description: q.description, answerRules: q.answerRules })));

  console.log('\n=== 场景（自动归链结果）===');
  for (const s of plan.scenarios) console.log(`  ${s.key}：${s.questionCount} 题`);
  console.log(`\n自动填充 ${plan.autoCount} 道；待人工确认 ${plan.pendingCount} 道`);

  const pending = plan.entries.filter(e => e.pendingReason);
  if (pending.length > 0) {
    console.log('\n=== 待人工确认 ===');
    for (const e of pending) console.log(`  [${e.id.slice(0, 8)}] ${e.title} —— ${e.pendingReason}`);
  }

  // 清单落盘：docs/ 不入库，供教师按清单在题库页逐条改
  const date = new Date().toISOString().slice(0, 10);
  const outPath = resolve(__dirname, `../../../docs/backfill-question-refs-${date}.md`);
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  const md = [
    `# 题目前置契约 + 场景链回填清单（${date}）`,
    '',
    `- 处理范围：${targets.length} 道实操题（${force ? '--force 覆盖' : '只填空场景'}）`,
    `- 自动填充：${plan.autoCount} 道；待人工确认：${plan.pendingCount} 道`,
    '',
    '## 场景',
    ...plan.scenarios.map(s => `- ${s.key}：${s.questionCount} 题`),
    '',
    '## 待人工确认（左：题目标题；右：原因）',
    ...pending.map(e => `- ${e.title} —— ${e.pendingReason}`),
    '',
    '## 明细',
    ...plan.entries.map(e => `- [${e.scenario ?? '（待定）'} ${e.scenarioOrder ?? '-'}] ${e.title}`),
  ].join('\n');
  writeFileSync(outPath, md, 'utf8');
  console.log(`\n清单已写入：${outPath}`);

  if (!apply) {
    console.log('\n（dry-run，未写库；确认无误后加 --apply 重跑）');
    return;
  }

  let written = 0;
  for (const e of plan.entries) {
    await prisma.question.update({
      where: { id: e.id },
      data: {
        schemaRefs: e.refs as any,
        // 待人工确认一律显式清空：Prisma 对"字段缺省"不会清空旧值，
        // 首轮误挂的链名会残留在库里（--force 重跑时暴露）。教师手工值不受影响——
        // 默认路径只处理 scenario IS NULL 的题，--force 的语义本就是覆盖。
        ...(e.scenario && !e.pendingReason
          ? { scenario: e.scenario, scenarioOrder: e.scenarioOrder }
          : { scenario: null, scenarioOrder: null }),
      },
    });
    written += 1;
  }
  console.log(`\n已写库 ${written} 道`);
}

main()
  .catch(err => { console.error('回填失败：', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
