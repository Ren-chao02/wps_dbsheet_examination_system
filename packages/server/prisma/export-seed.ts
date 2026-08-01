/**
 * 数据导出脚本
 * 将当前数据库中的核心业务数据（账号、角色、分类、题库、试卷、考试等）导出为 JSON，
 * 供 seed.ts 在部署新环境时导入，实现"部署即含完整数据"。
 *
 * 用法：npx tsx prisma/export-seed.ts
 * 输出：prisma/seed-data/dump.json
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

// 对 Prisma 查询结果做安全序列化（Date→ISO 字符串，BigInt→字符串）
function serialize<T>(rows: T[]): unknown[] {
  return JSON.parse(
    JSON.stringify(rows, (_key, value) => {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'bigint') return value.toString();
      return value;
    })
  );
}

async function main() {
  console.log('📤 开始导出数据库数据...');

  // 核心业务数据（不含运行时/敏感配置：WpsConfig、LlmConfig、邀请、审计、通知等）
  const data: Record<string, unknown[]> = {};

  // 1. 基础引用表
  data.department = serialize(await prisma.department.findMany());
  data.major = serialize(await prisma.major.findMany());
  data.classRoom = serialize(await prisma.classRoom.findMany());
  data.systemRole = serialize(await prisma.systemRole.findMany());
  data.systemRolePermission = serialize(await prisma.systemRolePermission.findMany());
  data.questionCategory = serialize(await prisma.questionCategory.findMany());

  // 2. 用户（保留密码 hash，账号可原样登录）
  data.user = serialize(await prisma.user.findMany());

  // 3. 题库
  data.question = serialize(await prisma.question.findMany());

  // 4. 试卷
  data.paper = serialize(await prisma.paper.findMany());
  data.paperQuestion = serialize(await prisma.paperQuestion.findMany());

  // 5. 考试（批次、考场、考试）
  data.examBatch = serialize(await prisma.examBatch.findMany());
  data.examRoom = serialize(await prisma.examRoom.findMany());
  data.exam = serialize(await prisma.exam.findMany());
  data.examQuestion = serialize(await prisma.examQuestion.findMany());

  // 6. 答卷示例（含评分明细）
  data.studentSubmission = serialize(await prisma.studentSubmission.findMany());
  data.submissionDetail = serialize(await prisma.submissionDetail.findMany());

  // 写入 JSON 文件
  const outPath = path.resolve(__dirname, 'seed-data/dump.json');
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

  const summary = Object.entries(data)
    .map(([k, v]) => `${k}: ${v.length}`)
    .join(', ');
  console.log(`✅ 导出完成 → ${outPath}`);
  console.log(`    ${summary}`);
}

main()
  .catch((e) => {
    console.error('❌ 导出失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
