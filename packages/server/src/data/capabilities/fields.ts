/**
 * 字段类型能力域（29 项）
 *
 * 与 rule-engine 的 WPS_TYPE_TO_CANONICAL 映射 1:1 对齐。
 * 每个 wpsConcept 值必须是 rule-engine 能识别的 WPS 类型名。
 */
import type { Capability } from '../capability-graph';

export const fieldsCapabilities: Capability[] = [
  // ============================================================
  // 基础字段（10）
  // ============================================================

  {
    id: 'field.text',
    domain: 'fields',
    name: '文本字段',
    description: '存储单行文本的基础字段',
    wpsConcept: 'SingleLineText',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '文本字段(SingleLineText)用于存储姓名、编号等单行文本。canonicalType 归一化为 text。',
    examPatterns: [
      {
        title: '创建文本字段',
        description: '在指定表中创建一个文本类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'text' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.rich_text',
    domain: 'fields',
    name: '富文本字段',
    description: '存储多行富文本内容',
    wpsConcept: 'MultiLineText',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true, limitations: 'canonicalType 归一化为 text，与文本字段类型相同' },
    promptHints: '富文本字段(MultiLineText)用于存储描述、备注等多行文本。注意 canonicalType 归一化为 text。',
    examPatterns: [
      {
        title: '创建富文本字段',
        description: '在指定表中创建一个富文本类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'text' }, // MultiLineText 归一化为 text
          ],
        },
      },
    ],
  },
  {
    id: 'field.number',
    domain: 'fields',
    name: '数字字段',
    description: '存储数值数据',
    wpsConcept: 'Number',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '数字字段(Number)用于存储金额、数量等数值。canonicalType 归一化为 number。',
    examPatterns: [
      {
        title: '创建数字字段',
        description: '在指定表中创建一个数字类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'number' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.currency',
    domain: 'fields',
    name: '货币字段',
    description: '存储货币金额，带货币符号',
    wpsConcept: 'Currency',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '货币字段(Currency)用于存储价格、工资等货币数据。canonicalType 归一化为 currency。',
    examPatterns: [
      {
        title: '创建货币字段',
        description: '在指定表中创建一个货币类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'currency' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.percent',
    domain: 'fields',
    name: '百分比字段',
    description: '存储百分比数值',
    wpsConcept: 'Percent',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '百分比字段(Percent)用于存储完成率、折扣率等。canonicalType 归一化为 percent。',
    examPatterns: [
      {
        title: '创建百分比字段',
        description: '在指定表中创建一个百分比类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'percent' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.date',
    domain: 'fields',
    name: '日期字段',
    description: '存储日期数据',
    wpsConcept: 'Date',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '日期字段(Date)用于存储出生日期、入职日期等。canonicalType 归一化为 date。',
    examPatterns: [
      {
        title: '创建日期字段',
        description: '在指定表中创建一个日期类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'date' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.time',
    domain: 'fields',
    name: '时间字段',
    description: '存储时间数据',
    wpsConcept: 'Time',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '时间字段(Time)用于存储签到时间、时长等。canonicalType 归一化为 time。',
    examPatterns: [
      {
        title: '创建时间字段',
        description: '在指定表中创建一个时间类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'time' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.checkbox',
    domain: 'fields',
    name: '复选框字段',
    description: '存储布尔值（勾选/未勾选）',
    wpsConcept: 'Checkbox',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '复选框字段(Checkbox)用于存储是否完成、是否通过等布尔值。',
    examPatterns: [
      {
        title: '创建复选框字段',
        description: '在指定表中创建一个复选框类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'checkbox' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.rating',
    domain: 'fields',
    name: '等级字段',
    description: '用星级评分表示等级',
    wpsConcept: 'Rating',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '等级字段(Rating)用于存储评分、优先级等。用星级表示。',
    examPatterns: [
      {
        title: '创建等级字段',
        description: '在指定表中创建一个等级类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'rating' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.attachment',
    domain: 'fields',
    name: '附件字段',
    description: '存储图片、文件等附件',
    wpsConcept: 'Attachment',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '附件字段(Attachment)用于存储图片、文档等文件。',
    examPatterns: [
      {
        title: '创建附件字段',
        description: '在指定表中创建一个附件类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'attachment' },
          ],
        },
      },
    ],
  },

  // ============================================================
  // 业务字段（11）
  // ============================================================

  {
    id: 'field.phone',
    domain: 'fields',
    name: '电话字段',
    description: '存储电话号码，带格式校验',
    wpsConcept: 'Phone',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '电话字段(Phone)用于存储联系电话，自带格式校验。',
    examPatterns: [
      {
        title: '创建电话字段',
        description: '在指定表中创建一个电话类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'phone' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.email',
    domain: 'fields',
    name: '邮箱字段',
    description: '存储邮箱地址，带格式校验',
    wpsConcept: 'Email',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '邮箱字段(Email)用于存储电子邮箱，自带格式校验。',
    examPatterns: [
      {
        title: '创建邮箱字段',
        description: '在指定表中创建一个邮箱类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'email' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.url',
    domain: 'fields',
    name: '超链接字段',
    description: '存储网址超链接',
    wpsConcept: 'Url',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '超链接字段(Url)用于存储网址，可点击跳转。',
    examPatterns: [
      {
        title: '创建超链接字段',
        description: '在指定表中创建一个超链接类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'url' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.address',
    domain: 'fields',
    name: '地址字段',
    description: '存储地址信息，支持省市区选择',
    wpsConcept: 'Address',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '地址字段(Address)用于存储地址，支持省市区级联选择。',
    examPatterns: [
      {
        title: '创建地址字段',
        description: '在指定表中创建一个地址类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'address' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.cascade',
    domain: 'fields',
    name: '级联选项字段',
    description: '支持多级关联选择的字段',
    wpsConcept: 'Cascade',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create', 'field.single_select'],
    apiSupport: { schema: true },
    promptHints: '级联选项字段(Cascade)用于省市区、分类层级等多级选择。',
    examPatterns: [
      {
        title: '创建级联选项字段',
        description: '在指定表中创建一个级联选项类型字段',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'cascade' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.id',
    domain: 'fields',
    name: 'ID 字段',
    description: '自动生成的唯一标识字段',
    wpsConcept: 'ID',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: 'ID 字段自动生成唯一标识。',
    examPatterns: [
      {
        title: '创建 ID 字段',
        description: '在指定表中创建一个 ID 类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'id' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.complete',
    domain: 'fields',
    name: '进度字段',
    description: '用进度条表示完成度',
    wpsConcept: 'Complete',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '进度字段(Complete)用进度条表示任务完成度。',
    examPatterns: [
      {
        title: '创建进度字段',
        description: '在指定表中创建一个进度类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'complete' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.contact',
    domain: 'fields',
    name: '联系人字段',
    description: '关联系统联系人/成员',
    wpsConcept: 'Contact',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'medium',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '联系人字段(Contact)用于关联团队成员，常用于任务分配。',
    examPatterns: [
      {
        title: '创建联系人字段',
        description: '在指定表中创建一个联系人类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'contact' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.note',
    domain: 'fields',
    name: '备注字段',
    description: '存储带格式的备注内容',
    wpsConcept: 'Note',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '备注字段(Note)用于存储带格式的备注内容。',
    examPatterns: [
      {
        title: '创建备注字段',
        description: '在指定表中创建一个备注类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'note' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.single_select',
    domain: 'fields',
    name: '单选字段',
    description: '从预设选项中选择一个',
    wpsConcept: 'SingleSelect',
    scorable: 'auto',
    ruleActions: ['check_field', 'check_field_options'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '单选字段(SingleSelect)用于分类状态，如考勤状态(出勤/请假/缺勤)。考察时关注字段类型和选项值。',
    examPatterns: [
      {
        title: '创建单选字段',
        description: '在指定表中创建一个单选类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'single_select' },
          ],
        },
      },
      {
        title: '设置单选字段选项',
        description: '为单选字段配置指定的选项值',
        suggestedScore: 5,
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
    ],
  },
  {
    id: 'field.multi_select',
    domain: 'fields',
    name: '多选字段',
    description: '从预设选项中选择多个',
    wpsConcept: 'MultipleSelect',
    scorable: 'auto',
    ruleActions: ['check_field', 'check_field_options'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '多选字段(MultipleSelect)用于多标签分类，如技能标签。考察时关注字段类型和选项值。',
    examPatterns: [
      {
        title: '创建多选字段',
        description: '在指定表中创建一个多选类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'multiple_select' },
          ],
        },
      },
      {
        title: '设置多选字段选项',
        description: '为多选字段配置指定的选项值',
        suggestedScore: 5,
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
    ],
  },

  // ============================================================
  // 高级字段（8）
  // ============================================================

  {
    id: 'field.link',
    domain: 'fields',
    name: '关联字段',
    description: '关联其他工作表的记录',
    wpsConcept: 'Link',
    scorable: 'auto',
    ruleActions: ['check_field', 'check_field_link_target'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create', 'table.multi'],
    apiSupport: { schema: true },
    promptHints: '关联字段(Link)用于建立表间关系。考察时关注字段类型和关联目标表。',
    examPatterns: [
      {
        title: '创建关联字段',
        description: '在指定表中创建一个关联类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'link' },
          ],
        },
      },
      {
        title: '设置关联目标表',
        description: '将关联字段关联到正确的目标表',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_field_link_target',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'targetTable', from: 'linkTargetTable' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.lookup',
    domain: 'fields',
    name: '引用字段',
    description: '引用关联表的字段值',
    wpsConcept: 'Lookup',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'hard',
    prerequisites: ['field.link'],
    apiSupport: { schema: true },
    promptHints: '引用字段(Lookup)从关联表引用字段值，如从员工表引用部门名称。',
    examPatterns: [
      {
        title: '创建引用字段',
        description: '在指定表中创建一个引用关联表字段的字段',
        suggestedScore: 8,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'lookup' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.auto_number',
    domain: 'fields',
    name: '自动编号字段',
    description: '自动生成递增编号',
    wpsConcept: 'AutoNumber',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '自动编号字段(AutoNumber)自动生成递增编号，如订单号、序号。',
    examPatterns: [
      {
        title: '创建自动编号字段',
        description: '在指定表中创建一个自动编号类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'auto_number' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.created_by',
    domain: 'fields',
    name: '创建人字段',
    description: '自动记录记录创建者',
    wpsConcept: 'CreatedBy',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '创建人字段(CreatedBy)自动记录谁创建了该记录。',
    examPatterns: [
      {
        title: '创建创建人字段',
        description: '在指定表中创建一个创建人类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'created_by' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.created_time',
    domain: 'fields',
    name: '创建时间字段',
    description: '自动记录记录创建时间',
    wpsConcept: 'CreatedTime',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '创建时间字段(CreatedTime)自动记录记录创建的时间。',
    examPatterns: [
      {
        title: '创建创建时间字段',
        description: '在指定表中创建一个创建时间类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'created_time' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.modified_by',
    domain: 'fields',
    name: '修改人字段',
    description: '自动记录最后修改者',
    wpsConcept: 'LastModifiedBy',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '修改人字段(LastModifiedBy)自动记录最后修改该记录的人。',
    examPatterns: [
      {
        title: '创建修改人字段',
        description: '在指定表中创建一个修改人类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'last_modified_by' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.modified_time',
    domain: 'fields',
    name: '修改时间字段',
    description: '自动记录最后修改时间',
    wpsConcept: 'LastModifiedTime',
    scorable: 'auto',
    ruleActions: ['check_field'],
    defaultDifficulty: 'easy',
    prerequisites: ['table.create'],
    apiSupport: { schema: true },
    promptHints: '修改时间字段(LastModifiedTime)自动记录最后修改的时间。',
    examPatterns: [
      {
        title: '创建修改时间字段',
        description: '在指定表中创建一个修改时间类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'last_modified_time' },
          ],
        },
      },
    ],
  },
  {
    id: 'field.formula',
    domain: 'fields',
    name: '公式字段',
    description: '通过公式自动计算字段值',
    wpsConcept: 'Formula',
    scorable: 'needsReview',
    ruleActions: ['check_field', 'check_field_formula'],
    defaultDifficulty: 'hard',
    prerequisites: ['table.create'],
    apiSupport: { schema: true, limitations: 'Schema 不含公式表达式详情，check_field_formula 标记 needsReview' },
    promptHints: '公式字段(Formula)通过表达式自动计算。Schema 只返回字段存在性，公式表达式需人工复核。',
    examPatterns: [
      {
        title: '创建公式字段',
        description: '在指定表中创建一个公式类型字段',
        suggestedScore: 5,
        ruleTemplate: {
          action: 'check_field',
          paramResolvers: [
            { param: 'tableName', from: 'sheetName' },
            { param: 'fieldName', from: 'fieldName' },
            { param: 'type', value: 'formula' },
          ],
        },
      },
      {
        title: '验证公式表达式',
        description: '设置正确的公式表达式',
        suggestedScore: 10,
        ruleTemplate: null, // 公式详情需人工复核
      },
    ],
  },
];
