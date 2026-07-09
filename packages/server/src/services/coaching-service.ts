/**
 * coaching-service — Phase 2 §3.2 / §4 编排核心
 *
 * 一轮对话的完整流程：
 *   建上下文 → 调 LLM（流式）→ 检测 ```proposals fence 并剥离 → 执行 tool_call → 循环
 *   → 解析 proposals 块 → 逐条校验 → add_rule 就地 ground → 输出
 *
 * 流式事件：delta（文字增量，已剥离 proposals 块）/ proposals（最终建议卡）/ done / error。
 *
 * 不变量：
 *   - accessToken 永不进 LLM（ctx.adapter 封装凭据，tool handler 本地执行）
 *   - LLM 永不产出规则参数（add_rule 卡只带意图，groundProposal 从真实 Schema 解析）
 */
import type { LLMClient, ChatMessage, ToolCall } from '../llm/llm-client';
import type { ToolContext } from '../coaching/tools';
import { COACHING_TOOLS, executeTool } from '../coaching/tools';
import { buildMessages, buildValidationContext } from '../coaching/context-builder';
import { parseProposalsBlock, type QuestionState } from '../llm/prompt-templates';
import { validateProposal, type Proposal } from '../coaching/proposals';
import type { AnswerReverser } from '../engine/answer-reverser';
import type { SchemaResponse } from '../engine/adapters/kingsoft-adapter';

// ============================================================
// 常量
// ============================================================

const DEFAULT_MAX_TOOL_ROUNDS = 5;
const PROPOSALS_FENCE = '```proposals';
const FENCE_TAIL = PROPOSALS_FENCE.length - 1; // 持留尾部长度，防 fence 跨 delta 被漏检

// ============================================================
// 类型
// ============================================================

export interface CoachingStreamEvent {
  type: 'delta' | 'proposals' | 'done' | 'error';
  /** delta 事件：文字增量（已剥离 proposals 块） */
  text?: string;
  /** proposals 事件：已校验+已 ground 的建议卡 */
  proposals?: Proposal[];
  /** proposals 事件：解析/校验/grounding 备注 */
  notes?: string[];
  /** done 事件：token 用量 */
  usage?: { promptTokens: number; completionTokens: number };
  /** error 事件：错误信息 */
  message?: string;
}

export interface RunCoachingParams {
  questionState: QuestionState;
  history: ChatMessage[];
  ctx: ToolContext;
  client: LLMClient;
  answerReverser: AnswerReverser;
  /** 最大 tool 执行轮次，默认 5 */
  maxToolRounds?: number;
}

// ============================================================
// 主流程
// ============================================================

export async function* runCoachingChat(
  params: RunCoachingParams,
): AsyncIterable<CoachingStreamEvent> {
  const { questionState, history, ctx, client, answerReverser } = params;
  const maxToolRounds = params.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const hasStandardAnswer = !!ctx.adapter;

  const validationCtx = buildValidationContext(questionState);
  const messages = buildMessages({ questionState, history, hasStandardAnswer });

  // 流式 + fence 检测状态
  let fullText = ''; // LLM 完整输出（含 proposals 块，供解析）
  let emitBuffer = ''; // 待安全发射的缓冲（持留尾部防 fence 跨 delta）
  let fenceDetected = false;
  let lastUsage = { promptTokens: 0, completionTokens: 0 };
  let cachedSchema: SchemaResponse | null = null;

  // ---- 流式 fence 检测：发射 fence 之前的文字，fence 之后的内容只进 fullText 不发射 ----
  const processDelta = (delta: string): string => {
    if (fenceDetected) return '';
    emitBuffer += delta;
    const idx = emitBuffer.indexOf(PROPOSALS_FENCE);
    if (idx === -1) {
      // 未发现 fence：发射除尾部 FENCE_TAIL 字符外的内容（防部分 fence）
      const safeLen = Math.max(0, emitBuffer.length - FENCE_TAIL);
      const toEmit = emitBuffer.slice(0, safeLen);
      emitBuffer = emitBuffer.slice(safeLen);
      return toEmit;
    }
    // 命中 fence：发射 fence 之前的文字，切换到缓冲模式
    const toEmit = emitBuffer.slice(0, idx);
    emitBuffer = '';
    fenceDetected = true;
    return toEmit;
  };

  const flushEmit = (): string => {
    if (fenceDetected) return '';
    const toEmit = emitBuffer;
    emitBuffer = '';
    return toEmit;
  };

  // ---- grounding 用 Schema 缓存（避免每条 add_rule 都拉一次）----
  const getSchemaForGrounding = async (): Promise<SchemaResponse | null> => {
    if (!ctx.adapter) return null;
    if (cachedSchema) return cachedSchema;
    cachedSchema = await ctx.adapter.getSchema();
    return cachedSchema;
  };

  try {
    let toolRounds = 0;
    let stopped = false;

    while (!stopped) {
      let roundText = '';
      let roundToolCalls: ToolCall[] = [];
      let finishReason: string | undefined;

      for await (const chunk of client.chat({ messages, tools: COACHING_TOOLS })) {
        if (chunk.delta) {
          fullText += chunk.delta;
          roundText += chunk.delta;
          const toEmit = processDelta(chunk.delta);
          if (toEmit) yield { type: 'delta', text: toEmit };
        }
        if (chunk.toolCalls) roundToolCalls = chunk.toolCalls;
        if (chunk.usage) lastUsage = chunk.usage;
        if (chunk.finishReason) {
          finishReason = chunk.finishReason;
          break;
        }
      }

      if (finishReason === 'error') {
        yield { type: 'error', message: 'LLM 返回 error 状态' };
        return;
      }

      if (finishReason === 'tool_calls' && roundToolCalls.length > 0) {
        toolRounds++;
        if (toolRounds > maxToolRounds) {
          yield {
            type: 'error',
            message: `LLM tool_call 轮次超过上限 ${maxToolRounds}`,
          };
          return;
        }
        // 追加 assistant 消息（含 toolCalls）+ 每条 tool 结果
        messages.push({
          role: 'assistant',
          content: roundText,
          toolCalls: roundToolCalls,
        });
        for (const tc of roundToolCalls) {
          const args = resolveToolArgs(tc.arguments);
          const result = await executeTool(tc.name, args, ctx);
          const content =
            'error' in result
              ? JSON.stringify({ error: result.error })
              : JSON.stringify(result.result);
          messages.push({ role: 'tool', content, toolCallId: tc.id });
        }
        // 继续下一轮 LLM 调用
      } else {
        // stop / length / undefined → 结束循环
        stopped = true;
      }
    }

    // 冲刷残余缓冲（无 fence 时尾部文字尚未发射）
    const flushed = flushEmit();
    if (flushed) yield { type: 'delta', text: flushed };

    // ---- 解析 proposals 块 ----
    const { proposals: rawProposals, notes } = parseProposalsBlock(fullText);
    const validProposals: Proposal[] = [];
    const allNotes = [...notes];

    let addRuleIndex = 0;
    for (const raw of rawProposals) {
      if (!raw || typeof raw !== 'object' || !raw.type) {
        allNotes.push('已忽略无效建议：缺少 type 字段或非对象');
        continue;
      }
      let proposal = raw as Proposal;

      // add_rule：先 ground（需要真实 Schema），再校验
      if (proposal.type === 'add_rule') {
        if (!ctx.adapter) {
          allNotes.push(
            `已丢弃 add_rule 建议（action=${proposal.action}）：未导入标准答案，无法 grounding`,
          );
          continue;
        }
        const schema = await getSchemaForGrounding();
        if (!schema) {
          allNotes.push(
            `已丢弃 add_rule 建议（action=${proposal.action}）：无法获取 Schema`,
          );
          continue;
        }
        const groundResult = answerReverser.groundProposal(
          proposal,
          schema,
          addRuleIndex++,
        );
        if ('error' in groundResult) {
          allNotes.push(
            `已丢弃 add_rule 建议（action=${proposal.action}, tableName=${proposal.tableName}）：${groundResult.error}`,
          );
          continue;
        }
        proposal = { ...proposal, groundedRule: groundResult.rule };
      }

      // 结构性校验
      const validation = validateProposal(proposal, validationCtx);
      if (!validation.ok) {
        allNotes.push(`已忽略无效建议：${validation.reason}`);
        continue;
      }
      validProposals.push(proposal);
    }

    yield { type: 'proposals', proposals: validProposals, notes: allNotes };
    yield { type: 'done', usage: lastUsage };
  } catch (e: any) {
    yield { type: 'error', message: e?.message || String(e) };
  }
}

// ============================================================
// 辅助
// ============================================================

/** toolCall.arguments 可能是对象（正常）或字符串（JSON 损坏回退），统一解析为对象 */
function resolveToolArgs(raw: Record<string, any> | string): Record<string, any> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw || {};
}
