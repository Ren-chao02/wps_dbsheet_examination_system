import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma';
import { authenticate, authorize } from '../middleware/auth';

export const categoryRouter = Router();
categoryRouter.use(authenticate);

// ==================== Schema定义 ====================

// 创建/更新分类的Schema
const categoryBaseSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  icon: z.string().max(64).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  metadata: z.record(z.any()).optional(), // ✅ 支持自定义元数据
});

// 移动节点的Schema
const moveNodeSchema = z.object({
  newParentId: z.string().uuid().nullable(), // 新的父节点ID，null表示移到根级别
  newSortOrder: z.number().int().min(0).optional(), // 新的位置
});

// 批量操作Schema
const batchOperationSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  action: z.enum(['activate', 'deactivate', 'delete']),
});

// ==================== 辅助函数 ====================

/**
 * 构建树形结构
 */
function buildTree(categories: any[], parentId: string | null = null): any[] {
  const tree = [];
  
  for (const category of categories) {
    if (category.parentId === parentId) {
      const children = buildTree(categories, category.id);
      tree.push({
        ...category,
        children: children.length > 0 ? children : undefined,
        _childrenCount: children.length,
      });
    }
  }
  
  // 按sortOrder排序
  return tree.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * 计算层级深度
 */
async function calculateLevel(parentId: string | null): Promise<number> {
  if (!parentId) return 1; // 根节点为1级
  
  const parent = await prisma.questionCategory.findUnique({
    where: { id: parentId },
    select: { level: true },
  });
  
  if (!parent) {
    throw new Error('父分类不存在');
  }
  
  return parent.level + 1;
}

/**
 * 构建路径
 */
async function buildPath(parentId: string | null, currentId: string): Promise<string> {
  if (!parentId) return currentId;
  
  const parent = await prisma.questionCategory.findUnique({
    where: { id: parentId },
    select: { path: true },
  });
  
  if (!parent) {
    throw new Error('父分类不存在');
  }
  
  return `${parent.path}/${currentId}`;
}

/**
 * 验证最大层级深度（默认最多5层，可配置）
 */
function validateMaxDepth(currentLevel: number, maxDepth: number = 5): void {
  if (currentLevel > maxDepth) {
    throw new Error(`分类层级不能超过${maxDepth}层`);
  }
}

/**
 * 检查是否形成循环引用
 */
async function checkCircularReference(nodeId: string, targetParentId: string): Promise<boolean> {
  let currentId = targetParentId;
  
  while (currentId) {
    if (currentId === nodeId) {
      return true; // 形成循环
    }
    
    const node = await prisma.questionCategory.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    
    currentId = node?.parentId || null;
  }
  
  return false;
}

// ==================== API路由 ====================

/**
 * GET /api/categories
 * 获取分类列表（支持多种模式）
 * 
 * Query参数：
 * - mode: 'tree' | 'flat' | 'select' （默认tree）
 * - status: 'ACTIVE' | 'INACTIVE' | 'ALL'
 * - includeStats: 是否包含统计信息
 */
categoryRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { mode = 'tree', status = 'ACTIVE', includeStats = 'false', level } = req.query;

    // 构建查询条件
    const where: any = {};
    if (status !== 'ALL') {
      where.status = status;
    }
    if (level) {
      where.level = Number(level);
    }

    // 获取所有分类
    const categories = await prisma.questionCategory.findMany({
      where,
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    // 根据mode返回不同格式
    if (mode === 'flat') {
      // 扁平列表模式
      res.json({ data: categories, total: categories.length });
    } else if (mode === 'select') {
      // 下拉选择模式（用于表单）
      const selectData = categories.map(cat => ({
        value: cat.id,
        label: cat.name,
        level: cat.level,
        parentId: cat.parentId,
        disabled: cat.status === 'INACTIVE',
      }));
      res.json({ data: selectData });
    } else {
      // 默认：树形结构模式
      const tree = buildTree(categories);
      
      // 可选：包含统计信息
      let result = tree;
      if (includeStats === 'true') {
        result = await addStatisticsToTree(tree);
      }
      
      res.json({ data: result, total: categories.length });
    }
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * GET /api/categories/tree
 * 获取完整树形结构（别名）
 */
categoryRouter.get('/tree', async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.questionCategory.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });
    
    const tree = buildTree(categories);
    res.json({ data: tree });
  } catch (error) {
    console.error('Error fetching category tree:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * GET /api/categories/:id
 * 获取单个分类详情（包含子分类和题目统计）
 */
categoryRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const category = await prisma.questionCategory.findUnique({
      where: { id: req.params.id },
      include: {
        children: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, level: true, status: true },
        },
        _count: {
          select: {
            primaryQuestions: true,
            secondaryQuestions: true,
            children: true,
          },
        },
      },
    });

    if (!category) {
      return res.status(404).json({ message: '分类不存在' });
    }

    // 获取祖先路径（面包屑）
    const breadcrumbs = await getBreadcrumbs(category.id);

    res.json({ 
      data: {
        ...category,
        breadcrumbs,
      }
    });
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * POST /api/categories
 * 创建新分类
 */
categoryRouter.post('/', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const data = categoryBaseSchema.parse(req.body);

    // 验证父分类是否存在
    if (data.parentId) {
      const parent = await prisma.questionCategory.findUnique({
        where: { id: data.parentId },
      });
      
      if (!parent) {
        return res.status(400).json({ message: '父分类不存在' });
      }
      
      if (parent.status === 'INACTIVE') {
        return res.status(400).json({ message: '无法在已禁用的分类下创建子分类' });
      }
    }

    // 计算层级和路径
    const level = await calculateLevel(data.parentId || null);
    validateMaxDepth(level); // 默认最多5层

    // 创建分类
    const category = await prisma.questionCategory.create({
      data: {
        name: data.name,
        description: data.description,
        icon: data.icon,
        status: data.status || 'ACTIVE',
        parentId: data.parentId,
        sortOrder: data.sortOrder ?? 0,
        metadata: data.metadata || {},
        level,
      },
    });

    // 更新path字段
    const path = await buildPath(data.parentId || null, category.id);
    await prisma.questionCategory.update({
      where: { id: category.id },
      data: { path },
    });

    // 返回更新后的数据（包含path）
    const result = { ...category, path };

    res.status(201).json({ data: result, message: '分类创建成功' });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error creating category:', err);
    res.status(500).json({ message: err.message || '服务器错误' });
  }
});

/**
 * PUT /api/categories/:id
 * 更新分类信息
 */
categoryRouter.put('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    // 检查分类是否存在
    const existing = await prisma.questionCategory.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ message: '分类不存在' });
    }

    const data = categoryBaseSchema.parse(req.body);

    // 如果修改了父分类，需要重新计算层级和路径
    let updateData: any = { ...data };
    
    if (data.parentId !== undefined && data.parentId !== existing.parentId) {
      // 验证新的父分类
      if (data.parentId) {
        const parent = await prisma.questionCategory.findUnique({
          where: { id: data.parentId },
        });
        
        if (!parent) {
          return res.status(400).json({ message: '父分类不存在' });
        }

        // 检查循环引用
        const isCircular = await checkCircularReference(req.params.id, data.parentId);
        if (isCircular) {
          return res.status(400).json({ message: '不能将分类移动到其子分类下（会形成循环）' });
        }
      }

      // 重新计算层级
      const newLevel = await calculateLevel(data.parentId || null);
      validateMaxDepth(newLevel);
      
      updateData.level = newLevel;
    }

    // 更新分类
    const updated = await prisma.questionCategory.update({
      where: { id: req.params.id },
      data: updateData,
    });

    // 如果改变了父级，需要更新path和所有子节点的path
    if (data.parentId !== undefined && data.parentId !== existing.parentId) {
      const newPath = await buildPath(data.parentId || null, req.params.id);
      await prisma.questionCategory.update({
        where: { id: req.params.id },
        data: { path: newPath },
      });
      
      // 递归更新所有子节点的path和level
      await updateChildrenPaths(req.params.id, newPath, updated.level);
    }

    res.json({ data: updated, message: '更新成功' });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error updating category:', err);
    res.status(500).json({ message: err.message || '服务器错误' });
  }
});

/**
 * PUT /api/categories/:id/move
 * 移动分类节点（改变位置或父级）
 */
categoryRouter.put('/:id/move', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const existing = await prisma.questionCategory.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) {
      return res.status(404).json({ message: '分类不存在' });
    }

    const { newParentId, newSortOrder } = moveNodeSchema.parse(req.body);

    // 验证新父分类
    if (newParentId) {
      const parent = await prisma.questionCategory.findUnique({
        where: { id: newParentId },
      });
      
      if (!parent) {
        return res.status(400).json({ message: '目标父分类不存在' });
      }

      // 检查循环引用
      const isCircular = await checkCircularReference(req.params.id, newParentId);
      if (isCircular) {
        return res.status(400).json({ message: '移动目标无效（会形成循环引用）' });
      }
    }

    // 计算新层级
    const newLevel = await calculateLevel(newParentId || null);
    validateMaxDepth(newLevel);

    // 更新节点
    const updated = await prisma.questionCategory.update({
      where: { id: req.params.id },
      data: {
        parentId: newParentId,
        sortOrder: newSortOrder ?? existing.sortOrder,
        level: newLevel,
      },
    });

    // 更新path
    const newPath = await buildPath(newParentId || null, req.params.id);
    await prisma.questionCategory.update({
      where: { id: req.params.id },
      data: { path: newPath },
    });

    // 递归更新子节点
    await updateChildrenPaths(req.params.id, newPath, newLevel);

    res.json({ data: { ...updated, path: newPath }, message: '移动成功' });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error moving category:', err);
    res.status(500).json({ message: err.message || '服务器错误' });
  }
});

/**
 * DELETE /api/categories/:id
 * 删除分类（软删除或硬删除）
 */
categoryRouter.delete('/:id', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const category = await prisma.questionCategory.findUnique({
      where: { id: req.params.id },
      include: {
        _count: {
          select: {
            children: true,
            primaryQuestions: true,
            secondaryQuestions: true,
          },
        },
      },
    });

    if (!category) {
      return res.status(404).json({ message: '分类不存在' });
    }

    // 检查是否有子分类或关联的题目
    if (category._count.children > 0) {
      return res.status(400).json({ 
        message: `该分类下有 ${category._count.children} 个子分类，请先处理子分类`,
        hasChildren: true,
        childCount: category._count.children,
      });
    }

    if (category._count.primaryQuestions > 0 || category._count.secondaryQuestions > 0) {
      return res.status(400).json({ 
        message: `该分类下有关联的 ${category._count.primaryQuestions + category._count.secondaryQuestions} 道题目，建议先禁用该分类而非删除`,
        hasRelatedQuestions: true,
        questionCount: category._count.primaryQuestions + category._count.secondaryQuestions,
      });
    }

    // 执行删除
    await prisma.questionCategory.delete({
      where: { id: req.params.id },
    });

    res.json({ message: '删除成功' });
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ message: '分类不存在' });
    }
    console.error('Error deleting category:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * POST /api/categories/batch
 * 批量操作分类
 */
categoryRouter.post('/batch', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  try {
    const { ids, action } = batchOperationSchema.parse(req.body);

    switch (action) {
      case 'activate':
        await prisma.questionCategory.updateMany({
          where: { id: { in: ids } },
          data: { status: 'ACTIVE' },
        });
        break;

      case 'deactivate':
        // 检查是否有关联的活跃题目
        const activeQuestions = await prisma.question.count({
          where: {
            OR: [
              { primaryCategoryId: { in: ids } },
              { secondaryCategoryId: { in: ids } },
            ],
            status: { notIn: ['archived'] },
          },
        });

        if (activeQuestions > 0) {
          return res.status(400).json({
            message: `这些分类下有 ${activeQuestions} 道活跃题目，建议先归档相关题目后再禁用`,
            activeQuestionCount: activeQuestions,
          });
        }

        await prisma.questionCategory.updateMany({
          where: { id: { in: ids } },
          data: { status: 'INACTIVE' },
        });
        break;

      case 'delete':
        // 批量删除前检查每个分类
        for (const id of ids) {
          const [children, questions] = await Promise.all([
            prisma.questionCategory.count({ where: { parentId: id } }),
            prisma.question.count({
              where: {
                OR: [
                  { primaryCategoryId: id },
                  { secondaryCategoryId: id },
                ],
              },
            }),
          ]);

          if (children > 0 || questions > 0) {
            return res.status(400).json({
              message: `分类 ID=${id} 下存在子分类或关联题目，无法批量删除`,
              failedId: id,
            });
          }
        }

        await prisma.questionCategory.deleteMany({
          where: { id: { in: ids } },
        });
        break;
    }

    res.json({ message: `批量${action === 'activate' ? '启用' : action === 'deactivate' ? '禁用' : '删除'}成功`, affectedCount: ids.length });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: '参数错误', errors: err.errors });
    }
    console.error('Error batch operation:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});

/**
 * GET /api/categories/stats
 * 获取分类统计数据
 */
categoryRouter.get('/stats/overview', async (_req: Request, res: Response) => {
  try {
    const [
      totalCategories,
      activeCategories,
      rootCategories,
      maxLevel,
      categoriesWithQuestions,
    ] = await Promise.all([
      prisma.questionCategory.count(),
      prisma.questionCategory.count({ where: { status: 'ACTIVE' } }),
      prisma.questionCategory.count({ where: { parentId: null } }),
      prisma.questionCategory.aggregate({ _max: { level: true } }),
      // 统计每个一级分类下的题目数量
      prisma.questionCategory.groupBy({
        by: ['primaryCategoryId'],
        where: { parentId: null },
        _count: { primaryQuestions: true },
      }),
    ]);

    res.json({
      data: {
        summary: {
          total: totalCategories,
          active: activeCategories,
          inactive: totalCategories - activeCategories,
          rootLevel: rootCategories,
          maxDepth: maxLevel._max.level || 0,
        },
        distribution: categoriesWithQuestions.map(item => ({
          categoryId: item.primaryCategoryId,
          questionCount: item._count.primaryQuestions,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ message: '服务器错误' });
  }
});

// ==================== 内部辅助函数 ====================

/**
 * 获取面包屑导航路径
 */
async function getBreadcrumbs(categoryId: string): Promise<any[]> {
  const breadcrumbs = [];
  let currentId: string | null = categoryId;

  while (currentId) {
    const category = await prisma.questionCategory.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, parentId: true, level: true },
    });

    if (!category) break;

    breadcrumbs.unshift({
      id: category.id,
      name: category.name,
      level: category.level,
    });

    currentId = category.parentId;
  }

  return breadcrumbs;
}

/**
 * 为树形结构添加统计信息
 */
async function addStatisticsToTree(tree: any[]): Promise<any[]> {
  for (const node of tree) {
    const stats = await prisma.questionCategory.findUnique({
      where: { id: node.id },
      select: {
        _count: {
          select: {
            primaryQuestions: true,
            secondaryQuestions: true,
            children: true,
          },
        },
      },
    });

    node.statistics = {
      primaryQuestions: stats?._count.primaryQuestions || 0,
      secondaryQuestions: stats?._count.secondaryQuestions || 0,
      totalQuestions: (stats?._count.primaryQuestions || 0) + (stats?._count.secondaryQuestions || 0),
      childCategories: stats?._count.children || 0,
    };

    // 递归处理子节点
    if (node.children && node.children.length > 0) {
      node.children = await addStatisticsToTree(node.children);
    }
  }

  return tree;
}

/**
 * 递归更新子节点的path和level
 */
async function updateChildrenPaths(parentId: string, parentPath: string, parentLevel: number): Promise<void> {
  const children = await prisma.questionCategory.findMany({
    where: { parentId },
    select: { id: true },
  });

  for (const child of children) {
    const childPath = `${parentPath}/${child.id}`;
    const childLevel = parentLevel + 1;

    await prisma.questionCategory.update({
      where: { id: child.id },
      data: {
        path: childPath,
        level: childLevel,
      },
    });

    // 递归更新孙子节点
    await updateChildrenPaths(child.id, childPath, childLevel);
  }
}
