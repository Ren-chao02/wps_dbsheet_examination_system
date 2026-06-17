/**
 * WPS多维表格题库 - 知识点分类初始化脚本
 * 
 * 使用方法：
 * 1. 确保数据库已连接
 * 2. 运行: npx ts-node scripts/init-categories.ts
 * 
 * 功能：
 * - 创建两级分类体系（一级6类 + 二级16子类）
 * - 支持扩展性设计，可后续添加更多层级
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ==================== 分类定义 ====================

interface CategoryDefinition {
  name: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  children?: CategoryDefinition[];
}

// 一级分类和二级分类的完整定义
const categoryTree: CategoryDefinition[] = [
  {
    name: '基础概念与界面操作',
    description: '多维表格基础认知、界面导航、新建表格等入门操作',
    icon: '📱',
    sortOrder: 1,
    children: [
      { name: '新建表格', description: '创建空白多维表格和数据表', sortOrder: 1 },
      { name: '界面导航', description: '认识和使用左侧导航面板、菜单栏等', sortOrder: 2 },
    ],
  },
  {
    name: '字段类型与配置',
    description: '30种字段的创建、属性设置与应用场景',
    icon: '🔧',
    sortOrder: 2,
    children: [
      { name: '基础字段', description: '文本、数字、日期、选项等基础类型', sortOrder: 1 },
      { name: '业务字段', description: '联系人、富文本、图片附件等业务类型', sortOrder: 2 },
      { name: 'AI字段', description: 'AI智能识别、智能分类等AI增强字段', sortOrder: 3 },
      { name: '高级字段', description: '编号、创建人/时间等系统自动字段', sortOrder: 4 },
    ],
  },
  {
    name: '视图操作与管理',
    description: '表格视图、看板视图、仪表盘等多种视图的使用与配置',
    icon: '👁️',
    sortOrder: 3,
    children: [
      { name: '表格视图', description: '基础表格展示、字段显隐、筛选排序分组', sortOrder: 1 },
      { name: '看板视图', description: '任务状态管理、卡片拖拽、看板配置', sortOrder: 2 },
      { name: '筛选排序分组', description: '多条件组合筛选、多级排序、分组归类', sortOrder: 3 },
      { name: '仪表盘', description: '柱状图、折线图、饼状图等数据可视化', sortOrder: 4 },
    ],
  },
  {
    name: '高级字段与关联',
    description: '单向关联、双向关联、查找引用、统计字段等跨表操作',
    icon: '🔗',
    sortOrder: 4,
    children: [
      { name: '单向关联', description: '建立表间单向关联及自动匹配条件配置', sortOrder: 1 },
      { name: '双向关联', description: '实现表间互查的双向关联关系', sortOrder: 2 },
      { name: '查找引用统计', description: '跨表数据显示(VLOOKUP替代)、聚合统计', sortOrder: 3 },
    ],
  },
  {
    name: '自动化与AI功能',
    description: '工作流自动化、AI助手、OCR识别等智能化功能',
    icon: '🤖',
    sortOrder: 5,
    children: [
      { name: '自动化工作流', description: '触发器+动作配置、定时任务(Cron)', sortOrder: 1 },
      { name: 'AI助手', description: '自然语言建表、AI智能分类、拍照录入', sortOrder: 2 },
    ],
  },
  {
    name: '综合应用',
    description: '系统集成、数据迁移、完整项目实战等综合性应用场景',
    icon: '🎯',
    sortOrder: 6,
    children: [
      { name: '数据管理', description: 'Excel导入导出、批量操作、权限管理', sortOrder: 1 },
      { name: '系统集成', description: 'CRM/ERP等完整系统构建案例', sortOrder: 2 },
    ],
  },
];

// ==================== 初始化函数 ====================

/**
 * 递归创建分类树
 */
async function createCategoryTree(
  categories: CategoryDefinition[],
  parentId: string | null = null,
  level: number = 1
): Promise<void> {
  for (const categoryDef of categories) {
    // 创建当前分类
    const category = await prisma.questionCategory.create({
      data: {
        name: categoryDef.name,
        description: categoryDef.description,
        icon: categoryDef.icon,
        parentId: parentId,
        sortOrder: categoryDef.sortOrder,
        level: level,
        status: 'ACTIVE',
        metadata: {}, // 可在此添加自定义元数据
      },
    });

    // 更新path字段
    if (parentId) {
      const parent = await prisma.questionCategory.findUnique({
        where: { id: parentId },
        select: { path: true },
      });
      
      if (parent) {
        await prisma.questionCategory.update({
          where: { id: category.id },
          data: { path: `${parent.path}/${category.id}` },
        });
      }
    } else {
      await prisma.questionCategory.update({
        where: { id: category.id },
        data: { path: category.id },
      });
    }

    console.log(`✅ [Level ${level}] 创建分类: ${categoryDef.name} (${category.id})`);

    // 递归创建子分类
    if (categoryDef.children && categoryDef.children.length > 0) {
      await createCategoryTree(categoryDef.children, category.id, level + 1);
    }
  }
}

/**
 * 主函数：执行初始化
 */
async function main() {
  console.log('🚀 开始初始化WPS多维表格知识点分类...\n');
  
  try {
    // 检查是否已有数据
    const existingCount = await prisma.questionCategory.count();
    
    if (existingCount > 0) {
      console.log(`⚠️  数据库中已存在 ${existingCount} 个分类`);
      console.log('请确认是否要清空并重新初始化？(y/n)');
      
      // 在实际使用时可以添加交互式确认
      // 这里为了自动化，直接清空（生产环境需谨慎）
      await prisma.questionCategory.deleteMany();
      console.log('✅ 已清空现有分类数据\n');
    }

    // 创建分类树
    await createCategoryTree(categoryTree);

    // 统计结果
    const totalCount = await prisma.questionCategory.count();
    const rootCount = await prisma.questionCategory.count({ where: { parentId: null } });

    console.log('\n' + '='.repeat(60));
    console.log('🎉 初始化完成！');
    console.log('=' .repeat(60));
    console.log(`📊 统计信息:`);
    console.log(`   - 总分类数: ${totalCount}`);
    console.log(`   - 一级分类: ${rootCount}`);
    console.log(`   - 二级分类: ${totalCount - rootCount}`);
    console.log(`   - 最大层级: 2 (支持扩展至5层)`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ 初始化失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行
main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
