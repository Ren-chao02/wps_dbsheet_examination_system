/**
 * WPS多维表格题库导入脚本
 * 
 * 功能：
 * 1. 读取题库JSON文件
 * 2. 查找对应的一级和二级分类
 * 3. 导入题目并建立分类关联
 * 4. 支持增量导入（跳过已存在的题目）
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ==================== 配置 ====================

const QUESTION_BANK_PATH = path.join(__dirname, '../../../question_bank_wps_multidimensional_table.json');

interface QuestionBank {
  metadata: any;
  questions: Array<{
    id: string;
    title: string;
    description: string;
    type: string;
    difficulty: string; // 初级/中级/高级
    knowledgeCategory: {
      primary: string;   // 一级分类名称
      secondary: string; // 二级分类名称
    };
    answerRules: Array<{
      ruleId: string;
      action: string;
      expected: any;
      score: number;
    }>;
    hints?: string;
    tags?: string[];
  }>;
}

// 难度映射
const DIFFICULTY_MAP: Record<string, 'easy' | 'medium' | 'hard'> = {
  '初级': 'easy',
  '中级': 'medium',
  '高级': 'hard',
};

// ==================== 辅助函数 ====================

/**
 * 根据分类名称查找分类ID
 */
async function findCategoryByName(name: string): Promise<string | null> {
  const category = await prisma.questionCategory.findFirst({
    where: { name },
    select: { id: true, status: true },
  });
  
  return category?.status === 'ACTIVE' ? category.id : null;
}

/**
 * 转换答案规则格式
 */
function transformAnswerRules(rules: QuestionBank['questions'][0]['answerRules']): any[] {
  return rules.map(rule => ({
    id: rule.ruleId,
    action: rule.action,
    params: rule.expected,
    score: rule.score,
  }));
}

// ==================== 主函数 ====================

async function main() {
  console.log('🚀 开始导入WPS多维表格题库...\n');
  
  try {
    // 1. 读取题库文件
    console.log('📖 读取题库文件...');
    
    if (!fs.existsSync(QUESTION_BANK_PATH)) {
      throw new Error(`题库文件不存在: ${QUESTION_BANK_PATH}`);
    }
    
    const fileContent = fs.readFileSync(QUESTION_BANK_PATH, 'utf-8');
    const questionBank: QuestionBank = JSON.parse(fileContent);
    
    console.log(`✅ 成功读取题库，共 ${questionBank.questions.length} 道题目\n`);
    
    // 2. 统计信息
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    const errors: string[] = [];
    
    // 3. 逐个导入题目
    for (let i = 0; i < questionBank.questions.length; i++) {
      const q = questionBank.questions[i];
      
      try {
        // 检查题目是否已存在（通过title判断）
        const existing = await prisma.question.findFirst({
          where: { title: q.title },
          select: { id: true },
        });
        
        if (existing) {
          console.log(`⏭️  [${i + 1}/${questionBank.questions.length}] 跳过（已存在）: ${q.title}`);
          skipCount++;
          continue;
        }
        
        // 查找一级分类
        const primaryCategoryId = await findCategoryByName(q.knowledgeCategory.primary);
        
        if (!primaryCategoryId) {
          throw new Error(`一级分类不存在: ${q.knowledgeCategory.primary}`);
        }
        
        // 查找二级分类
        const secondaryCategoryId = await findCategoryByName(q.knowledgeCategory.secondary);
        
        if (!secondaryCategoryId) {
          throw new Error(`二级分类不存在: ${q.knowledgeCategory.secondary}`);
        }
        
        // 创建题目
        const question = await prisma.question.create({
          data: {
            title: q.title,
            description: q.description,
            type: q.type as any,
            difficulty: DIFFICULTY_MAP[q.difficulty] || 'medium',
            primaryCategoryId,
            secondaryCategoryId,
            answerRules: transformAnswerRules(q.answerRules),
            hints: q.hints || null,
            tags: q.tags || [],
            status: 'draft', // 初始状态为草稿
            teacherName: '系统导入', // 标记为系统导入
          },
        });
        
        console.log(`✅ [${i + 1}/${questionBank.questions.length}] 导入成功: ${q.title} (${question.id})`);
        successCount++;
        
      } catch (error: any) {
        console.error(`❌ [${i + 1}/${questionBank.questions.length}] 导入失败: ${q.title}`);
        console.error(`   错误: ${error.message}`);
        errors.push(`${q.id}: ${error.message}`);
        errorCount++;
      }
    }
    
    // 4. 输出统计结果
    console.log('\n' + '='.repeat(70));
    console.log('🎉 题库导入完成！');
    console.log('='.repeat(70));
    console.log(`📊 统计信息:`);
    console.log(`   - 总题目数: ${questionBank.questions.length}`);
    console.log(`   - 成功导入: ${successCount}`);
    console.log(`   - 跳过(已存在): ${skipCount}`);
    console.log(`   - 失败: ${errorCount}`);
    
    if (errors.length > 0) {
      console.log(`\n❌ 错误详情:`);
      errors.forEach((err, idx) => console.log(`   ${idx + 1}. ${err}`));
    }
    
    // 5. 分类统计
    const categoryStats = await prisma.question.groupBy({
      by: ['primaryCategoryId'],
      _count: true,
      where: {
        primaryCategoryId: { not: null },
      },
    });
    
    console.log(`\n📈 各分类题目数量:`);
    for (const stat of categoryStats) {
      if (stat.primaryCategoryId) { // 添加空值检查
        const category = await prisma.questionCategory.findUnique({
          where: { id: stat.primaryCategoryId },
          select: { name: true },
        });
        console.log(`   - ${category?.name}: ${stat._count} 道`);
      }
    }
    
    console.log('\n'.repeat(70));
    
  } catch (error) {
    console.error('❌ 导入过程出错:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行
main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
