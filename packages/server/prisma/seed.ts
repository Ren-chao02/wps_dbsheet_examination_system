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
import { randomBytes } from 'crypto';
import { hashPassword } from '../src/services/password-hash';

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

/**
 * 安全闸门：种子脚本会 TRUNCATE 全部业务表，在已有数据的库上运行 = 清库。
 *
 * 触发过的事故场景：运维在已上线的服务器上为了"补一下预置数据"跑 `npm run db:seed`，
 * 全校账号、题库、成绩瞬间清空。因此默认只允许在**空库**上执行，
 * 确实要重置时显式加 `--force`（或 SEED_FORCE=1）。
 */
async function assertSafeToSeed() {
  const userCount = await prisma.user.count();
  const force = process.argv.includes('--force') || process.env.SEED_FORCE === '1';
  if (userCount > 0 && !force) {
    console.error(
      `\n❌ 数据库中已有 ${userCount} 个用户，种子脚本会清空全部业务数据，已中止。\n` +
      '   确需重置（仅限测试/全新环境）请显式执行：npm run db:seed -- --force\n',
    );
    process.exit(1);
  }
  if (userCount > 0) {
    console.warn(`⚠️  已确认 --force：即将清空现有 ${userCount} 个用户及其全部关联数据`);
  }
}

/**
 * 初始管理员口令。
 *
 * 历史行为是全部预置账号统一 123456 —— 迁移到校园网后，任何学生用
 * admin/123456 就能登录后台。因此：
 *   - 优先取环境变量 ADMIN_INITIAL_PASSWORD（部署时由运维指定）；
 *   - 未指定则生成随机口令，并在导入完成后**打印一次**。
 * 仅对 admin/teacher 账号生效；种子里的学生演示账号保持原样（仅供演示环境）。
 */
function resolveAdminPassword(): { password: string; generated: boolean } {
  const fromEnv = (process.env.ADMIN_INITIAL_PASSWORD || '').trim();
  if (fromEnv) return { password: fromEnv, generated: false };
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return { password: out, generated: true };
}

async function main() {
  console.log('🌱 开始填充种子数据...');
  await assertSafeToSeed();
  const data = loadDump();

  // 管理员/教师账号改用强口令（学生演示账号保持原样，部署后请自行清理）
  const { password: adminPassword, generated } = resolveAdminPassword();
  // 新模型：教师登录名 = 工号；旧 dump 里的 teacher1-4 也保留，避免历史种子文件漏改口令
  const staffUsernames = new Set([
    'admin',
    'T2026001',
    'T2026002',
    'teacher1',
    'teacher2',
    'teacher3',
    'teacher4',
  ]);
  const hash = await hashPassword(adminPassword);
  for (const u of data.user ?? []) {
    if (staffUsernames.has(u.username)) {
      u.passwordHash = hash;
    }
  }

  await clearDatabase();
  await seedAll(data);

  console.log('');
  console.log('📋 种子数据完成！');
  console.log('  管理/教师账号（口令见下）:');
  for (const u of data.user ?? []) {
    if (staffUsernames.has(u.username)) {
      console.log(`    ${u.username} / ${adminPassword}`);
    }
  }
  const students = (data.user ?? []).filter((u: any) => !staffUsernames.has(u.username));
  if (students.length > 0) {
    console.log(`  学生演示账号: ${students.map((u: any) => u.username).join(', ')}（口令 123456，上线前请删除或改密）`);
  }
  console.log(`  题目: ${data.question?.length ?? 0} 道`);
  console.log(`  考试: ${data.exam?.length ?? 0} 场`);
  if (generated) {
    console.log('');
    console.log('  ⚠️  以上口令为本次随机生成，系统不再显示第二次，请立即保存。');
    console.log('     也可在下一次部署前用环境变量 ADMIN_INITIAL_PASSWORD 指定固定口令。');
  }
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
