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
  filter?: any;
  sort?: any;
  group?: any;
  fieldsAttribute?: { field: string; hidden: boolean }[];
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
  OneWayLink: 'one_way_link',
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
// 视图筛选/排序/分组 解析辅助（兼容 v3/v7 常见结构）
// ============================================================

/** 从单个筛选条目中取字段引用（field / field_id / fieldId） */
function filterItemField(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  if (typeof item.field === 'string') return item.field;
  if (typeof item.field_id === 'string') return item.field_id;
  if (typeof item.fieldId === 'string') return item.fieldId;
  if (typeof item.fieldName === 'string') return item.fieldName;
  return undefined;
}

/** 提取单个筛选条目的比对值（values / value / criteria.values） */
function filterItemValues(item: any): string[] {
  if (!item) return [];
  // 兼容 v7: { criteria: { op, values: [{ type, value }] } }
  if (item.criteria && typeof item.criteria === 'object') {
    const cv = item.criteria.values;
    if (Array.isArray(cv)) {
      return cv.map((v: any) => {
        if (v !== null && typeof v === 'object') return String(v.value !== undefined ? v.value : v);
        return String(v);
      });
    }
    if (item.criteria.value !== undefined && item.criteria.value !== null) {
      return [String(item.criteria.value)];
    }
  }
  const v = item.values;
  if (Array.isArray(v)) return v.map(String);
  if (item.value !== undefined && item.value !== null) return [String(item.value)];
  return [];
}

/** 提取单个筛选条目的操作符（operator / criteria.op） */
function filterItemOperator(item: any): string {
  if (!item) return '';
  if (item.criteria && typeof item.criteria === 'object') {
    return String(item.criteria.op || item.criteria.operator || '').toLowerCase();
  }
  return String(item.operator || item.condition || '').toLowerCase();
}

/** 将视图 filter 原始结构规范化为筛选条目数组 */
function filterItemsOf(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const arr = raw.criteria || raw.conditions || raw.items;
  if (Array.isArray(arr)) return arr;
  // 兼容 { mode, filters: [...] }
  if (Array.isArray(raw.filters)) return raw.filters;
  return [];
}

/** 将视图 sort 原始结构规范化为排序条件数组 */
function sortConditionsOf(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const arr = raw.conditions || raw.sortBy || raw.items;
  if (Array.isArray(arr)) return arr;
  return [];
}

function normOrderValue(o: any): string {
  return String(o || '').toLowerCase();
}

/** 操作符匹配：兼容 expected '>=' 与 v7 的 GreaterEqu / GreatOrEquals 等别名 */
function operatorMatches(actualOp: string, wantedOp: string): boolean {
  const a = String(actualOp || '').toLowerCase();
  const w = String(wantedOp || '').toLowerCase();
  if (!w) return true;
  if (a.includes(w)) return true;
  const ALIASES: Record<string, string[]> = {
    '>=': ['greater', 'gte', 'ge', '>=', 'at least', 'no less'],
    '<=': ['less', 'lte', 'le', '<=', 'at most'],
    '>': ['greater', 'gt'],
    '<': ['less', 'lt'],
    '=': ['equal', 'is', 'eq', 'equals'],
    '!=': ['notequal', 'neq', 'not equal'],
    'contains': ['contain', 'includes', 'has'],
    'in': ['in'],
  };
  const cands = ALIASES[w] || [];
  return cands.some(c => a.includes(c.toLowerCase()));
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
   * 验证公式字段
   * v7 Schema 会在 field.data.formula 暴露公式表达式，可据此自动判分。
   * params: {
   *   tableName: string,
   *   fieldName: string,
   *   contains?: string[]  // 公式字符串必须包含的子串（去空、忽略大小写）
   * }
   * 说明：公式写法多样，此处做"关键词包含"级校验，不做逐字等价比对。
   */
  check_field_formula(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, contains: params.contains },
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
        expected: { tableName: params.tableName, fieldName: params.fieldName, contains: params.contains },
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }
    if (canonicalType(field.type) !== 'formula') {
      return {
        passed: false,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, type: 'formula' },
        actual: { tableName: params.tableName, fieldName: params.fieldName, type: canonicalType(field.type) },
        errorMessage: `字段「${params.fieldName}」不是公式字段`,
        needsReview: false,
      };
    }

    const formula = String(field.data?.formula ?? field.formula ?? '').trim();
    const tokens: string[] = (params.contains || []).map((t: any) => String(t).toLowerCase());
    if (!formula) {
      return {
        passed: false,
        score: 0,
        expected: { fieldName: params.fieldName, contains: params.contains },
        actual: { fieldName: params.fieldName, formula: null },
        errorMessage: `公式字段「${params.fieldName}」缺少公式表达式`,
        needsReview: false,
      };
    }
    if (!tokens.length) {
      return { passed: true, score: 0, expected: params, actual: { formula }, needsReview: false };
    }

    const lower = formula.toLowerCase();
    const missing = tokens.filter(t => !lower.includes(t));
    return {
      passed: missing.length === 0,
      score: 0,
      expected: { fieldName: params.fieldName, contains: params.contains },
      actual: { fieldName: params.fieldName, formula, missingTokens: missing },
      errorMessage: missing.length ? `公式缺少关键词: ${missing.join(', ')}` : undefined,
      needsReview: false,
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
   * 验证视图筛选条件
   * params: { tableName, viewName?, criteria?: {field, operator?, values?}[], minCriteria?: number }
   * criteria 中的每个条件都需在视图筛选中被满足（字段 + 值匹配）；minCriteria 校验至少 N 个条件。
   */
  check_view_filter(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const allViews = sheet.views || [];
    const targetViews = params.viewName
      ? allViews.filter(v => v.name === params.viewName)
      : allViews.filter(v => !!v.filter);
    if (params.viewName && targetViews.length === 0) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, viewName: params.viewName, found: false },
        errorMessage: `视图「${params.viewName}」不存在`,
        needsReview: false,
      };
    }

    const reqCriteria: any[] = params.criteria || [];
    const minCriteria = params.minCriteria || 0;

    const criteriaCovered = (view: any, expected: any) => {
      const items = filterItemsOf(view.filter);
      return items.some(it => {
        if (filterItemField(it) !== expected.field) return false;
        if (expected.operator) {
          if (!operatorMatches(filterItemOperator(it), expected.operator)) return false;
        }
        const wantValues = filterItemValues(expected);
        if (wantValues.length === 0) return true;
        const haveValues = filterItemValues(it);
        return wantValues.every(w => haveValues.some(h => h === w || h.includes(w) || w.includes(h)));
      });
    };

    const matchedView = targetViews.find(view => {
      const itemCount = filterItemsOf(view.filter).length;
      if (itemCount < Math.max(minCriteria, reqCriteria.length)) return false;
      return reqCriteria.every(c => criteriaCovered(view, c));
    });

    const actualFilters = targetViews.map((v: any) => ({
      viewName: v.name,
      filter: v.filter || undefined,
    }));

    return {
      passed: !!matchedView,
      score: 0,
      expected: {
        tableName: params.tableName,
        viewName: params.viewName,
        criteria: reqCriteria,
        minCriteria,
      },
      actual: { tableName: params.tableName, viewFilters: actualFilters },
      errorMessage: matchedView
        ? undefined
        : (params.viewName
            ? `视图「${params.viewName}」未满足筛选条件 ${JSON.stringify(reqCriteria)}`
            : `表「${params.tableName}」中没有视图满足筛选条件 ${JSON.stringify(reqCriteria)}`),
      needsReview: false,
    };
  },

  /**
   * 验证视图排序规则
   * params: { tableName, viewName?, sortBy?: {field, order?: 'asc'|'desc'}[] }
   * sortBy 中的排序条件需按顺序出现在视图排序中。
   */
  check_view_sort(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const allViews = sheet.views || [];
    const targetViews = params.viewName
      ? allViews.filter(v => v.name === params.viewName)
      : allViews.filter(v => !!v.sort);
    if (params.viewName && targetViews.length === 0) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, viewName: params.viewName, found: false },
        errorMessage: `视图「${params.viewName}」不存在`,
        needsReview: false,
      };
    }

    const reqSort: any[] = params.sortBy || [];

    const matchedView = targetViews.find(view => {
      const conds = sortConditionsOf(view.sort);
      if (conds.length < reqSort.length) return false;
      return reqSort.every((wanted, i) => {
        const actual = conds[i];
        if (!actual) return false;
        if (filterItemField(actual) !== wanted.field) return false;
        if (!wanted.order) return true;
        // v7 sort 条件用 is_ascending 布尔；v3 用 order/direction/type
        let actualOrder: string;
        if (typeof actual.is_ascending === 'boolean') {
          actualOrder = actual.is_ascending ? 'asc' : 'desc';
        } else {
          actualOrder = normOrderValue(actual.order || actual.direction || actual.type);
        }
        return actualOrder.includes(normOrderValue(wanted.order));
      });
    });

    const actualSorts = targetViews.map((v: any) => ({
      viewName: v.name,
      sort: v.sort || undefined,
    }));

    return {
      passed: !!matchedView,
      score: 0,
      expected: { tableName: params.tableName, viewName: params.viewName, sortBy: reqSort },
      actual: { tableName: params.tableName, viewSorts: actualSorts },
      errorMessage: matchedView
        ? undefined
        : (params.viewName
            ? `视图「${params.viewName}」未满足排序规则 ${JSON.stringify(reqSort)}`
            : `表「${params.tableName}」中没有视图满足排序规则 ${JSON.stringify(reqSort)}`),
      needsReview: false,
    };
  },

  check_view_group(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const allViews = sheet.views || [];
    // 若指定 viewName 只在该视图内找分组；否则在表内所有视图中找任一含分组配置的视图
    const targetViews = params.viewName
      ? allViews.filter(v => v.name === params.viewName)
      : allViews;
    if (params.viewName && targetViews.length === 0) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, viewName: params.viewName, found: false },
        errorMessage: `视图「${params.viewName}」不存在`,
        needsReview: false,
      };
    }

    const groupMatchesField = (group: any, field: string): boolean => {
      if (!group) return false;
      const conditions = group.conditions || (Array.isArray(group) ? group : null);
      if (conditions) {
        return (conditions as any[]).some((c: any) => c && (c.field === field || c.field_id === field));
      }
      // 兼容直接以 group.field / group.fieldName 表示
      return group.field === field || group.fieldName === field;
    };

    const hasGroup = params.groupByField
      ? targetViews.some(v => groupMatchesField(v.group, params.groupByField))
      : targetViews.some(v => !!v.group);

    const expected = {
      tableName: params.tableName,
      viewName: params.viewName,
      groupByField: params.groupByField,
    };
    const actual = {
      tableName: params.tableName,
      matchedViews: targetViews
        .filter(v => !!v.group)
        .map(v => ({
          viewName: v.name,
          viewType: v.type,
          group: v.group,
        })),
    };

    return {
      passed: hasGroup,
      score: 0,
      expected,
      actual,
      errorMessage: hasGroup
        ? undefined
        : (params.viewName
            ? `视图「${params.viewName}」未按「${params.groupByField || '任意字段'}」分组`
            : `表「${params.tableName}」中没有任何视图配置分组${params.groupByField ? `（需要按「${params.groupByField}」分组）` : ''}`),
      needsReview: false,
    };
  },

  /**
   * 验证视图中的字段显示/隐藏状态
   * params: { tableName, viewName?, hiddenFields?: string[], visibleFields?: string[] }
   * hiddenFields 要求这些字段在视图中被隐藏；visibleFields 要求这些字段在视图中显示。
   */
  check_view_field_hidden(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const allViews = sheet.views || [];
    const targetViews = params.viewName
      ? allViews.filter(v => v.name === params.viewName)
      : allViews;
    if (params.viewName && targetViews.length === 0) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, viewName: params.viewName, found: false },
        errorMessage: `视图「${params.viewName}」不存在`,
        needsReview: false,
      };
    }

    const reqHidden: string[] = params.hiddenFields || [];
    const reqVisible: string[] = params.visibleFields || [];

    const matchedView = targetViews.find((v: any) => {
      const fa = v.fieldsAttribute || [];
      const hiddenSet = new Set(fa.filter((x: any) => x.hidden).map((x: any) => x.field));
      const visibleSet = new Set(fa.filter((x: any) => !x.hidden).map((x: any) => x.field));
      // 字段未出现在 attributes 中视为“未隐藏”（可见），因此只要求显式列为 hidden 的匹配即可
      if (reqHidden.some(f => !hiddenSet.has(f))) return false;
      if (reqVisible.length > 0 && fa.length === 0) return false;
      if (reqVisible.some(f => !visibleSet.has(f))) return false;
      return true;
    });

    const visibility = targetViews
      .filter((v: any) => v.fieldsAttribute)
      .map((v: any) => ({
        viewName: v.name,
        hiddenFields: (v.fieldsAttribute || []).filter((x: any) => x.hidden).map((x: any) => x.field),
        visibleFields: (v.fieldsAttribute || []).filter((x: any) => !x.hidden).map((x: any) => x.field),
      }));

    return {
      passed: !!matchedView,
      score: 0,
      expected: {
        tableName: params.tableName,
        viewName: params.viewName,
        hiddenFields: reqHidden,
        visibleFields: reqVisible,
      },
      actual: { tableName: params.tableName, viewFieldVisibility: visibility },
      errorMessage: matchedView
        ? undefined
        : (params.viewName
            ? `视图「${params.viewName}」未按要求隐藏字段 ${JSON.stringify(reqHidden)}`
            : `表「${params.tableName}」没有任何视图按要求隐藏字段 ${JSON.stringify(reqHidden)}`),
      needsReview: false,
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

  /**
   * 验证字段默认值
   * params: { tableName, fieldName, defaultValue?, defaultType? }
   * defaultValue 缺省时仅要求字段配置了默认值；否则要求默认值包含该字符串。
   */
  check_field_default(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
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
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `表「${params.tableName}」中未找到字段「${params.fieldName}」`,
        needsReview: false,
      };
    }

    const data = field.data || {};
    const actualValue = field.defaultValue ?? data.default_value ?? data.defaultValue ?? data.defValue;
    const actualType = field.defaultValueType ?? data.default_value_type ?? data.defaultValueType;
    const hasDefault = actualValue !== undefined && actualValue !== null && actualValue !== '';

    const passed = params.defaultValue
      ? hasDefault && String(actualValue).includes(String(params.defaultValue))
      : hasDefault && (params.defaultType
          ? String(actualType || '').toLowerCase().includes(String(params.defaultType).toLowerCase())
          : true);

    return {
      passed: !!passed,
      score: 0,
      expected: {
        tableName: params.tableName,
        fieldName: params.fieldName,
        defaultValue: params.defaultValue,
        defaultType: params.defaultType,
      },
      actual: {
        tableName: params.tableName,
        fieldName: params.fieldName,
        defaultValue: actualValue ?? null,
        defaultType: actualType ?? null,
      },
      errorMessage: passed
        ? undefined
        : (params.defaultValue
            ? `字段「${params.fieldName}」的默认值不是「${params.defaultValue}」`
            : `字段「${params.fieldName}」未配置默认值`),
      needsReview: false,
    };
  },

  /**
   * 验证选择字段的选项值
   * params: { tableName, fieldName, options[], matchMode?: 'exact' | 'contains' }
   */
  check_field_options(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
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
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }

    const fieldItems = field.items || (field.data?.items as any[]) || [];
    const actualOptions = fieldItems.map((item: any) => item.value);
    const expectedOptions = params.options as string[];
    const matchMode = params.matchMode || 'exact';

    let passed: boolean;
    if (matchMode === 'exact') {
      passed = actualOptions.length === expectedOptions.length &&
        expectedOptions.every(opt => actualOptions.includes(opt));
    } else {
      passed = expectedOptions.every(opt => actualOptions.includes(opt));
    }

    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName, options: expectedOptions },
      actual: { tableName: params.tableName, fieldName: params.fieldName, options: actualOptions },
      errorMessage: passed ? undefined : `字段「${params.fieldName}」选项不匹配：期望 ${JSON.stringify(expectedOptions)}，实际 ${JSON.stringify(actualOptions)}`,
      needsReview: false,
    };
  },

  /**
   * 验证字段格式（数字/日期/时间）
   * params: { tableName, fieldName, format }
   */
  check_field_format(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
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
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }

    const actualFormat = field.numberFormat || field.data?.number_format || '';
    const expectedFormat = params.format as string;
    const passed = actualFormat.includes(expectedFormat) || expectedFormat.includes(actualFormat);

    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName, format: expectedFormat },
      actual: { tableName: params.tableName, fieldName: params.fieldName, format: actualFormat },
      errorMessage: passed ? undefined : `字段「${params.fieldName}」格式不匹配：期望 ${expectedFormat}，实际 ${actualFormat}`,
      needsReview: false,
    };
  },

  /**
   * 验证字段唯一约束
   * params: { tableName, fieldName }
   */
  check_field_unique(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
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
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }

    const isUnique = field.uniqueValue === true || field.data?.unique_value === true;

    return {
      passed: isUnique,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName, unique: true },
      actual: { tableName: params.tableName, fieldName: params.fieldName, unique: isUnique },
      errorMessage: isUnique ? undefined : `字段「${params.fieldName}」未开启唯一约束`,
      needsReview: false,
    };
  },

  /**
   * 验证关联目标表
   * params: { tableName, fieldName, targetTable }
   */
  check_field_link_target(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
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
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }

    const linkSheetId = field.linkSheet || field.data?.link_sheet;
    if (!linkSheetId) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, type: field.type, linkSheet: null },
        errorMessage: `字段「${params.fieldName}」不是关联字段`,
        needsReview: false,
      };
    }

    const targetSheet = schema.detail.sheets.find(s => s.id === Number(linkSheetId));
    const targetTableName = targetSheet?.name;
    const expectedTarget = params.targetTable as string;
    const passed = targetTableName === expectedTarget || String(linkSheetId) === expectedTarget;

    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName, targetTable: expectedTarget },
      actual: { tableName: params.tableName, fieldName: params.fieldName, linkSheetId, targetTableName },
      errorMessage: passed ? undefined : `关联字段「${params.fieldName}」目标表不匹配：期望 ${expectedTarget}，实际 ${targetTableName || 'ID: ' + linkSheetId}`,
      needsReview: false,
    };
  },

  /**
   * 验证关联字段"允许多条记录"开关
   * v7 Schema：双向关联(Link)会在 data.multiple_links 暴露该开关（默认关闭，勾选后为 true）；
   * 单向关联(OneWayLink)不暴露字段 data，开关无法验证（此时 needsReview=true）。
   * params: { tableName, fieldName, multiple: boolean } // multiple 默认 true
   */
  check_field_link_multiple(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
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
        expected: params,
        actual: { tableName: params.tableName, fieldName: params.fieldName, found: false },
        errorMessage: `字段「${params.fieldName}」不存在`,
        needsReview: false,
      };
    }

    const type = canonicalType(field.type);
    const expected = params.multiple !== false;
    const actual = field.data?.multiple_links ?? field.multipleLinks ?? null;

    if (type === 'link' && actual !== null) {
      return {
        passed: actual === expected,
        score: 0,
        expected: { tableName: params.tableName, fieldName: params.fieldName, multipleLinks: expected },
        actual: { tableName: params.tableName, fieldName: params.fieldName, multipleLinks: actual },
        errorMessage: actual === expected ? undefined : `关联字段「${params.fieldName}」允许多条记录=${actual}，期望 ${expected}`,
        needsReview: false,
      };
    }

    return {
      passed: false,
      score: 0,
      expected: { tableName: params.tableName, fieldName: params.fieldName, multipleLinks: expected },
      actual: { tableName: params.tableName, fieldName: params.fieldName, type, multipleLinks: actual },
      errorMessage: `关联字段「${params.fieldName}」为${type}类型，'允许多条记录'开关无法从 schema 自动验证，需人工复核`,
      needsReview: true,
    };
  },

  /**
   * 验证表单字段配置（使用表单字段API返回的数据）
   * params: { tableName, formName, fields[] }
   * 注意：需要 grading-service 通过 KingsoftAdapter.getFormFields() 预获取表单字段数据
   */
  check_form_fields(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const formViews = (sheet.views || []).filter(v => v.type === 'Form');
    const targetForm = params.formName
      ? formViews.find(v => v.name === params.formName)
      : formViews[0];

    if (!targetForm) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, formName: params.formName, availableForms: formViews.map(v => v.name) },
        errorMessage: `未找到表单「${params.formName || '(任意)'}`,
        needsReview: false,
      };
    }

    const formFields = params.formFields as any[] | undefined;
    if (!formFields) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, formName: targetForm.name, formId: targetForm.id },
        errorMessage: `表单字段配置需通过额外API获取，标记为待复核`,
        needsReview: true,
      };
    }

    const expectedFields = params.fields as string[];
    const actualFieldTitles = formFields.map((f: any) => f.title);
    const actualFieldIds = formFields.map((f: any) => f.field_id);
    const allFieldsPresent = expectedFields.every((ef: string) =>
      actualFieldTitles.includes(ef) || actualFieldIds.includes(ef)
    );

    return {
      passed: allFieldsPresent,
      score: 0,
      expected: { tableName: params.tableName, formName: targetForm.name, fields: expectedFields },
      actual: { tableName: params.tableName, formName: targetForm.name, fields: actualFieldTitles },
      errorMessage: allFieldsPresent ? undefined : `表单「${targetForm.name}」缺少字段：${expectedFields.filter((ef: string) => !actualFieldTitles.includes(ef) && !actualFieldIds.includes(ef)).join(', ')}`,
      needsReview: false,
    };
  },

  /**
   * 验证表单字段必填设置
   * params: { tableName, formName, fieldName, required }
   */
  check_form_field_required(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const formViews = (sheet.views || []).filter(v => v.type === 'Form');
    const targetForm = params.formName
      ? formViews.find(v => v.name === params.formName)
      : formViews[0];

    if (!targetForm) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, formName: params.formName },
        errorMessage: `未找到表单「${params.formName || '(任意)'}`,
        needsReview: false,
      };
    }

    const formFields = params.formFields as any[] | undefined;
    if (!formFields) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, formName: targetForm.name },
        errorMessage: `表单字段数据需通过额外API获取`,
        needsReview: true,
      };
    }

    const targetField = formFields.find((f: any) => f.title === params.fieldName || f.field_id === params.fieldName);
    if (!targetField) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, formName: targetForm.name, fieldName: params.fieldName, availableFields: formFields.map((f: any) => f.title) },
        errorMessage: `表单中未找到字段「${params.fieldName}」`,
        needsReview: false,
      };
    }

    const isRequired = targetField.required === true;
    const expectedRequired = params.required === true;

    return {
      passed: isRequired === expectedRequired,
      score: 0,
      expected: { tableName: params.tableName, formName: targetForm.name, fieldName: params.fieldName, required: expectedRequired },
      actual: { tableName: params.tableName, formName: targetForm.name, fieldName: params.fieldName, required: isRequired },
      errorMessage: isRequired === expectedRequired ? undefined : `表单字段「${params.fieldName}」必填设置不匹配：期望 ${expectedRequired}，实际 ${isRequired}`,
      needsReview: false,
    };
  },

  /**
   * 验证记录值精确匹配
   * params: { tableName, fieldName, value }
   */
  check_record_value_exact(schema, params, records) {
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

    const { fieldName, value } = params;
    const matchedRecords = tableRecords.records.filter(r => {
      const fieldValue = r.fields[fieldName];
      return String(fieldValue ?? '') === String(value);
    });

    const passed = matchedRecords.length > 0;
    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, fieldName, value },
      actual: { tableName: params.tableName, fieldName, matchedCount: matchedRecords.length, totalRecords: tableRecords.records.length },
      errorMessage: passed ? undefined : `表「${params.tableName}」中未找到字段「${fieldName}」值为「${value}」的记录`,
      needsReview: false,
    };
  },

  /**
   * 验证表包含所有指定字段
   * params: { tableName, fields[] }
   */
  check_table_fields(schema, params) {
    const sheet = findSheet(schema.detail.sheets, params.tableName);
    if (!sheet) {
      return {
        passed: false,
        score: 0,
        expected: params,
        actual: { tableName: params.tableName, found: false },
        errorMessage: `表「${params.tableName}」不存在`,
        needsReview: false,
      };
    }

    const expectedFields = params.fields as string[];
    const actualFieldNames = (sheet.fields || []).map(f => f.name);
    const missingFields = expectedFields.filter(ef => !actualFieldNames.includes(ef));
    const passed = missingFields.length === 0;

    return {
      passed,
      score: 0,
      expected: { tableName: params.tableName, fields: expectedFields },
      actual: { tableName: params.tableName, fields: actualFieldNames, missingFields },
      errorMessage: passed ? undefined : `表「${params.tableName}」缺少字段：${missingFields.join(', ')}`,
      needsReview: false,
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
    check_field_options: '验证字段选项',
    check_field_format: '验证字段格式',
    check_field_unique: '验证唯一约束',
    check_field_link_target: '验证关联目标表',
    check_field_link_multiple: '验证关联允许多条',
    check_table_fields: '验证表字段完整性',
    check_view_exists: '验证视图存在',
    check_view_type: '验证视图类型',
    check_view_filter: '验证视图筛选',
    check_view_sort: '验证视图排序',
    check_view_group: '验证视图分组',
    check_view_field_hidden: '验证视图字段显隐',
    check_field_default: '验证字段默认值',
    check_form_exists: '验证表单存在',
    check_form_fields: '验证表单字段',
    check_form_field_required: '验证表单字段必填',
    check_form_settings: '验证表单设置',
    check_linked_record: '验证关联记录',
    check_record_exists: '验证记录存在',
    check_record_value: '验证记录值',
    check_record_value_exact: '验证记录值精确匹配',
    check_record_count: '验证记录数',
  };
  return labels[action] || action;
}
