/**
 * 规则引擎 — 判分核心
 *
 * 将 WPS 多维表格 Schema 与题目的 answerRules 进行比对，
 * 逐条验证学生是否按要求完成了表格操作。
 *
 * 纯函数设计：不依赖数据库，不发起网络请求。
 * 生产环境下，WPS Schema 由 KingsoftAdapter 获取后传入。
 */

// ============================================================
// 类型定义
// ============================================================

export interface AnswerRule {
  id: string;
  action: string;
  params: Record<string, any>;
  score: number;
}

export interface RuleResult {
  ruleId: string;
  action: string;
  passed: boolean;
  score: number;        // 0 if failed, full score if passed
  maxScore: number;
  expected: any;
  actual: any;
  errorMessage?: string;
  needsReview: boolean; // true when rule cannot be fully auto-verified from schema alone
}

/** WPS Schema 响应（与 KingsoftAdapter 格式一致） */
export interface SchemaResponse {
  result: number;
  detail: {
    sheets: SheetInfo[];
  };
}

/** 记录数据：按表名索引的记录列表 */
export interface RecordData {
  [tableName: string]: {
    records: { id: string; fields: Record<string, any> }[];
    fieldsSchema?: { id: string; name: string; type: string }[];
  };
}

interface SheetInfo {
  id: number;
  name: string;
  primaryFieldId?: string;
  fields?: FieldInfo[];
  views?: ViewInfo[];
}

interface FieldInfo {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  items?: { value: string; color?: number; id?: string }[];
  linkSheet?: string | number;
  linkView?: string;
  multipleLinks?: boolean;
  isAuto?: boolean;
  linkFilter?: any;
  linkField?: string;
  lookupField?: string;
  aggregation?: string;
  baseType?: string;
  lookupSheetId?: number;
  numberFormat?: string;
  formula?: string;
  valueType?: string;
  maxValue?: number;
  uniqueValue?: boolean;
  defaultValueType?: string;
  defaultValue?: string;
  displayText?: string;
  multipleContacts?: boolean;
  noticeNewContact?: boolean;
  onlyUploadByCamera?: boolean;
  addressLevel?: number;
  detailedAddress?: boolean;
  presetAddress?: { detail?: string; districts?: string[] };
  watchAll?: boolean;
  watchedField?: string[];
  data?: Record<string, any>;
}

interface ViewInfo {
  id: string;
  name: string;
  type: string;
}

// ============================================================
// 字段类型映射：WPS API 类型 → 规范类型
// ============================================================

const WPS_TYPE_TO_CANONICAL: Record<string, string> = {
  // 基础字段
  SingleLineText: 'text',      // v3 旧版类型名，保留兼容
  MultiLineText: 'text',
  Number: 'number',
  Currency: 'currency',
  Percent: 'percent',           // v7 正确名称（非 Percentage）
  Percentage: 'percent',        // v3 兼容
  Date: 'date',
  Time: 'time',
  Checkbox: 'checkbox',
  Complete: 'complete',
  Rating: 'rating',
  ID: 'id',
  Phone: 'phone',
  Email: 'email',
  Url: 'url',
  // 选择类字段
  SingleSelect: 'single_select',
  MultipleSelect: 'multiple_select',
  // 复杂字段
  Attachment: 'attachment',
  Link: 'link',
  Lookup: 'lookup',
  Contact: 'contact',
  Note: 'note',                  // 富文本
  Address: 'address',
  Cascade: 'cascade',
  // 自动字段
  AutoNumber: 'auto_number',
  CreatedBy: 'created_by',
  CreatedTime: 'created_time',
  LastModifiedBy: 'last_modified_by',
  LastModifiedTime: 'last_modified_time',
  // 计算字段
  Formula: 'formula',
};

function canonicalType(wpsType: string): string {
  return WPS_TYPE_TO_CANONICAL[wpsType] || wpsType.toLowerCase();
}

// ============================================================
// 辅助函数
// ============================================================

function findSheet(sheets: SheetInfo[], tableName: string): SheetInfo | undefined {
  return sheets.find(s => s.name === tableName);
}

function findField(sheet: SheetInfo, fieldName: string): FieldInfo | undefined {
  return (sheet.fields || []).find(f => f.name === fieldName);
}

function findView(sheet: SheetInfo, viewName: string): ViewInfo | undefined {
  return (sheet.views || []).find(v => v.name === viewName);
}

// ============================================================
// 规则处理器
// ============================================================

type RuleHandler = (
  schema: SchemaResponse,
  params: Record<string, any>,
  records?: RecordData
) => Omit<RuleResult, 'ruleId' | 'action' | 'maxScore'>;

const ruleHandlers: Record<string, RuleHandler> = {
  /**
   * 验证表是否存在
   * params: { tableName: string }
   */
  check_table_exists(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    return {
      passed: !!sheet,
      score: 0,
      expected: { tableName: params.tableName },
      actual: { tableName: params.tableName, found: !!sheet },
      errorMessage: sheet ? undefined : `未找到表「${params.tableName}」`,
      needsReview: false,
    };
  },

  /**
   * 验证表名称（模糊匹配）
   * params: { tableName: string }
   */
  check_table_name(schema, params) {
    const target = params.tableName.toLowerCase();
    const matched = schema.detail.sheets.find(
      s => s.name.toLowerCase().includes(target) || target.includes(s.name.toLowerCase())
    );
    return {
      passed: !!matched,
      score: 0,
      expected: { tableName: params.tableName },
      actual: { matched: matched?.name || null, allTables: schema.detail.sheets.map(s => s.name) },
      errorMessage: matched ? undefined : `未找到名称近似「${params.tableName}」的表`,
      needsReview: false,
    };
  },

  /**
   * 验证表数量
   * params: { count: number }
   */
  check_table_count(schema, params) {
    const actualCount = schema.detail.sheets.length;
    const expectedCount = params.count;
    return {
      passed: actualCount >= expectedCount,
      score: 0,
      expected: { count: expectedCount },
      actual: { count: actualCount, tables: schema.detail.sheets.map(s => s.name) },
      errorMessage: actualCount >= expectedCount ? undefined : `表数量不足：期望至少 ${expectedCount} 张，实际 ${actualCount} 张`,
      needsReview: false,
    };
  },

  /**
   * 验证字段是否存在，且类型匹配
   * params: { tableName: string, fieldName: string, type?: string }
   */
  check_field(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, type: params.type },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在，无法验证字段`,
        needsReview: false,
      };
    }

    const field = findField(sheet, params.fieldName);
    if (!field) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, type: params.type },
        actual: {
          tableName: params.tableName,
          fieldName: params.fieldName,
          found: false,
          availableFields: (sheet.fields || []).map(f => ({ name: f.name, type: canonicalType(f.type) })),
        },
        errorMessage: `表「${params.tableName}」中未找到字段「${params.fieldName}」`,
        needsReview: false,
      };
    }

    // 如果指定了类型，检查类型匹配
    if (params.type) {
      const actualType = canonicalType(field.type);
      const expectedType = params.type.toLowerCase();
      const typeMatch = actualType === expectedType;

      return {
        passed: typeMatch,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, type: expectedType },
        actual: { tableName: params.tableName, fieldName: params.fieldName, type: actualType, found: true },
        errorMessage: typeMatch
          ? undefined
          : `字段「${params.fieldName}」类型不匹配：期望 ${expectedType}，实际 ${actualType}`,
        needsReview: false,
      };
    }

    return {
      passed: true,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName },
      actual: { tableName: params.tableName, fieldName: params.fieldName, type: canonicalType(field.type), found: true },
      needsReview: false,
    };
  },

  /**
   * 验证视图是否存在
   * params: { tableName: string, viewName: string }
   */
  check_view_exists(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, viewName: params.viewName },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在，无法验证视图`,
        needsReview: false,
      };
    }

    const view = findView(sheet, params.viewName);
    return {
      passed: !!view,
      score: 0,
      expected: { tableName: params.tableName, viewName: params.viewName },
      actual: {
        tableName: params.tableName,
        viewName: params.viewName,
        found: !!view,
        availableViews: (sheet.views || []).map(v => ({ name: v.name, type: v.type })),
      },
      errorMessage: view ? undefined : `表「${params.tableName}」中未找到视图「${params.viewName}」`,
      needsReview: false,
    };
  },

  /**
   * 验证视图类型
   * params: { tableName: string, viewName: string, viewType: string }
   */
  check_view_type(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, viewName: params.viewName, viewType: params.viewType },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const view = findView(sheet, params.viewName);
    if (!view) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, viewName: params.viewName, viewType: params.viewType },
        actual: { tableName: params.tableName, viewName: params.viewName, found: false },
        errorMessage: `视图「${params.viewName}」不存在`,
        needsReview: false,
      };
    }

    const typeMatch = view.type.toLowerCase() === params.viewType.toLowerCase();
    return {
      passed: typeMatch,
      score: 0,
      expected: { tableName: params.tableName, viewName: params.viewName, viewType: params.viewType },
      actual: { tableName: params.tableName, viewName: params.viewName, viewType: view.type },
      errorMessage: typeMatch
        ? undefined
        : `视图「${params.viewName}」类型不匹配：期望 ${params.viewType}，实际 ${view.type}`,
      needsReview: false,
    };
  },

  /**
   * 验证表单视图是否存在
   * params: { tableName: string, formName?: string }
   */
  check_form_exists(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, formName: params.formName },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const formViews = (sheet.views || []).filter(v => v.type === 'Form');
    if (params.formName) {
      const named = formViews.find(v => v.name === params.formName);
      return {
        passed: !!named,
        score: 0,
        expected: { tableName: params.tableName, formName: params.formName, viewType: 'Form' },
        actual: {
          tableName: params.tableName,
          formName: params.formName,
          found: !!named,
          availableForms: formViews.map(v => v.name),
        },
        errorMessage: named ? undefined : `未找到表单「${params.formName}」`,
        needsReview: false,
      };
    }

    return {
      passed: formViews.length > 0,
      score: 0,
      expected: { tableName: params.tableName, viewType: 'Form' },
      actual: { tableName: params.tableName, formCount: formViews.length, forms: formViews.map(v => v.name) },
      errorMessage: formViews.length > 0 ? undefined : `表「${params.tableName}」中未找到任何表单视图`,
      needsReview: false,
    };
  },

  /**
   * 验证关联记录字段
   * params: { tableName: string, targetTable: string }
   */
  /**
   * 验证字段数量
   * params: { tableName: string, count: number }
   */
  check_field_count(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, count: params.count },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }
    const actualCount = (sheet.fields || []).length;
    return {
      passed: actualCount >= params.count,
      score: 0,
      expected: { tableName: params.tableName, count: params.count },
      actual: { tableName: params.tableName, count: actualCount },
      errorMessage: actualCount >= params.count ? undefined : `表「${params.tableName}」字段数量不足：期望至少 ${params.count} 个，实际 ${actualCount} 个`,
      needsReview: false,
    };
  },

  /**
   * 验证字段必填设置
   * params: { tableName: string, fieldName: string }
   */
  check_field_required(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, required: true },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }
    const field = findField(sheet, params.fieldName);
    if (!field) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, required: true },
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }
    const isRequired = field.required === true;
    return {
      passed: isRequired,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName, required: true },
      actual: { tableName: params.tableName, fieldName: params.fieldName, required: isRequired },
      errorMessage: isRequired ? undefined : `字段「${params.fieldName}」未设置为必填`,
      needsReview: false,
    };
  },

  /**
   * 验证公式字段（Schema 不含公式详情，标记 needsReview）
   * params: { tableName: string, fieldName: string, formula?: string }
   */
  check_field_formula(schema, params) {
    return {
      passed: false,
      score: 0,
      expected: params,
      actual: null,
      errorMessage: `公式字段验证需教师人工复核（Schema 不含公式表达式详情）`,
      needsReview: true,
    };
  },

  check_linked_record(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, targetTable: params.targetTable },
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const linkFields = (sheet.fields || []).filter(f => f.type === 'Link');
    if (params.targetTable) {
      const matching = linkFields.find(f => f.linkSheet === params.targetTable);
      return {
        passed: !!matching,
        score: 0,
        expected: { tableName: params.tableName, fieldType: 'Link', targetTable: params.targetTable },
        actual: {
          tableName: params.tableName,
          linkFields: linkFields.map(f => ({ name: f.name, linkSheet: f.linkSheet })),
        },
        errorMessage: matching
          ? undefined
          : `未找到关联到「${params.targetTable}」的关联字段`,
        needsReview: false,
      };
    }

    return {
      passed: linkFields.length > 0,
      score: 0,
      expected: { tableName: params.tableName, fieldType: 'Link' },
      actual: { tableName: params.tableName, linkFieldCount: linkFields.length },
      errorMessage: linkFields.length > 0 ? undefined : `表「${params.tableName}」中未找到关联字段`,
      needsReview: false,
    };
  },

  /**
   * 以下规则需要视图/表单/记录的详细信息，
   * 当前 Schema 不包含这些细节，标记 needsReview
   */
  check_view_filter(schema, params) {
    return {
      passed: false,
      score: 0,
      expected: params,
      actual: null,
      errorMessage: `视图筛选条件需教师人工复核（Schema 不含视图筛选详情）`,
      needsReview: true,
    };
  },

  /**
   * 验证视图排序（Schema 不含排序详情，标记 needsReview）
   */
  check_view_sort(schema, params) {
    return {
      passed: false,
      score: 0,
      expected: params,
      actual: null,
      errorMessage: `视图排序设置需教师人工复核（Schema 不含视图排序详情）`,
      needsReview: true,
    };
  },

  check_view_group(schema, params) {
    return {
      passed: false,
      score: 0,
      expected: params,
      actual: null,
      errorMessage: `视图分组设置需教师人工复核（Schema 不含视图分组详情）`,
      needsReview: true,
    };
  },

  check_form_fields(schema, params) {
    return {
      passed: false,
      score: 0,
      expected: params,
      actual: null,
      errorMessage: `表单字段配置需教师人工复核（Schema 不含表单字段详情）`,
      needsReview: true,
    };
  },

  check_form_settings(schema, params) {
    return {
      passed: false,
      score: 0,
      expected: params,
      actual: null,
      errorMessage: `表单设置需教师人工复核（Schema 不含表单设置详情）`,
      needsReview: true,
    };
  },

  check_record_exists(schema, params, records) {
    const tableRecords = records?.[params.tableName];
    if (!tableRecords) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, recordExists: true },
        actual: { tableName: params.tableName, recordData: '未获取到记录数据' },
        errorMessage: `无法获取表「${params.tableName}」的记录数据`,
        needsReview: false,
      };
    }
    const hasRecords = tableRecords.records.length > 0;
    return {
      passed: hasRecords,
      score: 0,
      expected: { tableName: params.tableName, recordExists: true },
      actual: { tableName: params.tableName, recordCount: tableRecords.records.length },
      errorMessage: hasRecords ? undefined : `表「${params.tableName}」中没有任何记录`,
      needsReview: false,
    };
  },

  check_record_value(schema, params, records) {
    const tableRecords = records?.[params.tableName];
    if (!tableRecords) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, recordData: '未获取到记录数据' },
        errorMessage: `无法获取表「${params.tableName}」的记录数据`,
        needsReview: false,
      };
    }

    // params: { tableName, fieldName, value, matchType?: 'exact' | 'contains' }
    const { fieldName, value, matchType = 'contains' } = params;
    const matchedRecords = tableRecords.records.filter(r => {
      const fieldValue = String(r.fields[fieldName] ?? '');
      const targetValue = String(value);
      if (matchType === 'exact') return fieldValue === targetValue;
      return fieldValue.includes(targetValue);
    });

    const passed = matchedRecords.length > 0;
    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, fieldName, value, matchType },
      actual: {
        tableName: params.tableName,
        totalRecords: tableRecords.records.length,
        matchedCount: matchedRecords.length,
        sample: matchedRecords.slice(0, 3).map(r => r.fields[fieldName]),
      },
      errorMessage: passed
        ? undefined
        : `表「${params.tableName}」中未找到字段「${fieldName}」${matchType === 'exact' ? '等于' : '包含'}「${value}」的记录`,
      needsReview: false,
    };
  },

  check_record_count(schema, params, records) {
    const tableRecords = records?.[params.tableName];
    if (!tableRecords) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, recordData: '未获取到记录数据' },
        errorMessage: `无法获取表「${params.tableName}」的记录数据`,
        needsReview: false,
      };
    }

    // params: { tableName, count, operator?: 'gte' | 'eq' | 'lte' }
    const actualCount = tableRecords.records.length;
    const expectedCount = params.count;
    const operator = params.operator || 'gte';

    let passed = false;
    let operatorLabel = '>=';
    if (operator === 'eq') { passed = actualCount === expectedCount; operatorLabel = '='; }
    else if (operator === 'lte') { passed = actualCount <= expectedCount; operatorLabel = '<='; }
    else { passed = actualCount >= expectedCount; operatorLabel = '>='; }

    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, count: expectedCount, operator },
      actual: { tableName: params.tableName, recordCount: actualCount },
      errorMessage: passed
        ? undefined
        : `表「${params.tableName}」记录数不满足要求：期望 ${operatorLabel} ${expectedCount}，实际 ${actualCount}`,
      needsReview: false,
    };
  },
};

// ============================================================
// 核心函数
// ============================================================

/**
 * 对单条规则进行判分
 */
function evaluateRule(schema: SchemaResponse, rule: AnswerRule, records?: RecordData): RuleResult {
  const handler = ruleHandlers[rule.action];

  if (!handler) {
    return {
      ruleId: rule.id,
      action: rule.action,
      passed: false,
      score: 0,
      maxScore: rule.score,
      expected: rule.params,
      actual: null,
      errorMessage: `未知规则类型: ${rule.action}`,
      needsReview: true,
    };
  }

  const result = handler(schema, rule.params, records);
  return {
    ruleId: rule.id,
    action: rule.action,
    maxScore: rule.score,
    ...result,
    score: result.passed ? rule.score : result.needsReview ? 0 : 0,
  };
}

/**
 * 对所有规则进行判分，返回汇总结果
 * @param records 可选的记录数据，用于记录类规则验证
 */
export function evaluateRules(
  schema: SchemaResponse,
  rules: AnswerRule[],
  records?: RecordData
): { totalScore: number; maxScore: number; results: RuleResult[] } {
  const results = rules.map(rule => evaluateRule(schema, rule, records));
  const maxScore = rules.reduce((sum, r) => sum + r.score, 0);
  const totalScore = results.reduce((sum, r) => sum + r.score, 0);

  return { totalScore, maxScore, results };
}

/**
 * 获取规则 action 的中文标签
 */
export function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    check_table_exists: '验证表存在',
    check_table_name: '验证表名称',
    check_table_count: '验证表数量',
    check_field: '验证字段',
    check_field_count: '验证字段数量',
    check_field_required: '验证必填设置',
    check_field_formula: '验证公式字段',
    check_view_exists: '验证视图存在',
    check_view_type: '验证视图类型',
    check_view_filter: '验证视图筛选',
    check_view_sort: '验证视图排序',
    check_view_group: '验证视图分组',
    check_form_exists: '验证表单存在',
    check_form_fields: '验证表单字段',
    check_form_settings: '验证表单设置',
    check_linked_record: '验证关联记录',
    check_record_exists: '验证记录存在',
    check_record_value: '验证记录值',
    check_record_count: '验证记录数',
  };
  return labels[action] || action;
}
