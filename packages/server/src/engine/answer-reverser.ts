/**
 * 标准答案反向器
 *
 * 接收标准答案的真实 Schema + 用户勾选的能力，自动推导出参数 100% 真实的 answerRules。
 * 核心思想：规则参数全部来自标准答案 Schema，而非出题人手写，根治"规则瞎编"问题。
 *
 * 架构：
 * - 6 个 CapabilityMatcher（每域一个）扫描 Schema 找到能力实例 → Match[]
 * - applyTemplate(ruleTemplate, match) 将模板的 paramResolvers 用 Match 数据填充 → AnswerRule
 * - 完全填充的规则 selected=true；缺参数的规则 selected=false 且 editable=true
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md §4.2
 */
import { KingsoftAdapter } from './adapters/kingsoft-adapter';
import type { SchemaResponse, AnswerRule } from './rule-engine';
import {
  findCapability,
  type CapabilityDomain,
  type RuleTemplate,
} from '../data/capability-graph';
import type { AddRuleProposal } from '../coaching/proposals';

// ============================================================
// 类型定义
// ============================================================

/** 反向器输入 */
export interface ReverseInput {
  /** 用户勾选的能力 id 列表 */
  capabilities: string[];
  /** 标准答案的 WPS 文件 ID */
  fileId: string;
  /** 标准答案的访问令牌 */
  accessToken: string;
  /** 可选：API 密钥（测试时注入 mock adapter 时也可用） */
  apiSecret?: string;
}

/**
 * Match — 从 Schema 中提取的能力实例数据。
 * paramResolvers 的 from 字段引用此对象的属性。
 */
export interface Match {
  /** 来源表 ID（多表同名时供前端区分） */
  sheetId: number;
  /** 表名 */
  sheetName: string;
  /** 字段名 */
  fieldName?: string;
  /** 表内全部字段名（check_table_fields 用） */
  fieldNames?: string[];
  /** 表内字段数（check_field_count 用） */
  fieldCount?: number;
  /** 字段规范类型（如 single_select） */
  fieldType?: string;
  /** 选择字段选项值列表（check_field_options 用） */
  fieldOptions?: string[];
  /** 字段格式（check_field_format 用） */
  fieldFormat?: string;
  /** 关联目标表名（check_field_link_target / check_linked_record 用） */
  linkTargetTable?: string;
  /** 视图名 */
  viewName?: string;
  /** 表单名 */
  formName?: string;
  /** 表单字段名列表（需额外 API，通常缺失） */
  formFieldNames?: string[];
  /** 记录数（需 RecordData，通常缺失） */
  recordCount?: number;
  /** 记录值（需 RecordData，通常缺失） */
  recordValue?: string | number;
  /** 对应的能力 id */
  capabilityId: string;
}

/** 规则建议 */
export interface RuleSuggestion {
  /** 完整规则（参数已填，可能部分缺失） */
  rule: AnswerRule;
  /** 规则来源信息 */
  source: {
    sheetName: string;
    sheetId: number;
    fieldName?: string;
    capabilityId: string;
  };
  /** 是否可编辑（缺参数的规则为 true） */
  editable: boolean;
  /** 默认是否勾选（完全填充 true，缺参数 false） */
  selected: boolean;
  /** 缺失的参数名列表（供前端提示） */
  missingParams: string[];
}

/** 反向器输出 */
export interface ReverseOutput {
  /** 规则建议列表 */
  suggestions: RuleSuggestion[];
  /** Schema 摘要（供前端展示） */
  schemaSummary: {
    sheets: { name: string; fieldCount: number; viewCount: number }[];
    forms: { name: string; fieldCount: number }[];
  };
  /** 提示信息 */
  notes: string[];
}

/** 能力匹配器接口 */
export interface CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[];
}

// ============================================================
// applyTemplate — 将模板用 Match 数据填充为具体规则
// ============================================================

/**
 * 判断 Match 是否包含 paramResolver 所需的字段
 */
function getMissingParams(template: RuleTemplate, match: Match): string[] {
  const missing: string[] = [];
  for (const r of template.paramResolvers) {
    if (r.from) {
      const val = (match as any)[r.from];
      if (val === undefined || val === null) {
        missing.push(r.param);
      }
    }
  }
  return missing;
}

/**
 * 将 ruleTemplate 的 paramResolvers 用 Match 数据填充，生成具体 AnswerRule
 */
function applyTemplate(template: RuleTemplate, match: Match, index: number): AnswerRule {
  const params: Record<string, any> = {};
  for (const r of template.paramResolvers) {
    if (r.from) {
      const val = (match as any)[r.from];
      if (val !== undefined && val !== null) {
        params[r.param] = val;
      }
    } else if (r.value !== undefined) {
      params[r.param] = r.value;
    }
  }

  // 生成唯一 id：capabilityId_action_sheetName[_fieldName]_index
  const idParts = [match.capabilityId, template.action, match.sheetName];
  if (match.fieldName) idParts.push(match.fieldName);
  idParts.push(String(index));

  return {
    id: idParts.join('_'),
    action: template.action,
    params,
    score: 0, // 分值由出题人在 RulePreviewer 中分配
  };
}

/**
 * 从 Match + 模板生成 RuleSuggestion
 */
function buildSuggestion(
  template: RuleTemplate,
  match: Match,
  index: number,
  forceUnselected = false,
): RuleSuggestion {
  const missing = getMissingParams(template, match);
  const rule = applyTemplate(template, match, index);
  const isComplete = missing.length === 0;
  return {
    rule,
    source: {
      sheetName: match.sheetName,
      sheetId: match.sheetId,
      fieldName: match.fieldName,
      capabilityId: match.capabilityId,
    },
    editable: !isComplete,
    selected: isComplete && !forceUnselected,
    missingParams: missing,
  };
}

// ============================================================
// 辅助函数：从 Schema 提取字段属性
// ============================================================

/** 从字段提取选项值列表（rule-engine 用 item.value） */
function extractOptions(field: any): string[] | undefined {
  const items = field.items || field.data?.items;
  if (!Array.isArray(items)) return undefined;
  return items.map((item: any) => item.value).filter((v: any) => v !== undefined);
}

/** 从字段提取格式 */
function extractFormat(field: any): string | undefined {
  return field.numberFormat || field.data?.number_format;
}

/** 解析关联字段的目标表名 */
function resolveLinkTarget(field: any, schema: SchemaResponse): string | undefined {
  const linkSheetId = field.linkSheet ?? field.data?.link_sheet;
  if (linkSheetId === undefined || linkSheetId === null) return undefined;
  const target = schema.detail.sheets.find(s => s.id === Number(linkSheetId));
  return target?.name;
}

/**
 * WPS 类型 → 规范类型映射（groundProposal 专用）。
 * 镜像 rule-engine.ts 的 WPS_TYPE_TO_CANONICAL，重复一份以遵守 Phase 2 不变量
 * 「rule-engine.ts 零改动」。若 rule-engine 映射变更，此处需同步。
 */
const WPS_TYPE_TO_CANONICAL_FOR_GROUNDING: Record<string, string> = {
  SingleLineText: 'text', MultiLineText: 'text',
  Number: 'number', Currency: 'currency', Percent: 'percent', Percentage: 'percent',
  Date: 'date', Time: 'time', Checkbox: 'checkbox', Complete: 'complete',
  Rating: 'rating', ID: 'id', Phone: 'phone', Email: 'email', Url: 'url',
  SingleSelect: 'single_select', MultipleSelect: 'multiple_select',
  Attachment: 'attachment', Link: 'link', Lookup: 'lookup', Contact: 'contact',
  Note: 'note', Address: 'address', Cascade: 'cascade',
  AutoNumber: 'auto_number', CreatedBy: 'created_by', CreatedTime: 'created_time',
  LastModifiedBy: 'last_modified_by', LastModifiedTime: 'last_modified_time',
  Formula: 'formula',
};
function canonicalTypeForGrounding(wpsType: string): string {
  return WPS_TYPE_TO_CANONICAL_FOR_GROUNDING[wpsType] || wpsType.toLowerCase();
}

// ============================================================
// 6 个域 Matcher
// ============================================================

/**
 * 表操作 Matcher
 * 每个表能力扫描 Schema 中的表，生成 Match。
 */
class TableMatcher implements CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[] {
    const cap = findCapability(capabilityId);
    if (!cap || cap.domain !== 'tables') return [];

    const sheets = schema.detail.sheets;
    const matches: Match[] = [];

    switch (capabilityId) {
      case 'table.create':
      case 'table.rename':
      case 'table.primary_field':
        // 每张表一个 Match
        for (const sheet of sheets) {
          matches.push({
            sheetId: sheet.id,
            sheetName: sheet.name,
            capabilityId,
          });
        }
        break;

      case 'table.fields_manage':
        // 每张表一个 Match，含字段名列表和数量
        for (const sheet of sheets) {
          const fields = sheet.fields || [];
          matches.push({
            sheetId: sheet.id,
            sheetName: sheet.name,
            fieldNames: fields.map(f => f.name),
            fieldCount: fields.length,
            capabilityId,
          });
        }
        break;

      case 'table.multi':
      case 'table.delete':
        // 单个 Match，表数量
        matches.push({
          sheetId: 0,
          sheetName: sheets[0]?.name || '',
          fieldCount: undefined,
          capabilityId,
        });
        // 注入 sheetCount 到自定义字段（paramResolver 用 from: 'sheetCount'）
        (matches[0] as any).sheetCount = sheets.length;
        break;
    }
    return matches;
  }
}

/**
 * 字段类型 Matcher
 * 按 wpsConcept 匹配 Schema 中的字段。
 */
class FieldMatcher implements CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[] {
    const cap = findCapability(capabilityId);
    if (!cap || cap.domain !== 'fields') return [];

    const matches: Match[] = [];
    for (const sheet of schema.detail.sheets) {
      for (const field of sheet.fields || []) {
        if (field.type !== cap.wpsConcept) continue;

        const match: Match = {
          sheetId: sheet.id,
          sheetName: sheet.name,
          fieldName: field.name,
          fieldType: field.type.toLowerCase(),
          capabilityId,
        };

        // 选择字段附带选项
        if (field.type === 'SingleSelect' || field.type === 'MultipleSelect') {
          match.fieldOptions = extractOptions(field);
        }
        // 关联字段附带目标表名
        if (field.type === 'Link') {
          match.linkTargetTable = resolveLinkTarget(field, schema);
        }

        matches.push(match);
      }
    }
    return matches;
  }
}

/**
 * 字段属性 Matcher
 * 扫描具有特定属性的字段（required/unique/format/options/formula/defaultValue）。
 */
class FieldPropMatcher implements CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[] {
    const cap = findCapability(capabilityId);
    if (!cap || cap.domain !== 'field_props') return [];

    const matches: Match[] = [];
    for (const sheet of schema.detail.sheets) {
      for (const field of sheet.fields || []) {
        const match = this.tryMatch(capabilityId, field, sheet, schema);
        if (match) matches.push(match);
      }
    }
    return matches;
  }

  private tryMatch(
    capabilityId: string,
    field: any,
    sheet: any,
    schema: SchemaResponse,
  ): Match | null {
    const base: Match = {
      sheetId: sheet.id,
      sheetName: sheet.name,
      fieldName: field.name,
      capabilityId,
    };

    switch (capabilityId) {
      case 'field_prop.required':
        if (field.required !== true) return null;
        return base;

      case 'field_prop.unique': {
        const isUnique = field.uniqueValue === true || field.data?.unique_value === true;
        if (!isUnique) return null;
        return base;
      }

      case 'field_prop.format': {
        const format = extractFormat(field);
        if (!format) return null;
        return { ...base, fieldFormat: format };
      }

      case 'field_prop.options': {
        const options = extractOptions(field);
        if (!options || options.length === 0) return null;
        return { ...base, fieldOptions: options };
      }

      case 'field_prop.formula':
        if (field.type !== 'Formula') return null;
        return base; // needsReview，template 为 null

      case 'field_prop.default_value': {
        const hasDefault = field.defaultValue !== undefined || field.data?.default_value !== undefined;
        if (!hasDefault) return null;
        return base; // needsReview，template 为 null
      }
    }
    return null;
  }
}

/**
 * 视图 Matcher
 * 按视图类型匹配，视图配置类（filter/sort/group）为 needsReview。
 */
class ViewMatcher implements CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[] {
    const cap = findCapability(capabilityId);
    if (!cap || cap.domain !== 'views') return [];

    const matches: Match[] = [];
    const viewType = cap.wpsConcept; // 'Grid' | 'Kanban' | ... | 'View'（通用）

    for (const sheet of schema.detail.sheets) {
      for (const view of sheet.views || []) {
        // view.{type} 能力：匹配特定视图类型
        if (capabilityId.startsWith('view.') && !capabilityId.startsWith('view.create')) {
          const typeName = capabilityId.split('.')[1];
          // view.filter/sort/group/hide_fields 是配置类，匹配所有视图
          if (['filter', 'sort', 'group', 'hide_fields'].includes(typeName)) {
            matches.push({
              sheetId: sheet.id,
              sheetName: sheet.name,
              viewName: view.name,
              capabilityId,
            });
          } else if (view.type === cap.wpsConcept) {
            // view.grid/kanban/gantt/calendar/gallery/form/tree
            matches.push({
              sheetId: sheet.id,
              sheetName: sheet.name,
              viewName: view.name,
              capabilityId,
            });
          }
        } else if (capabilityId === 'view.create') {
          // 通用创建视图：所有视图都算
          matches.push({
            sheetId: sheet.id,
            sheetName: sheet.name,
            viewName: view.name,
            capabilityId,
          });
        }
      }
    }
    return matches;
  }
}

/**
 * 表单 Matcher
 * 扫描 Form 类型视图。formFieldNames 需额外 API，通常缺失 → 规则标记 editable。
 */
class FormMatcher implements CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[] {
    const cap = findCapability(capabilityId);
    if (!cap || cap.domain !== 'forms') return [];

    const matches: Match[] = [];
    for (const sheet of schema.detail.sheets) {
      const formViews = (sheet.views || []).filter(v => v.type === 'Form');
      for (const form of formViews) {
        matches.push({
          sheetId: sheet.id,
          sheetName: sheet.name,
          formName: form.name,
          viewName: form.name,
          // formFieldNames 不在 Schema 中，需额外 API → 缺失
          capabilityId,
        });
      }
    }
    return matches;
  }
}

/**
 * 记录 Matcher
 * Schema-only：record.create / record.link 可完全填充；
 * record.update/filter/validate/delete/batch 缺 recordValue/recordCount → editable。
 */
class RecordMatcher implements CapabilityMatcher {
  scan(capabilityId: string, schema: SchemaResponse): Match[] {
    const cap = findCapability(capabilityId);
    if (!cap || cap.domain !== 'records') return [];

    const matches: Match[] = [];

    switch (capabilityId) {
      case 'record.create':
        // 每张表一个 Match（只需 sheetName）
        for (const sheet of schema.detail.sheets) {
          matches.push({
            sheetId: sheet.id,
            sheetName: sheet.name,
            capabilityId,
          });
        }
        break;

      case 'record.link':
        // 每个 Link 字段一个 Match（需 linkTargetTable）
        for (const sheet of schema.detail.sheets) {
          for (const field of sheet.fields || []) {
            if (field.type !== 'Link') continue;
            matches.push({
              sheetId: sheet.id,
              sheetName: sheet.name,
              fieldName: field.name,
              linkTargetTable: resolveLinkTarget(field, schema),
              capabilityId,
            });
          }
        }
        break;

      case 'record.update':
      case 'record.filter':
      case 'record.validate':
        // 每张表 × 每个字段一个 Match（recordValue 缺失）
        for (const sheet of schema.detail.sheets) {
          for (const field of sheet.fields || []) {
            matches.push({
              sheetId: sheet.id,
              sheetName: sheet.name,
              fieldName: field.name,
              capabilityId,
            });
          }
        }
        break;

      case 'record.delete':
      case 'record.batch':
        // 每张表一个 Match（recordCount 缺失）
        for (const sheet of schema.detail.sheets) {
          matches.push({
            sheetId: sheet.id,
            sheetName: sheet.name,
            capabilityId,
          });
        }
        break;

      case 'record.sort':
        // needsReview，无 template，每张表一个 Match
        for (const sheet of schema.detail.sheets) {
          matches.push({
            sheetId: sheet.id,
            sheetName: sheet.name,
            capabilityId,
          });
        }
        break;
    }
    return matches;
  }
}

// ============================================================
// AnswerReverser 主类
// ============================================================

/** 域 → Matcher 映射 */
const MATCHERS: Record<CapabilityDomain, CapabilityMatcher> = {
  tables: new TableMatcher(),
  fields: new FieldMatcher(),
  field_props: new FieldPropMatcher(),
  views: new ViewMatcher(),
  forms: new FormMatcher(),
  records: new RecordMatcher(),
};

/** 匹配项过多时，超过此阈值则默认不勾选 */
const TOO_MANY_MATCHES_THRESHOLD = 20;

export class AnswerReverser {
  /**
   * 反向生成规则
   *
   * @throws 401 透传（accessToken 过期由 KingsoftAdapter 抛出）
   */
  async reverse(input: ReverseInput): Promise<ReverseOutput> {
    const { capabilities, fileId, accessToken, apiSecret } = input;

    // 1. 获取真实 Schema（accessToken 过期会抛 401，透传）
    const adapter = new KingsoftAdapter(fileId, accessToken, apiSecret);
    const schema = await adapter.getSchema();

    // 2. 对每个勾选能力，用对应域 Matcher 扫描 Schema
    const suggestions: RuleSuggestion[] = [];
    const notes: string[] = [];

    for (const capabilityId of capabilities) {
      const cap = findCapability(capabilityId);
      if (!cap) {
        notes.push(`未知能力 id：${capabilityId}（已跳过）`);
        continue;
      }

      const matcher = MATCHERS[cap.domain];
      const matches = matcher.scan(capabilityId, schema);

      if (matches.length === 0) {
        notes.push(`能力「${cap.name}」在标准答案中未找到匹配项`);
        continue;
      }

      // 匹配项过多时默认不勾选
      const forceUnselected = matches.length > TOO_MANY_MATCHES_THRESHOLD;
      if (forceUnselected) {
        notes.push(`能力「${cap.name}」匹配到 ${matches.length} 项，已默认不勾选，请手动选择`);
      }

      // 收集该能力的去重模板（同 action 只保留首个，与 SkeletonGenerator 一致）
      const seenActions = new Set<string>();
      const templates: RuleTemplate[] = [];
      for (const pattern of cap.examPatterns) {
        if (!pattern.ruleTemplate) continue;
        const t = pattern.ruleTemplate as RuleTemplate;
        if (seenActions.has(t.action)) continue;
        seenActions.add(t.action);
        templates.push(t);
      }

      // 对每个 Match，应用每个去重模板生成建议
      let suggestionIndex = 0;
      for (const match of matches) {
        for (const template of templates) {
          // 注入 sheetCount（table.multi/delete 特殊处理）
          if (template.paramResolvers.some(r => r.from === 'sheetCount')) {
            (match as any).sheetCount = schema.detail.sheets.length;
          }
          const suggestion = buildSuggestion(
            template,
            match,
            suggestionIndex++,
            forceUnselected,
          );
          suggestions.push(suggestion);
        }
      }
    }

    // 3. 构建 schemaSummary
    const schemaSummary = this.buildSchemaSummary(schema);

    return { suggestions, schemaSummary, notes };
  }

  /**
   * 把 add_rule 建议卡意图 ground 成参数 100% 真实的 AnswerRule — Phase 2 §4.5
   *
   * 不变量：LLM 不产参数，参数全部从真实 Schema 解析。
   * 反向自测：grounded 规则用同一份 Schema 喂 rule-engine 应判分通过。
   *
   * @param proposal { action, tableName, fieldName? } — LLM 的意图，无参数
   * @param schema   本轮已取的真实 Schema
   * @param index    id 后缀，保证多次 ground 同一意图时 id 唯一
   * @returns { rule } 成功；{ error } 缺数据（表/字段不存在、类型不匹配等）
   */
  groundProposal(
    proposal: AddRuleProposal,
    schema: SchemaResponse,
    index = 0,
  ): { rule: AnswerRule } | { error: string } {
    const { action, tableName, fieldName } = proposal;

    const sheet = schema.detail.sheets.find(s => s.name === tableName);
    if (!sheet) {
      return { error: `表「${tableName}」在标准答案 Schema 中不存在` };
    }

    const fields = sheet.fields || [];
    const field = fieldName ? fields.find(f => f.name === fieldName) : undefined;

    // 字段级 action 必须能定位到字段
    if (fieldName && !field) {
      return { error: `表「${tableName}」中未找到字段「${fieldName}」` };
    }

    let params: Record<string, any>;

    switch (action) {
      case 'check_table_exists':
      case 'check_table_name':
        params = { tableName };
        break;

      case 'check_table_fields':
        params = { tableName, fields: fields.map(f => f.name) };
        break;

      case 'check_field_count':
        params = { tableName, count: fields.length };
        break;

      case 'check_field':
        params = { tableName, fieldName: fieldName!, type: canonicalTypeForGrounding(field!.type) };
        break;

      case 'check_field_required':
      case 'check_field_unique':
        params = { tableName, fieldName: fieldName! };
        break;

      case 'check_field_format': {
        const format = extractFormat(field!);
        if (!format) return { error: `字段「${fieldName}」无格式属性` };
        params = { tableName, fieldName: fieldName!, format };
        break;
      }

      case 'check_field_options': {
        if (field!.type !== 'SingleSelect' && field!.type !== 'MultipleSelect') {
          return { error: `字段「${fieldName}」不是选择字段，无选项` };
        }
        const options = extractOptions(field!);
        if (!options || options.length === 0) {
          return { error: `字段「${fieldName}」无选项` };
        }
        params = { tableName, fieldName: fieldName!, options };
        break;
      }

      case 'check_field_link_target': {
        if (field!.type !== 'Link') {
          return { error: `字段「${fieldName}」不是关联字段` };
        }
        const targetTable = resolveLinkTarget(field!, schema);
        if (!targetTable) {
          return { error: `关联字段「${fieldName}」无法解析目标表` };
        }
        params = { tableName, fieldName: fieldName!, targetTable };
        break;
      }

      default:
        return { error: `groundProposal 不支持 action「${action}」` };
    }

    const idParts = ['ai', action, tableName];
    if (fieldName) idParts.push(fieldName);
    idParts.push(String(index));

    return {
      rule: {
        id: idParts.join('_'),
        action,
        params,
        score: 0, // 分值由老师在 RulePreviewer 分配
      },
    };
  }

  /** 构建 Schema 摘要供前端展示 */
  private buildSchemaSummary(schema: SchemaResponse): ReverseOutput['schemaSummary'] {
    const sheets = schema.detail.sheets.map(sheet => ({
      name: sheet.name,
      fieldCount: (sheet.fields || []).length,
      viewCount: (sheet.views || []).length,
    }));

    const forms: { name: string; fieldCount: number }[] = [];
    for (const sheet of schema.detail.sheets) {
      const formViews = (sheet.views || []).filter(v => v.type === 'Form');
      for (const form of formViews) {
        forms.push({
          name: form.name,
          fieldCount: (sheet.fields || []).length, // 近似：用表字段数
        });
      }
    }

    return { sheets, forms };
  }
}

/** 单例导出 */
export const answerReverser = new AnswerReverser();
