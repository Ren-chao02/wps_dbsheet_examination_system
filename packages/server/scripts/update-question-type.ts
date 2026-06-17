import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('开始更新题目类型...');

  // 获取所有当前 type 不是 'comprehensive' 的题目
  const questions = await prisma.question.findMany({
    where: {
      type: { not: 'comprehensive' },
    },
    select: { id: true, title: true, type: true },
  });

  console.log(`找到 ${questions.length} 道需要更新的题目`);

  if (questions.length === 0) {
    console.log('所有题目已为实操题类型，无需更新');
    return;
  }

  // 批量更新
  const result = await prisma.question.updateMany({
    where: {
      type: { not: 'comprehensive' },
    },
    data: {
      type: 'comprehensive',
    },
  });

  console.log(`✅ 成功更新 ${result.count} 道题目为实操题类型`);
  console.log('更新完成');
}

main()
  .catch((e) => {
    console.error('更新失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());