/**
 * 表单能力域（5 项）
 *
 * 描述表单视图的字段配置与设置。
 * check_form_fields / check_form_field_required 需通过额外 API 获取表单字段数据，
 * 若未提供则标记 needsReview。
 */
import type { Capability } from '../capability-graph';

export const formsCapabilities: Capability[] = [
  {
    id: 'form.create',
    domain: 'forms',
    name: '创建表单',
    description: '在表中创建表单视图用于数据收集',
    wpsConcept: 'Form',
    scorable: 'auto',
    ruleActions: ['check_form_exists'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '创建表单考察视图中是否存在 Form 类型视图。check_form_exists 通过 view.type === "Form" 识别。',
    examPatterns: [
      {
        title: '创建表单视图',
        description: '在指定表中创建一个表单视图',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_form_exists',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'formName', from: 'formName' },
          ],
        },
      },
    ],
  },
  {
    id: 'form.fields',
    domain: 'forms',
    name: '表单字段配置',
    description: '配置表单中显示的字段',
    wpsConcept: 'Form.fields',
    scorable: 'auto',
    ruleActions: ['check_form_fields'],
    defaultDifficulty: 'medium',
    prerequisites: ['form.create'],
    apiSupport: { schema: true, endpoint: 'KingsoftAdapter.getFormFields()', limitations: '需通过额外 API 获取表单字段数据，未提供时标记 needsReview' },
    promptHints: '表单字段配置考察表单包含的字段。rule-engine 通过 formFields 数据验证期望字段是否都存在。需 grading-service 预获取表单字段数据。',
    examPatterns: [
      {
        title: '配置表单字段',
        description: '在表单中添加指定的字段',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_form_fields',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'formName', from: 'formName' },
            { param: 'fields', from: 'formFieldNames' },
          ],
        },
      },
    ],
  },
  {
    id: 'form.field_required',
    domain: 'forms',
    name: '表单字段必填',
    description: '设置表单中字段的必填属性',
    wpsConcept: 'Form.field.required',
    scorable: 'auto',
    ruleActions: ['check_form_field_required'],
    defaultDifficulty: 'medium',
    prerequisites: ['form.fields'],
    apiSupport: { schema: true, endpoint: 'KingsoftAdapter.getFormFields()', limitations: '需通过额外 API 获取表单字段数据，未提供时标记 needsReview' },
    promptHints: '表单字段必填考察表单中字段是否设置为必填。需 grading-service 预获取表单字段数据。',
    examPatterns: [
      {
        title: '设置表单字段必填',
        description: '将表单中的指定字段设置为必填',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_form_field_required',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'formName', from: 'formName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'required', value: true },
          ],
        },
      },
    ],
  },
  {
    id: 'form.default_value',
    domain: 'forms',
    name: '表单字段默认值',
    description: '设置表单中字段的默认值',
    wpsConcept: 'Form.field.defaultValue',
    scorable: 'needsReview',
    ruleActions: [],
    defaultDifficulty: 'medium',
    prerequisites: ['form.fields'],
    apiSupport: { schema: false, limitations: 'Schema 不含表单字段默认值详情，标记 needsReview' },
    promptHints: '表单字段默认值考察表单中字段的初始值。Schema 不含此信息，需人工复核。',
    examPatterns: [
      {
        title: '设置表单字段默认值',
        description: '为表单中的指定字段设置默认值',
        suggestedScore: 5,
        ruleTemplate: null, // 默认值需人工复核
      },
    ],
  },
  {
    id: 'form.layout',
    domain: 'forms',
    name: '表单布局设置',
    description: '配置表单的布局与提交设置',
    wpsConcept: 'Form.settings',
    scorable: 'needsReview',
    ruleActions: ['check_form_settings'],
    defaultDifficulty: 'hard',
    prerequisites: ['form.create'],
    apiSupport: { schema: false, limitations: 'Schema 不含表单设置详情，标记 needsReview' },
    promptHints: '表单布局设置考察表单的提交提示、样式等配置。Schema 不含此信息，必须人工复核。',
    examPatterns: [
      {
        title: '配置表单布局',
        description: '为表单设置正确的布局和提交设置',
        suggestedScore: 8,
        ruleTemplate: null, // 表单设置需人工复核
      },
    ],
  },
];
