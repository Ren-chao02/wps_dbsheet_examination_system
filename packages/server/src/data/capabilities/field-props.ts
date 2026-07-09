/**
 * 字段属性能力域（6 项）
 *
 * 描述字段的属性级配置：必填、默认值、唯一、格式、选项、公式。
 * 与 rule-engine 的字段属性 handler 对齐。
 */
import type { Capability } from '../capability-graph';

export const fieldPropsCapabilities: Capability[] = [
  {
    id: 'field_prop.required',
    domain: 'field_props',
    name: '字段必填',
    description: '设置字段为必填，记录该字段时不能为空',
    wpsConcept: 'Field.required',
    scorable: 'auto',
    ruleActions: ['check_field_required'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create', 'field.text'],
    apiSupport: { schema: true },
    promptHints: '字段必填考察 field.required === true。rule-engine 的 check_field_required 验证字段是否设置为必填。',
    examPatterns: [
      {
        title: '设置字段为必填',
        description: '将指定字段设置为必填',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field_required',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
          ],
        },
      },
    ],
  },
  {
    id: 'field_prop.default_value',
    domain: 'field_props',
    name: '字段默认值',
    description: '设置字段的新记录默认值',
    wpsConcept: 'Field.defaultValue',
    scorable: 'needsReview',
    ruleActions: [],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create', 'field.text'],
    apiSupport: { schema: true, limitations: 'Schema 返回 defaultValueType/defaultValue 但语义判分需人工复核' },
    promptHints: '字段默认值考察新记录创建时字段的初始值。Schema 返回 defaultValue 但默认值语义（尤其条件默认值）需人工复核。',
    examPatterns: [
      {
        title: '设置字段默认值',
        description: '为指定字段设置正确的默认值',
        suggestedScore: 5,
        ruleTemplate: null, // 默认值语义需人工复核
      },
    ],
  },
  {
    id: 'field_prop.unique',
    domain: 'field_props',
    name: '字段唯一约束',
    description: '设置字段值唯一，不允许重复',
    wpsConcept: 'Field.uniqueValue',
    scorable: 'auto',
    ruleActions: ['check_field_unique'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create', 'field.text'],
    apiSupport: { schema: true },
    promptHints: '字段唯一约束考察 field.uniqueValue === true。常用于编号、身份证号等不允许重复的字段。',
    examPatterns: [
      {
        title: '设置字段唯一约束',
        description: '将指定字段设置为唯一，不允许重复值',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field_unique',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
          ],
        },
      },
    ],
  },
  {
    id: 'field_prop.format',
    domain: 'field_props',
    name: '字段格式',
    description: '设置数字/日期/时间字段的显示格式',
    wpsConcept: 'Field.numberFormat',
    scorable: 'auto',
    ruleActions: ['check_field_format'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create', 'field.number'],
    apiSupport: { schema: true, limitations: '通过 numberFormat 字符串模糊匹配验证' },
    promptHints: '字段格式考察 numberFormat 设置。rule-engine 用 includes 模糊匹配，如期望 "0.00" 匹配实际 "0.00"。',
    examPatterns: [
      {
        title: '设置数字字段格式',
        description: '为数字字段设置指定的小数位数或千分位格式',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field_format',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'format', from: 'fieldFormat' },
          ],
        },
      },
    ],
  },
  {
    id: 'field_prop.options',
    domain: 'field_props',
    name: '字段选项配置',
    description: '为单选/多选字段设置选项值',
    wpsConcept: 'Field.items',
    scorable: 'auto',
    ruleActions: ['check_field_options'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create', 'field.single_select'],
    apiSupport: { schema: true, limitations: 'rule-engine 用 item.value（非 item.name）取选项值' },
    promptHints: '字段选项配置考察选项值列表。注意 rule-engine 取 item.value 而非 item.name，默认精确匹配（exact）。',
    examPatterns: [
      {
        title: '设置字段选项值',
        description: '为单选/多选字段配置指定的选项值列表',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_field_options',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'options', from: 'fieldOptions' },
            { param: 'matchMode', value: 'exact' },
          ],
        },
      },
      {
        title: '设置字段选项（包含匹配）',
        description: '为字段配置包含指定选项的选项列表（允许额外选项）',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field_options',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'options', from: 'fieldOptions' },
            { param: 'matchMode', value: 'contains' },
          ],
        },
      },
    ],
  },
  {
    id: 'field_prop.formula',
    domain: 'field_props',
    name: '字段公式',
    description: '为公式字段设置计算表达式',
    wpsConcept: 'Field.formula',
    scorable: 'needsReview',
    ruleActions: ['check_field_formula'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create', 'field.formula'],
    apiSupport: { schema: false, limitations: 'Schema 不含公式表达式详情，check_field_formula 标记 needsReview' },
    promptHints: '字段公式考察公式表达式是否正确。Schema 不返回公式表达式详情，必须人工复核。',
    examPatterns: [
      {
        title: '设置公式表达式',
        description: '为公式字段设置正确的计算表达式',
        suggestedScore: 10,
        ruleTemplate: null, // 公式表达式需人工复核
      },
    ],
  },
];
