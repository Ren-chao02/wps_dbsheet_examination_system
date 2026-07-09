/**
 * 视图配置能力域（12 项）
 *
 * 包含 7 种视图类型 + 5 种视图配置。
 * 视图类型通过 check_view_exists + check_view_type 验证；
 * 筛选/排序/分组因 Schema 不含详情，标记 needsReview。
 */
import type { Capability } from '../capability-graph';

export const viewsCapabilities: Capability[] = [
  // ============================================================
  // 视图类型（7）
  // ============================================================

  {
    id: 'view.grid',
    domain: 'views',
    name: '表格视图',
    description: '创建 Grid 表格视图（默认视图类型）',
    wpsConcept: 'Grid',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '表格视图(Grid)是默认视图类型，以行列形式展示数据。',
    examPatterns: [
      {
        title: '创建表格视图',
        description: '在指定表中创建一个表格类型的视图',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Grid' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.kanban',
    domain: 'views',
    name: '看板视图',
    description: '创建 Kanban 看板视图，按分组列展示卡片',
    wpsConcept: 'Kanban',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create', 'field.single_select'],
    apiSupport: { schema: true },
    promptHints: '看板视图(Kanban)按单选字段分组展示卡片，常用于任务流管理。',
    examPatterns: [
      {
        title: '创建看板视图',
        description: '在指定表中创建一个看板类型的视图',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Kanban' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.gantt',
    domain: 'views',
    name: '甘特图视图',
    description: '创建 Gantt 甘特图视图，按时间轴展示任务',
    wpsConcept: 'Gantt',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create', 'field.date'],
    apiSupport: { schema: true },
    promptHints: '甘特图视图(Gantt)按日期字段展示任务时间轴，需配置开始/结束日期字段。',
    examPatterns: [
      {
        title: '创建甘特图视图',
        description: '在指定表中创建一个甘特图类型的视图',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Gantt' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.calendar',
    domain: 'views',
    name: '日历视图',
    description: '创建 Calendar 日历视图，按日历展示记录',
    wpsConcept: 'Calendar',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create', 'field.date'],
    apiSupport: { schema: true },
    promptHints: '日历视图(Calendar)按日期字段在日历上展示记录。',
    examPatterns: [
      {
        title: '创建日历视图',
        description: '在指定表中创建一个日历类型的视图',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Calendar' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.gallery',
    domain: 'views',
    name: '画册视图',
    description: '创建 Gallery 画册视图，以卡片形式展示记录',
    wpsConcept: 'Gallery',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '画册视图(Gallery)以卡片形式展示记录，适合含附件的字段。',
    examPatterns: [
      {
        title: '创建画册视图',
        description: '在指定表中创建一个画册类型的视图',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Gallery' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.form',
    domain: 'views',
    name: '表单视图',
    description: '创建 Form 表单视图，用于数据收集',
    wpsConcept: 'Form',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type', 'check_form_exists'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '表单视图(Form)用于对外收集数据。视图域只考察视图创建，表单字段配置见 forms 域。',
    examPatterns: [
      {
        title: '创建表单视图',
        description: '在指定表中创建一个表单类型的视图',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Form' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.tree',
    domain: 'views',
    name: '树形视图',
    description: '创建 Tree 树形视图，按层级展示记录',
    wpsConcept: 'Tree',
    scorable: 'auto',
    ruleActions: ['check_view_exists', 'check_view_type'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create', 'field.link'],
    apiSupport: { schema: true },
    promptHints: '树形视图(Tree)按自引用关联字段展示层级结构，需配置关联字段。',
    examPatterns: [
      {
        title: '创建树形视图',
        description: '在指定表中创建一个树形类型的视图',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_view_type',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
            { param: 'viewType', value: 'Tree' },
          ],
        },
      },
    ],
  },

  // ============================================================
  // 视图配置（5）
  // ============================================================

  {
    id: 'view.create',
    domain: 'views',
    name: '创建视图',
    description: '在表中创建新视图（通用，不限定类型）',
    wpsConcept: 'View',
    scorable: 'auto',
    ruleActions: ['check_view_exists'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '创建视图考察视图是否存在。若需限定视图类型，使用具体的视图类型能力（如 view.grid）。',
    examPatterns: [
      {
        title: '创建指定名称的视图',
        description: '在表中创建一个指定名称的视图',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_view_exists',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'viewName', from: 'viewName' },
          ],
        },
      },
    ],
  },
  {
    id: 'view.filter',
    domain: 'views',
    name: '视图筛选',
    description: '为视图设置筛选条件',
    wpsConcept: 'View.filter',
    scorable: 'needsReview',
    ruleActions: ['check_view_filter'],
    defaultDifficulty: 'hard',
    prerequisites: ['view.create'],
    apiSupport: { schema: false, limitations: 'Schema 不含视图筛选条件详情，标记 needsReview' },
    promptHints: '视图筛选考察筛选条件配置。Schema 不返回筛选条件详情，必须人工复核。',
    examPatterns: [
      {
        title: '设置视图筛选条件',
        description: '为视图设置正确的筛选条件',
        suggestedScore: 10,
        ruleTemplate: null, // 筛选条件需人工复核
      },
    ],
  },
  {
    id: 'view.sort',
    domain: 'views',
    name: '视图排序',
    description: '为视图设置排序规则',
    wpsConcept: 'View.sort',
    scorable: 'needsReview',
    ruleActions: ['check_view_sort'],
    defaultDifficulty: 'medium',
    prerequisites: ['view.create'],
    apiSupport: { schema: false, limitations: 'Schema 不含视图排序详情，标记 needsReview' },
    promptHints: '视图排序考察排序字段和方向。Schema 不返回排序详情，必须人工复核。',
    examPatterns: [
      {
        title: '设置视图排序',
        description: '为视图设置正确的排序规则',
        suggestedScore: 8,
        ruleTemplate: null, // 排序详情需人工复核
      },
    ],
  },
  {
    id: 'view.group',
    domain: 'views',
    name: '视图分组',
    description: '为视图设置分组',
    wpsConcept: 'View.group',
    scorable: 'needsReview',
    ruleActions: ['check_view_group'],
    defaultDifficulty: 'medium',
    prerequisites: ['view.create'],
    apiSupport: { schema: false, limitations: 'Schema 不含视图分组详情，标记 needsReview' },
    promptHints: '视图分组考察分组字段配置。Schema 不返回分组详情，必须人工复核。',
    examPatterns: [
      {
        title: '设置视图分组',
        description: '为视图设置正确的分组',
        suggestedScore: 8,
        ruleTemplate: null, // 分组详情需人工复核
      },
    ],
  },
  {
    id: 'view.hide_fields',
    domain: 'views',
    name: '隐藏字段',
    description: '在视图中隐藏指定字段',
    wpsConcept: 'View.hiddenFields',
    scorable: 'manual',
    ruleActions: [],
    defaultDifficulty: 'easy',
    prerequisites: ['view.create'],
    apiSupport: { schema: false, limitations: 'Schema 不含视图字段显隐配置，无法自动判分' },
    promptHints: '隐藏字段考察视图中字段的显隐配置。Schema 不含此信息，只能人工判分。',
    examPatterns: [
      {
        title: '在视图中隐藏指定字段',
        description: '在视图中隐藏题目指定的字段',
        suggestedScore: 5,
        ruleTemplate: null, // 无对应 handler，纯人工判分
      },
    ],
  },
];
