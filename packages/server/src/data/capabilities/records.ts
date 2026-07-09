/**
 * 记录操作能力域（8 项）
 *
 * 描述对记录的增删改查操作。
 * 记录类规则需传入 RecordData（由 KingsoftAdapter.getRecords() 获取）。
 */
import type { Capability } from '../capability-graph';

export const recordsCapabilities: Capability[] = [
  {
    id: 'record.create',
    domain: 'records',
    name: '新增记录',
    description: '在表中添加新记录',
    wpsConcept: 'Record',
    scorable: 'auto',
    ruleActions: ['check_record_exists'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: false, endpoint: 'KingsoftAdapter.getRecords()', limitations: '需传入记录数据，Schema 不含记录详情' },
    promptHints: '新增记录考察表中是否有记录。check_record_exists 验证表记录数 > 0。',
    examPatterns: [
      {
        title: '在表中添加记录',
        description: '在指定表中添加新记录',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_record_exists',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
          ],
        },
      },
    ],
  },
  {
    id: 'record.update',
    domain: 'records',
    name: '修改记录',
    description: '修改已有记录的字段值',
    wpsConcept: 'Record.fields',
    scorable: 'auto',
    ruleActions: ['check_record_value_exact'],
    defaultDifficulty: 'medium',
    prerequisites: ['record.create'],
    apiSupport: { schema: false, endpoint: 'KingsoftAdapter.getRecords()' },
    promptHints: '修改记录考察某字段是否存在指定值。check_record_value_exact 用 String() 精确比较字段值。',
    examPatterns: [
      {
        title: '修改记录字段值',
        description: '将指定记录的字段值修改为正确值',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_record_value_exact',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'value', from: 'recordValue' },
          ],
        },
      },
    ],
  },
  {
    id: 'record.delete',
    domain: 'records',
    name: '删除记录',
    description: '删除表中的记录',
    wpsConcept: 'Record',
    scorable: 'auto',
    ruleActions: ['check_record_count'],
    defaultDifficulty: 'medium',
    prerequisites: ['record.create'],
    apiSupport: { schema: false, endpoint: 'KingsoftAdapter.getRecords()', limitations: '通过记录数间接验证删除操作' },
    promptHints: '删除记录通过记录数间接验证。若要求删除后剩余 N 条，用 check_record_count 验证 count = N（operator: eq）。',
    examPatterns: [
      {
        title: '删除多余记录',
        description: '删除表中多余的记录，保留指定数量',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_record_count',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'count', from: 'recordCount' },
            { param: 'operator', value: 'eq' },
          ],
        },
      },
    ],
  },
  {
    id: 'record.filter',
    domain: 'records',
    name: '记录筛选',
    description: '在记录中筛选出符合条件的数据',
    wpsConcept: 'Record.fields',
    scorable: 'auto',
    ruleActions: ['check_record_value'],
    defaultDifficulty: 'medium',
    prerequisites: ['record.create'],
    apiSupport: { schema: false, endpoint: 'KingsoftAdapter.getRecords()' },
    promptHints: '记录筛选考察表中是否存在包含指定值的记录。check_record_value 默认 contains 匹配。',
    examPatterns: [
      {
        title: '录入符合条件的数据',
        description: '在表中录入包含指定值的数据',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_record_value',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'value', from: 'recordValue' },
            { param: 'matchType', value: 'contains' },
          ],
        },
      },
    ],
  },
  {
    id: 'record.sort',
    domain: 'records',
    name: '记录排序',
    description: '对记录按指定字段排序',
    wpsConcept: 'Record',
    scorable: 'needsReview',
    ruleActions: [],
    defaultDifficulty: 'medium',
    prerequisites: ['record.create'],
    apiSupport: { schema: false, limitations: '记录顺序由 API 返回顺序决定，无法验证用户是否主动排序' },
    promptHints: '记录排序考察记录的显示顺序。但记录顺序由 API 返回顺序决定，无法自动验证用户排序操作，需人工复核。',
    examPatterns: [
      {
        title: '对记录排序',
        description: '按指定字段对记录进行排序',
        suggestedScore: 5,
        ruleTemplate: null, // 记录顺序无法自动验证
      },
    ],
  },
  {
    id: 'record.batch',
    domain: 'records',
    name: '批量录入记录',
    description: '在表中批量录入多条记录',
    wpsConcept: 'Record[]',
    scorable: 'auto',
    ruleActions: ['check_record_count'],
    defaultDifficulty: 'medium',
    prerequisites: ['record.create'],
    apiSupport: { schema: false, endpoint: 'KingsoftAdapter.getRecords()' },
    promptHints: '批量录入考察记录数量是否达标。用 check_record_count 验证记录数 >= 期望值（operator: gte）。',
    examPatterns: [
      {
        title: '批量录入指定数量记录',
        description: '在表中批量录入指定数量的记录',
        suggestedScore: 10,
        ruleTemplate: {
          action: 'check_record_count',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'count', from: 'recordCount' },
            { param: 'operator', value: 'gte' },
          ],
        },
      },
    ],
  },
  {
    id: 'record.validate',
    domain: 'records',
    name: '记录数据校验',
    description: '校验记录中字段值是否精确正确',
    wpsConcept: 'Record.fields',
    scorable: 'auto',
    ruleActions: ['check_record_value_exact'],
    defaultDifficulty: 'medium',
    prerequisites: ['record.create'],
    apiSupport: { schema: false, endpoint: 'KingsoftAdapter.getRecords()' },
    promptHints: '记录数据校验考察字段值是否精确匹配标准答案。与 record.update 类似，但侧重数据正确性而非修改操作。',
    examPatterns: [
      {
        title: '录入正确的数据',
        description: '在表中录入字段值精确匹配标准答案的记录',
        suggestedScore: 10,
        ruleTemplate: {
          action: 'check_record_value_exact',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'value', from: 'recordValue' },
          ],
        },
      },
    ],
  },
  {
    id: 'record.link',
    domain: 'records',
    name: '关联记录',
    description: '建立表间的关联记录',
    wpsConcept: 'Link',
    scorable: 'auto',
    ruleActions: ['check_linked_record'],
    defaultDifficulty: 'hard',
    prerequisites: ['record.create', 'field.link'],
    apiSupport: { schema: true },
    promptHints: '关联记录考察表中是否存在关联到目标表的关联字段。check_linked_record 验证 Link 类型字段的 linkSheet。',
    examPatterns: [
      {
        title: '建立表间关联',
        description: '在指定表中创建关联到目标表的关联记录',
        suggestedScore: 10,
        ruleTemplate: {
          action: 'check_linked_record',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'targetTable', from: 'linkTargetTable' },
          ],
        },
      },
    ],
  },
];
