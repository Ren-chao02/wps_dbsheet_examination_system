/**
 * 能力图谱 — 出题辅助系统的数据地基
 *
 * 结构化描述 WPS 多维表格所有可自动判分的能力。
 * 出题人通过勾选能力 → 生成题目骨架 → 导入标准答案 → 反向生成规则。
 *
 * 能力图谱为静态 TypeScript 常量（不入库），按域分文件管理。
 *
 * @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md
 */

// ============================================================
// 类型定义
// ============================================================

/** 能力域 — 与 rule-engine 的规则分类对齐 */
export type CapabilityDomain =
  | 'tables'       // 表操作
  | 'fields'       // 字段类型
  | 'field_props'  // 字段属性
  | 'views'        // 视图配置
  | 'forms'        // 表单
  | 'records';     // 记录操作

/** 规则 action 类型 — 与 rule-engine 的 26 种 handler 1:1 对齐 */
export type RuleAction =
  // 表级（4）
  | 'check_table_exists'
  | 'check_table_name'
  | 'check_table_count'
  | 'check_table_fields'
  // 字段级（8）
  | 'check_field'
  | 'check_field_count'
  | 'check_field_required'
  | 'check_field_options'
  | 'check_field_format'
  | 'check_field_unique'
  | 'check_field_link_target'
  | 'check_field_formula'
  // 视图级（5）
  | 'check_view_exists'
  | 'check_view_type'
  | 'check_view_filter'
  | 'check_view_sort'
  | 'check_view_group'
  // 表单级（4）
  | 'check_form_exists'
  | 'check_form_fields'
  | 'check_form_field_required'
  | 'check_form_settings'
  // 记录级（5）
  | 'check_record_exists'
  | 'check_record_value'
  | 'check_record_value_exact'
  | 'check_record_count'
  | 'check_linked_record';

/**
 * 所有合法的 rule action（RuleAction 的运行时镜像）。
 * 与 rule-engine 的 ruleHandlers key 集合 1:1 对齐，
 * 供数据完整性测试与运行时校验使用。
 */
export const VALID_RULE_ACTIONS: RuleAction[] = [
  // 表级（4）
  'check_table_exists', 'check_table_name', 'check_table_count', 'check_table_fields',
  // 字段级（8）
  'check_field', 'check_field_count', 'check_field_required', 'check_field_options',
  'check_field_format', 'check_field_unique', 'check_field_link_target', 'check_field_formula',
  // 视图级（5）
  'check_view_exists', 'check_view_type', 'check_view_filter', 'check_view_sort', 'check_view_group',
  // 表单级（4）
  'check_form_exists', 'check_form_fields', 'check_form_field_required', 'check_form_settings',
  // 记录级（5）
  'check_record_exists', 'check_record_value', 'check_record_value_exact', 'check_record_count',
  'check_linked_record',
];

/** 判分方式 */
export type Scorable = 'auto' | 'manual' | 'needsReview';

/** 能力项 — 图谱的最小单元 */
export interface Capability {
  /** 唯一标识，如 'field.single_select' */
  id: string;
  /** 所属域 */
  domain: CapabilityDomain;
  /** 中文名，如"单选字段" */
  name: string;
  /** 一句话定义 */
  description: string;
  /** 对应 WPS API 概念，如 "SingleSelect"（与 rule-engine 的 WPS_TYPE_TO_CANONICAL 对齐） */
  wpsConcept: string;
  /** 判分方式 */
  scorable: Scorable;
  /** 对应 rule-engine 的 action 列表（勾选后可生成这些规则） */
  ruleActions: RuleAction[];
  /** 常见考法 */
  examPatterns: ExamPattern[];
  /** 前置能力 id */
  prerequisites?: string[];
  /** 默认难度 */
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  /** API 支持情况 */
  apiSupport?: {
    schema?: boolean;
    endpoint?: string;
    limitations?: string;
  };
  /** Phase 2 预留：给 LLM 的提示文本 */
  promptHints?: string;
}

/** 考法 — 一个能力可以有多个考法 */
export interface ExamPattern {
  /** 考法标题，如"创建单选字段并设置选项" */
  title: string;
  /** 学生要做什么 */
  description: string;
  /** 建议分值 */
  suggestedScore: number;
  /** 规则模板（null 表示人工评分） */
  ruleTemplate: RuleTemplate | null;
}

/** 规则模板 — 参数含占位符，由标准答案 Schema 填充 */
export interface RuleTemplate {
  /** rule-engine 的 action */
  action: RuleAction;
  /** 参数解析器列表 */
  paramResolvers: ParamResolver[];
}

/** 参数解析器 — 声明规则参数从哪里取值 */
export interface ParamResolver {
  /** 参数名，如 'tableName' */
  param: string;
  /** 从 Match 数据取值，如 'sheetName' / 'fieldName' / 'fieldType' / 'fieldOptions' */
  from?: string;
  /** 固定值，如 'single_select' */
  value?: string | number | boolean | string[];
}

// ============================================================
// 聚合导出
// ============================================================

import { tablesCapabilities } from './capabilities/tables';
import { fieldsCapabilities } from './capabilities/fields';
import { fieldPropsCapabilities } from './capabilities/field-props';
import { viewsCapabilities } from './capabilities/views';
import { formsCapabilities } from './capabilities/forms';
import { recordsCapabilities } from './capabilities/records';

/** 完整能力图谱（66 项，6 域） */
export const CAPABILITY_GRAPH: Capability[] = [
  ...tablesCapabilities,      // 6
  ...fieldsCapabilities,      // 29
  ...fieldPropsCapabilities,  // 6
  ...viewsCapabilities,       // 12
  ...formsCapabilities,       // 5
  ...recordsCapabilities,     // 8
];

// ============================================================
// 查询工具
// ============================================================

/** 按 id 查找能力 */
export function findCapability(id: string): Capability | undefined {
  return CAPABILITY_GRAPH.find(c => c.id === id);
}

/** 按域查询能力列表 */
export function capabilitiesByDomain(domain: CapabilityDomain): Capability[] {
  return CAPABILITY_GRAPH.filter(c => c.domain === domain);
}

/** 获取所有域 */
export const ALL_DOMAINS: CapabilityDomain[] = [
  'tables',
  'fields',
  'field_props',
  'views',
  'forms',
  'records',
];

/** 域中文名映射 */
export const DOMAIN_LABELS: Record<CapabilityDomain, string> = {
  tables: '表操作',
  fields: '字段类型',
  field_props: '字段属性',
  views: '视图配置',
  forms: '表单',
  records: '记录操作',
};
