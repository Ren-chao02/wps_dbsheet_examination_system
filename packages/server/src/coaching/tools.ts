/**
 * coaching/tools — Phase 2 §4.3
 *
 * 3 个 tool 定义 + handler，供 coaching-service 通过 LLMClient.chat(tools) 暴露给 LLM。
 *
 * 不变量：WPS accessToken 永不进 LLM。
 *   - ToolDefinition.parameters 不含 fileId/accessToken
 *   - handler 仅接收 LLM 的 args + 服务端 ctx（ctx.adapter 封装凭据）
 *   - LLM 无法通过 tool_call 传 accessToken，handler 也无从泄露
 *
 * 体积保护：
 *   - get_records 截断至 MAX_RECORDS 条 / MAX_RECORDS_BYTES 字节
 *   - get_standard_answer_schema 字段数超 MAX_FIELDS_PER_SHEET 截断
 */
import type { ToolDefinition } from '../llm/llm-client';
import { findCapability } from '../data/capability-graph';
import type { KingsoftAdapter } from '../engine/adapters/kingsoft-adapter';

// ============================================================
// 体积保护常量
// ============================================================

/** get_records 最大返回条数 */
export const MAX_RECORDS = 50;
/** get_records 最大返回字节数（8KB） */
export const MAX_RECORDS_BYTES = 8192;
/** get_standard_answer_schema 单表最大字段数 */
export const MAX_FIELDS_PER_SHEET = 200;

// ============================================================
// ToolContext — 服务端凭据封装
// ============================================================

/**
 * tool 执行上下文。adapter 封装了 fileId/accessToken，
 * LLM 无法触及 ctx，只能通过 args 传业务参数。
 */
export interface ToolContext {
  /** 已导入标准答案时构造好的 adapter；未导入为 undefined */
  adapter?: KingsoftAdapter;
}

/** tool 执行结果：成功带 result，失败带 error */
export type ToolResult = { result: any } | { error: string };

// ============================================================
// Tool 定义（传给 LLMClient.chat({ tools })）
// ============================================================

export const COACHING_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_capability_detail',
      description:
        '获取能力图谱中某个能力的完整定义（含考法 examPatterns、规则 action ruleActions、前置能力 prerequisites、给 AI 的 promptHints）。能力 id 形如 field.single_select / table.create。',
      parameters: {
        type: 'object',
        properties: {
          capabilityId: {
            type: 'string',
            description: '能力 id，如 field.single_select',
          },
        },
        required: ['capabilityId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_standard_answer_schema',
      description:
        '获取标准答案多维表格的 Schema 摘要（每张表的 name/fields[id,name,type]/views[id,name,type]）。仅当老师已导入标准答案时可用；未导入返回 available:false。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_records',
      description:
        '获取指定表的记录样本（最多 50 条 / 8KB，超出截断并附 note）。仅当老师已导入标准答案时可用。tableName 来自 get_standard_answer_schema 返回的 sheets[].name。',
      parameters: {
        type: 'object',
        properties: {
          tableName: {
            type: 'string',
            description: '表名',
          },
        },
        required: ['tableName'],
      },
    },
  },
];

// ============================================================
// Handlers
// ============================================================

type ToolHandler = (
  args: Record<string, any>,
  ctx: ToolContext,
) => Promise<ToolResult>;

/** get_capability_detail — 始终可用，查能力图谱 */
const handleGetCapabilityDetail: ToolHandler = async args => {
  const capabilityId = args?.capabilityId;
  if (!capabilityId || typeof capabilityId !== 'string') {
    return { error: '参数 capabilityId 缺失或非字符串' };
  }
  const cap = findCapability(capabilityId);
  if (!cap) {
    // 返回 found:false 让 LLM 自我纠正，而非 error
    return { result: { found: false, capabilityId } };
  }
  return { result: cap };
};

/** get_standard_answer_schema — 需 adapter，返回 Schema 摘要 */
const handleGetStandardAnswerSchema: ToolHandler = async (_args, ctx) => {
  if (!ctx.adapter) {
    return { result: { available: false, reason: '未导入标准答案' } };
  }
  const schema = await ctx.adapter.getSchema();
  const notes: string[] = [];

  const sheets = schema.detail.sheets.map(sheet => {
    const allFields = sheet.fields || [];
    let fields = allFields.map(f => ({ id: f.id, name: f.name, type: f.type }));
    if (allFields.length > MAX_FIELDS_PER_SHEET) {
      const omitted = allFields.length - MAX_FIELDS_PER_SHEET;
      fields = fields.slice(0, MAX_FIELDS_PER_SHEET);
      notes.push(
        `表「${sheet.name}」字段数 ${allFields.length} 超过 ${MAX_FIELDS_PER_SHEET}，已截断前 ${MAX_FIELDS_PER_SHEET} 个（省略 ${omitted} 个）`,
      );
    }
    const views = (sheet.views || []).map(v => ({
      id: v.id,
      name: v.name,
      type: v.type,
    }));
    return {
      id: sheet.id,
      name: sheet.name,
      primaryFieldId: sheet.primaryFieldId,
      fields,
      views,
    };
  });

  return { result: { available: true, sheets, notes } };
};

/** get_records — 需 adapter，返回记录（数量 + 字节双重截断） */
const handleGetRecords: ToolHandler = async (args, ctx) => {
  if (!ctx.adapter) {
    return { result: { available: false, reason: '未导入标准答案' } };
  }
  const tableName = args?.tableName;
  if (!tableName || typeof tableName !== 'string') {
    return { error: '参数 tableName 缺失或非字符串' };
  }

  // adapter 在表不存在时抛错（"表 X 不存在"），由 executeTool catch
  const { records, fieldsSchema } = await ctx.adapter.getRecordsByTableName(tableName);

  // 1. 按数量截断
  let truncated = false;
  let note: string | undefined;
  let working = records;

  if (working.length > MAX_RECORDS) {
    working = working.slice(0, MAX_RECORDS);
    truncated = true;
    note = `记录数超过 ${MAX_RECORDS}，已截断前 ${MAX_RECORDS} 条`;
  }

  // 2. 按字节截断（逐条移除尾部的记录直到 ≤ MAX_RECORDS_BYTES）
  while (
    working.length > 0 &&
    Buffer.byteLength(JSON.stringify(working), 'utf-8') > MAX_RECORDS_BYTES
  ) {
    working = working.slice(0, working.length - 1);
    truncated = true;
    note = `记录体积超过 ${MAX_RECORDS_BYTES} 字节，已截断至 ${working.length} 条`;
  }

  return {
    result: {
      available: true,
      tableName,
      fieldsSchema,
      records: working,
      truncated,
      note,
    },
  };
};

/** tool 名 → handler 映射 */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  get_capability_detail: handleGetCapabilityDetail,
  get_standard_answer_schema: handleGetStandardAnswerSchema,
  get_records: handleGetRecords,
};

// ============================================================
// 统一分发
// ============================================================

/**
 * 执行一个 tool_call。
 * - 未知 tool → { error: '未知工具: ...' }
 * - handler 抛错 → { error: message }（如 adapter 401、表不存在）
 * - 无凭据场景由 handler 自身返回 { result: { available: false } }
 */
export async function executeTool(
  name: string,
  args: any,
  ctx: ToolContext,
): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { error: `未知工具: ${name}` };
  }
  try {
    return await handler(args || {}, ctx);
  } catch (e: any) {
    return { error: e?.message || String(e) };
  }
}
