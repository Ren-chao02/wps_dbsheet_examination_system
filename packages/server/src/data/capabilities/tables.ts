/**
 * 表操作能力域（6 项）
 */
import type { Capability } from '../capability-graph';

export const tablesCapabilities: Capability[] = [
  {
    id: 'table.create',
    domain: 'tables',
    name: '创建工作表',
    description: '在多维表格中创建新的工作表',
    wpsConcept: 'Sheet',
    scorable: 'auto',
    ruleActions: ['check_table_exists'],
    defaultDifficulty: 'easy',
    apiSupport: { schema: true },
    promptHints: '创建工作表是多维表格操作的基础。考察时关注表是否存在、表名是否正确。',
    examPatterns: [
      {
        title: '创建指定名称的工作表',
        description: '在多维表格中创建一个名为指定名称的工作表',
        suggestedScore: 10,
        ruleTemplate: {
          action: 'check_table_exists',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
          ],
        },
      },
    ],
  },
  {
    id: 'table.rename',
    domain: 'tables',
    name: '重命名工作表',
    description: '修改已有工作表的名称',
    wpsConcept: 'Sheet.name',
    scorable: 'auto',
    ruleActions: ['check_table_name'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '重命名工作表考察表名是否匹配。规则引擎使用模糊匹配（includes）。',
    examPatterns: [
      {
        title: '将工作表重命名为指定名称',
        description: '把工作表名称修改为题目要求的名称',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_table_name',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
          ],
        },
      },
    ],
  },
  {
    id: 'table.fields_manage',
    domain: 'tables',
    name: '管理表字段',
    description: '在表中添加、删除字段，确保包含所有必要字段',
    wpsConcept: 'Sheet.fields',
    scorable: 'auto',
    ruleActions: ['check_table_fields', 'check_field_count'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '管理表字段考察字段完整性。可检查表是否包含所有指定字段、字段数量是否达标。',
    examPatterns: [
      {
        title: '确保表包含所有必要字段',
        description: '在表中添加题目要求的所有字段',
        suggestedScore: 10,
        ruleTemplate: {
          action: 'check_table_fields',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fields', from: 'fieldNames' },
          ],
        },
      },
      {
        title: '字段数量达标',
        description: '在表中添加足够数量的字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field_count',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'count', from: 'fieldCount' },
          ],
        },
      },
    ],
  },
  {
    id: 'table.multi',
    domain: 'tables',
    name: '多表协作',
    description: '创建多张工作表并建立关联',
    wpsConcept: 'Sheet[]',
    scorable: 'auto',
    ruleActions: ['check_table_count', 'check_table_exists'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '多表协作考察表数量和各表是否存在。常与关联字段配合考察。',
    examPatterns: [
      {
        title: '创建指定数量的工作表',
        description: '在多维表格中创建多张工作表',
        suggestedScore: 10,
        ruleTemplate: {
          action: 'check_table_count',
          paramResolvers: [
            { param: 'count', from: 'sheetCount' },
          ],
        },
      },
    ],
  },
  {
    id: 'table.primary_field',
    domain: 'tables',
    name: '设置主字段',
    description: '设置表的主字段（第一列）',
    wpsConcept: 'Sheet.primaryFieldId',
    scorable: 'needsReview',
    ruleActions: ['check_field'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true, limitations: 'Schema 返回 primaryFieldId 但主字段语义判分需人工复核' },
    promptHints: '主字段是表的第一列，通常用于显示记录标题。Schema 返回 primaryFieldId。',
    examPatterns: [
      {
        title: '设置正确的主字段',
        description: '将指定字段设置为主字段',
        suggestedScore: 5,
        ruleTemplate: null, // 需人工复核主字段设置
      },
    ],
  },
  {
    id: 'table.delete',
    domain: 'tables',
    name: '删除工作表',
    description: '删除不需要的工作表',
    wpsConcept: 'Sheet',
    scorable: 'auto',
    ruleActions: ['check_table_count'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true, limitations: '通过表数量间接验证删除操作' },
    promptHints: '删除工作表通过表数量间接验证。若要求删除后剩余 N 张表，检查表数量是否等于 N。',
    examPatterns: [
      {
        title: '删除多余工作表',
        description: '删除题目指定的多余工作表，保留正确数量的表',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_table_count',
          paramResolvers: [
            { param: 'count', from: 'sheetCount' },
          ],
        },
      },
    ],
  },
];
