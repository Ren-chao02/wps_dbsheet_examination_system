/**
 * 种子数据脚本
 * 从 seed-data/dump.json 导入全部预置数据（账号、角色、分类、题库、试卷、考试、答卷示例）。
 * dump.json 由 export-seed.ts 从现有数据库导出生成。
 *
 * 用法：
 *   重新导出数据：npx tsx prisma/export-seed.ts
 *   执行导入：    npx tsx prisma/seed.ts  （或 npm run db:seed）
 */
import { PrismaClient, Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// 读取导出的数据
function loadDump(): Record<string, any[]> {
  const dumpPath = path.resolve(__dirname, 'seed-data/dump.json');
  if (!fs.existsSync(dumpPath)) {
    console.error('❌ 未找到 seed-data/dump.json，请先运行 export-seed.ts 导出数据');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(dumpPath, 'utf-8'));
}

// 分类按层级排序，保证父分类先插入（处理自引用树）
function sortCategoriesByLevel(categories: any[]): any[] {
  return [...categories].sort((a, b) => (a.level ?? 1) - (b.level ?? 1));
}

async function clearDatabase() {
  console.log('🧹 清空现有数据...');
  // 用 TRUNCATE ... CASCADE 彻底清理所有业务表（保留迁移历史表）
  // @ts-ignore Prisma 命名空间
  const models = Prisma.dmmf.datamodel.models;
  const tables = models
    .map((m: any) => `"${m.dbName || m.name}"`)
    .filter((t: string) => t !== '"_prisma_migrations"')
    .join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

async function seedAll(data: Record<string, any[]>) {
  // 1. 基础引用表
  console.log('🔧 创建院系/专业/班级...');
  for (const row of data.department ?? []) {
    await prisma.department.create({ data: row });
  }
  for (const row of data.major ?? []) {
    await prisma.major.create({ data: row });
  }
  for (const row of data.classRoom ?? []) {
    await prisma.classRoom.create({ data: row });
  }

  console.log('🔧 创建系统角色与权限...');
  for (const row of data.systemRole ?? []) {
    await prisma.systemRole.create({ data: row });
  }
  for (const row of data.systemRolePermission ?? []) {
    await prisma.systemRolePermission.create({ data: row });
  }

  // 2. 分类（父分类在前）
  console.log('📂 创建题目分类...');
  const sortedCategories = sortCategoriesByLevel(data.questionCategory ?? []);
  for (const row of sortedCategories) {
    await prisma.questionCategory.create({ data: row });
  }

  // 3. 用户
  console.log('👤 创建用户...');
  for (const row of data.user ?? []) {
    await prisma.user.create({ data: row });
  }

  // 4. 题库
  console.log('📝 创建题目...');
  for (const row of data.question ?? []) {
    await prisma.question.create({ data: row });
  }

  // 5. 试卷
  console.log('📄 创建试卷...');
  for (const row of data.paper ?? []) {
    await prisma.paper.create({ data: row });
  }
  for (const row of data.paperQuestion ?? []) {
    await prisma.paperQuestion.create({ data: row });
  }

  // 6. 考试（批次/考场在考试前）
  console.log('📋 创建批次与考场...');
  for (const row of data.examBatch ?? []) {
    await prisma.examBatch.create({ data: row });
  }
  for (const row of data.examRoom ?? []) {
    await prisma.examRoom.create({ data: row });
  }

  console.log('📋 创建考试...');
  for (const row of data.exam ?? []) {
    await prisma.exam.create({ data: row });
  }
  for (const row of data.examQuestion ?? []) {
    await prisma.examQuestion.create({ data: row });
  }

  // 7. 答卷示例
  console.log('📊 创建答卷示例...');
  for (const row of data.studentSubmission ?? []) {
    await prisma.studentSubmission.create({ data: row });
  }
  for (const row of data.submissionDetail ?? []) {
    await prisma.submissionDetail.create({ data: row });
  }
}

async function main() {
  console.log('🌱 开始填充种子数据...');
  const data = loadDump();
  await clearDatabase();
  await seedAll(data);

  console.log('');
  console.log('📋 种子数据完成！');
  console.log('  预置账号:');
  for (const u of data.user ?? []) {
    console.log(`    ${u.username} / 123456`);
  }
  console.log(`  题目: ${data.question?.length ?? 0} 道`);
  console.log(`  考试: ${data.exam?.length ?? 0} 场`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
