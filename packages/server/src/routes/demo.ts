import { Router, Request, Response } from 'express';
import { evaluateRules, getActionLabel, MOCK_SCHEMAS } from '../engine';

/**
 * Demo 路由：演示 WPS 多维表格考试系统的完整判分流程
 * - 无需认证
 * - 使用 Mock 数据（无需 WPS API 凭证）
 */

export const demoRouter = Router();

// ============================================================
// Mock Schema 端点（保留原有功能）
// ============================================================

const MOCK_SCHEMA = {
  result: 0,
  detail: {
    sheets: [
      {
        id: 1,
        name: '学生信息表',
        primaryFieldId: 'fld_001',
        fields: [
          { id: 'fld_001', name: '学号', type: 'SingleLineText', required: true },
          { id: 'fld_002', name: '姓名', type: 'SingleLineText', required: true },
        ],
        views: [
          { id: 'viw_001', name: '表格视图', type: 'Grid' },
        ],
      },
    ],
  },
};

demoRouter.get('/schema', (_req: Request, res: Response) => {
  res.json(MOCK_SCHEMA);
});

demoRouter.get('/schema/:tableName/fields', (req: Request, res: Response) => {
  const tableName = decodeURIComponent(req.params.tableName);
  const table = MOCK_SCHEMA.detail.sheets.find(s => s.name === tableName);
  if (!table) {
    return res.status(404).json({ result: -1, detail: { message: '表不存在' } });
  }
  res.json({
    result: 0,
    detail: {
      tableName: table.name,
      tableId: table.id,
      fields: table.fields,
      views: table.views,
    },
  });
});

// ============================================================
// Demo 题目数据（硬编码，不依赖数据库）
// ============================================================

const DEMO_QUESTIONS = [
  {
    id: 'demo_q1',
    title: '创建学生档案表',
    description:
      '请在金山多维表格中创建一个名为「学生档案」的数据表，并添加以下字段：\n' +
      '1. 姓名（文本）\n' +
      '2. 年龄（数字）\n' +
      '3. 性别（单选：男/女）\n' +
      '4. 出生日期（日期）',
    type: 'create_table',
    difficulty: 'easy',
    score: 20,
    answerRules: [
      { id: 'r1', action: 'check_table_exists', params: { tableName: '学生档案' }, score: 5 },
      { id: 'r2', action: 'check_field', params: { tableName: '学生档案', fieldName: '姓名', type: 'text' }, score: 5 },
      { id: 'r3', action: 'check_field', params: { tableName: '学生档案', fieldName: '年龄', type: 'number' }, score: 5 },
      { id: 'r4', action: 'check_field', params: { tableName: '学生档案', fieldName: '性别', type: 'single_select' }, score: 3 },
      { id: 'r5', action: 'check_field', params: { tableName: '学生档案', fieldName: '出生日期', type: 'date' }, score: 2 },
    ],
    hints: '提示：创建表时注意表名不要有错别字',
    tags: ['建表', '字段'],
  },
  {
    id: 'demo_q2',
    title: '创建任务看板视图',
    description:
      '请在「任务表」中创建一个看板视图，按「状态」字段分组。\n' +
      '要求：\n' +
      '1. 视图名称设为「任务看板」\n' +
      '2. 按「状态」字段分组\n' +
      '3. 仅显示「优先级=高」的记录',
    type: 'config_view',
    difficulty: 'medium',
    score: 15,
    answerRules: [
      { id: 'r1', action: 'check_view_exists', params: { tableName: '任务表', viewName: '任务看板' }, score: 5 },
      { id: 'r2', action: 'check_view_type', params: { tableName: '任务表', viewName: '任务看板', viewType: 'kanban' }, score: 5 },
      { id: 'r3', action: 'check_view_group', params: { tableName: '任务表', viewName: '任务看板', groupByField: '状态' }, score: 3 },
      { id: 'r4', action: 'check_view_filter', params: { tableName: '任务表', viewName: '任务看板', field: '优先级', value: '高' }, score: 2 },
    ],
    hints: '看板视图中可以设置分组字段和筛选条件',
    tags: ['视图', '看板', '筛选'],
  },
];

// ============================================================
// GET /api/demo/questions — 获取 Demo 题目列表
// ============================================================

demoRouter.get('/questions', (_req: Request, res: Response) => {
  res.json(DEMO_QUESTIONS);
});

// ============================================================
// POST /api/demo/grade — 判分
// ============================================================

demoRouter.post('/grade', (req: Request, res: Response) => {
  try {
    const { questionId, mockMode } = req.body;

    if (!questionId) {
      return res.status(400).json({ message: '缺少 questionId 参数' });
    }

    // 查找题目
    const question = DEMO_QUESTIONS.find(q => q.id === questionId);
    if (!question) {
      return res.status(404).json({ message: `题目不存在: ${questionId}` });
    }

    // 选择 Mock Schema
    const schemaKey = mockMode === 'partial' ? `${questionId}_partial` : questionId;
    const schema = MOCK_SCHEMAS[schemaKey];
    if (!schema) {
      return res.status(500).json({
        message: `Mock Schema 不存在: ${schemaKey}`,
        available: Object.keys(MOCK_SCHEMAS),
      });
    }

    // 调用规则引擎判分
    const { totalScore, maxScore, results } = evaluateRules(schema, question.answerRules);

    // 构建友好的响应
    res.json({
      questionId: question.id,
      questionTitle: question.title,
      mockMode: mockMode || 'full',
      schemaKey,
      totalScore,
      maxScore,
      pass: totalScore >= maxScore * 0.6, // 60% 为通过线
      results: results.map(r => ({
        ...r,
        actionLabel: getActionLabel(r.action),
      })),
    });
  } catch (err: any) {
    console.error('Demo grading error:', err);
    res.status(500).json({ message: '判分过程出错', detail: err.message });
  }
});
