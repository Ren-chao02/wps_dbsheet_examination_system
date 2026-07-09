/**
 * prompt-templates — Phase 2 §4.7
 *
 * 系统提示构建 + proposals 块解析。
 * 系统提示含：角色 / 题目状态 / 能力图谱摘要 / 工具清单 / 建议卡规则 / 回复格式。
 */
import { CAPABILITY_GRAPH } from '../data/capability-graph';
import { ADD_RULE_WHITELIST } from '../coaching/proposals';

// ============================================================
// 类型
// ============================================================

/**
 * 题目状态（前端 QuestionEditor 现场拼装）。
 * 服务端用于：① 注入系统提示 ② 构造 validateProposal 的 ValidationContext。
 */
export interface QuestionState {
  title: string;
  description: string;
  type: string;
  difficulty: string;
  score: number;
  selectedCapabilityIds: string[];
  /** 当前 suggestions + rules 的精简视图（供 LLM 知道已有规则） */
  currentRules: Array<{
    id: string;
    action: string;
    tableName?: string;
    fieldName?: string;
    score: number;
  }>;
  hints?: string;
}

// ============================================================
// 能力图谱摘要
// ============================================================

/**
 * 构建能力图谱摘要：每项一行 `id | name | domain | scorable | promptHints`。
 * 约 5KB，始终内联进系统提示（不做 tool，因为每轮都要让 LLM 看见全貌）。
 */
export function buildCapabilitySummary(): string {
  const lines = CAPABILITY_GRAPH.map(cap => {
    const parts = [
      cap.id,
      cap.name,
      cap.domain,
      typeof cap.scorable === 'string' ? cap.scorable : '',
    ];
    if (cap.promptHints) parts.push(cap.promptHints);
    return parts.join(' | ');
  });
  return lines.join('\n');
}

// ============================================================
// 系统提示
// ============================================================

const ADD_RULE_WHITELIST_STR = Array.from(ADD_RULE_WHITELIST).join(' / ');

/**
 * 构建系统提示。
 * @param params.questionState 当前题目状态
 * @param params.hasStandardAnswer 是否已导入标准答案（未导入时给降级提示）
 */
export function buildSystemPrompt(params: {
  questionState: QuestionState;
  hasStandardAnswer?: boolean;
}): string {
  const { questionState: qs, hasStandardAnswer = true } = params;
  const capabilitySummary = buildCapabilitySummary();

  return `你是 WPS 多维表格实操题的出题教练，帮助老师打磨题目、补全考点、调整规则分值。你不是自动出题器，而是与老师对话的编辑搭档。

【当前题目状态】
${JSON.stringify(qs, null, 2)}

【能力图谱（66 项，6 域）】
每行格式：id | 中文名 | 域 | 判分方式 | promptHints
${capabilitySummary}

【可用工具】
- get_capability_detail(capabilityId)：查某个能力的完整定义（考法、规则 action、前置能力）
- get_standard_answer_schema()：取标准答案多维表格的 Schema 摘要（表/字段/视图）
- get_records(tableName)：取指定表的记录样本（最多 50 条 / 8KB）
工具调用由服务端执行，你只需按需发起 tool_call。未导入标准答案时，schema/records 工具会返回 {available:false}。

【建议卡规则】
1. 确有价值才提建议，每条都必须带 reason 说明为何这样改。
2. add_rule 卡仅支持以下白名单 action：
   ${ADD_RULE_WHITELIST_STR}
3. add_rule 卡只给「意图」：action + tableName + fieldName?（字段级才带 fieldName）。**不要给任何规则参数**（type/options/format/unique/linkTarget 等都由服务端从标准答案 Schema 解析，你给了也会被忽略）。
4. 视图类 / 表单类 / 记录值类规则**不要提**（grounding 有歧义，本期不支持）。
5. add_capability 的 capabilityId 必须来自上面的能力图谱；rewrite_description 要与当前不同；adjust_score / remove_rule 的 ruleId 必须来自当前题目状态里的 currentRules。

【回复格式】
先给老师一段自然语言文字（解释你的建议），最后用一个 \`\`\`proposals 代码块返回 JSON 数组。无建议时给 []。每条建议卡结构：
- {"type":"add_capability","capabilityId":"...","reason":"..."}
- {"type":"rewrite_description","newDescription":"...","reason":"..."}
- {"type":"adjust_score","ruleId":"...","newScore":10,"reason":"..."}
- {"type":"remove_rule","ruleId":"...","reason":"..."}
- {"type":"add_hint","hint":"...","reason":"..."}
- {"type":"add_rule","action":"check_field","tableName":"...","fieldName":"...","reason":"..."}

示例：
这题可以再补一个单选字段考点，让选项校验更完整。
\`\`\`proposals
[{"type":"add_rule","action":"check_field_options","tableName":"考勤表","fieldName":"状态","reason":"补充选项校验"}]
\`\`\`${
    hasStandardAnswer
      ? ''
      : '\n\n【注意】老师尚未导入标准答案，schema/records 工具不可用，add_rule 类建议不可用（无法 grounding）。请只给 add_capability / rewrite_description / add_hint 等非规则类建议，并引导老师先导入标准答案。'
  }`;
}

// ============================================================
// proposals 块解析
// ============================================================

/** 匹配 ```proposals ... ``` 代码块（非贪婪，取第一个） */
const PROPOSALS_BLOCK_RE = /```proposals\s*\n([\s\S]*?)\n```/;

/**
 * 从 LLM 回复文本中解析 proposals 块。
 *
 * @returns proposals 解析出的建议卡数组（未校验，未 ground）；displayText 剥离块后的展示文本；notes 解析备注
 */
export function parseProposalsBlock(text: string): {
  proposals: any[];
  displayText: string;
  notes: string[];
} {
  const match = text.match(PROPOSALS_BLOCK_RE);
  if (!match) {
    return {
      proposals: [],
      displayText: text,
      notes: ['LLM 回复未包含 proposals 建议卡块'],
    };
  }

  const raw = match[1].trim();
  const fullMatch = match[0];
  // 剥离块，清理多余空行
  const displayText = text
    .replace(fullMatch, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      proposals: [],
      displayText,
      notes: ['proposals 块 JSON 解析失败，已丢弃'],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      proposals: [],
      displayText,
      notes: ['proposals 块不是数组，已丢弃'],
    };
  }

  return { proposals: parsed, displayText, notes: [] };
}
