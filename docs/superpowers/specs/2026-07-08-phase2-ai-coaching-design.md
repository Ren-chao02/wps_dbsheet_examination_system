# Spec: 考试出题辅助系统（Phase 2 — AI 对话式教练）

**创建日期**: 2026-07-08
**状态**: 待审阅
**作者**: brainstorming session
**关联**: [Phase 1 spec](./2026-07-07-exam-authoring-assist.md)（已实现）、Phase 3（视图/表单/记录值规则的 AI 建议扩展）预留

***

## 1. 背景与现状基线

### 1.1 Phase 1 已交付

* 能力图谱 66 项（6 域）：`tables`(6) / `fields`(29) / `field_props`(6) / `views`(12) / `forms`(5) / `records`(8)

* 题目骨架生成器、标准答案反向器（6 个 Matcher）、三段式 UI（CapabilitySelector / AnswerImporter / RulePreviewer）

* rule-engine 26 个 action、grading-service 端到端判分链路

* `Capability.promptHints` 字段**已全部填充**真实提示文本

### 1.2 经核实的现状（与 Phase 1 spec 的出入）

| 项                           | Phase 1 spec 说 | 实际                                                                             |
| --------------------------- | -------------- | ------------------------------------------------------------------------------ |
| 能力项总数                       | 67             | **66**（fields 29 而非 30）                                                        |
| rule action 数               | 25             | **26**                                                                         |
| `AnswerRule` 形状             | （未细述）          | `{ id; action; params; score }`                                                |
| `AnswerReverser` 可校准 LLM 草稿 | §7 预留          | **无此入口**，`reverse()` 只走 capability→schema→rules。Phase 2 需新增 `groundProposal()` |
| `SkeletonGenerator` 可替换     | §7 预留          | 具体类单例，路由层替换即可，无 DI 接口                                                          |
| 现有 LLM/AI 集成                | —              | **无**，全新引入                                                                     |

### 1.3 Phase 2 要解决的核心痛点

Phase 1 解决了"规则瞎编"和"不知道能考什么"，但出题仍是"勾能力→做标准答案→反向生成→逐条确认"的机械流程，缺少**对话式打磨**：出题人想要一个看着自己题目和标准答案、能给出可执行建议的编辑搭档。

### 1.4 关键约束（本次 brainstorming 确认）

* **形态**：对话式打磨（chat 侧栏，LLM 当编辑搭档，非 autonomous 草稿生成器）

* **AI 上下文**：题目状态 + 能力图谱 + 标准答案 Schema + 记录数据（最激进 grounding；标准答案是老师编的示范数据，敏感性低）

* **Provider**：多 provider 可配（`LLMClient` 抽象，env 切换，前期接 DeepSeek）

* **题型范围**：仅实操题，挂在 QuestionEditor 三段式旁

***

## 2. 目标与非目标

### 2.1 目标

1. **对话式打磨**：老师在实操题编辑页与 AI 对话，AI 给文字建议 + 可一键应用的结构化「建议卡」
2. **接地气建议**：AI 通过 tool-calling 按需读标准答案 Schema/记录，建议有据可依
3. **零参数瞎编**：LLM 永不产出规则参数；`add_rule` 卡只带意图，参数由 `groundProposal` 从真实 Schema 解析
4. **零判分侧改动**：rule-engine / grading-service / AnswerRule 格式完全不动
5. **provider 可换**：env 切换，不锁定厂商

### 2.2 非目标

* ❌ **不 autonomous 生成整题草稿**（用户选了对话式打磨，非一键出题）

* ❌ **不支持视图/表单/记录值规则的 AI 建议**（grounding 有歧义，留 Phase 3）

* ❌ **不覆盖选择题/填空题**（仅实操题）

* ❌ **不让 AI 直接静默改题目**（每条改动都要老师点【应用】）

* ❌ **不持久化对话历史**（UI 临时态；如需留存另起 feature）

***

## 3. 整体架构

### 3.1 总览

在 [QuestionEditor.tsx](file:///data/wps_dbsheet_examination_system/packages/client/src/pages/teacher/QuestionEditor.tsx) 三段式旁加一个 **CoachingPanel**（AntD Drawer）。老师与 AI 对话，AI 通过 tool-calling 按需读上下文，回文字 + 结构化「建议卡」，老师点【应用】一键改编辑器状态。

```
QuestionEditor.tsx（既有，扩展）
├── BasicInfoSection / CapabilitySelector / AnswerImporter / RulePreviewer（既有，不动）
└── CoachingPanel（新增）← 仅 type==='practical' 渲染
    ├── MessageList          （user / ai 消息，流式渲染）
    ├── ProposalCardList     （结构化建议卡，每张带【应用】）
    └── Composer             （输入 + 发送 + 停止）

server/src/
├── routes/coaching.ts            （新增）POST /api/coaching/chat（SSE 流式）
├── services/coaching-service.ts  （新增）编排：建上下文→调 LLM→执行 tool→解析建议卡→ground→校验
├── llm/
│   ├── llm-client.ts             （新增）LLMClient 接口（chat + tools + stream）
│   ├── providers/
│   │   ├── openai-compatible.ts  （DeepSeek/Qwen/GLM/Ollama-OpenAI 走 openai SDK）
│   │   └── ollama.ts             （本地原生，后期）
│   └── prompt-templates.ts       （新增）系统提示构建
├── coaching/
│   ├── tools.ts                  （新增）tool 定义 + handler
│   ├── proposals.ts              （新增）建议卡类型 + 校验
│   └── context-builder.ts        （新增）题目状态 → LLM context
└── engine/answer-reverser.ts     （扩展）新增 groundProposal()
```

### 3.2 一轮对话的数据流

以老师问"看看我这题还能怎么完善"为例：

1. **前端** POST `/api/coaching/chat`，body = `{ questionState, history, fileId?, accessToken? }`

   * `questionState` = 标题/描述/已选能力/已生成 suggestions/已应用 rules/难度/分值

   * `fileId/accessToken` 仅在已导入标准答案时带
2. **coaching-service** 建系统提示（角色 + 66 项能力图谱摘要 + tool 清单），调 `LLMClient.chat({ messages, tools, stream })`
3. **LLM 发 tool\_calls**（如 `get_standard_answer_schema()`、`get_records("员工表")`）

   * 服务端**本地**执行（复用 [KingsoftAdapter](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/adapters/kingsoft-adapter.ts)），**accessToken 永不出服务端、永不进 LLM**；只把数据结果喂回 LLM

   * 循环直到 LLM 产出最终内容
4. **LLM 最终内容** = 给老师的文字 + 尾部一个 ` ```proposals ` JSON 块（跨 provider 兼容约定）
5. **服务端**解析 JSON 块 → 逐条校验建议卡 → **`add_rule`** **卡此时就地 ground**（调 `groundProposal` 用真实 Schema 填参数）→ 校验/ground 失败的卡丢弃并附 note
6. **SSE 流式**推给前端：文字 delta 边来边显；最终一个 event 带 `proposals[]`
7. 前端渲染文字 + 建议卡。老师点【应用】：

   * `add_capability` / `rewrite_description` / `adjust_score` / `remove_rule` / `add_hint` → **纯前端**改 QuestionEditor 状态

   * `add_rule` → 卡里已是 ground 好的完整 `AnswerRule`，**纯前端**加入 suggestions/rules
8. 改动反映到三段式 UI，老师继续聊

**端点极简**：只有一个 `POST /api/coaching/chat`（流式）。【应用】是前端状态变更，无需额外端点（ground 在第 5 步就做完了，避免 apply 时二次往返）。

### 3.3 三条铁的不变量

1. **WPS accessToken 永不进 LLM** — 服务端本地取 Schema/记录，只把数据给 LLM（沿用 grading-service 的安全模式）
2. **LLM 永不产出规则参数** — `add_rule` 卡只带「意图」(action + 实体引用)，参数由 `groundProposal` 从真实 Schema 解析。继承 Phase 1「参数 100% 真实」
3. **rule-engine / grading-service / AnswerRule 格式零改动** — Phase 1 判分链路完全不动

### 3.4 上下文策略

* **始终塞系统提示**（不做成 tool）：题目状态（小）+ 66 项能力摘要（id/name/domain/scorable/promptHints，\~5KB）

* **走 tool-calling 按需拉**：Schema / 记录（可能大），避免每轮全量塞

* **无标准答案降级**：若老师还没导入标准答案，AI 无法 ground → `add_rule` 卡被抑制，但仍可给 `add_capability` / `rewrite_description` 等建议。自然引导老师走 Phase 1 流程顺序

***

## 4. 后端详细设计

### 4.1 LLMClient 抽象（多 provider）

```typescript
// packages/server/src/llm/llm-client.ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
export interface ToolCall { id: string; name: string; arguments: Record<string, any>; }
export interface ChatChunk {
  delta?: string;                              // 文本增量（流式）
  toolCalls?: ToolCall[];                      // 工具调用请求
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
  usage?: { promptTokens: number; completionTokens: number };
}
export interface LLMClient {
  readonly provider: string;
  chat(params: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    temperature?: number;
    maxTokens?: number;
  }): AsyncIterable<ChatChunk>;
}
```

工厂按 env 选 provider：`deepseek` / `qwen` / `glm` / `ollama`。MVP 只实装 `OpenAICompatibleClient`（用 `openai` SDK，覆盖 DeepSeek/Qwen/GLM/Ollama 的 OpenAI 兼容端点），`OllamaClient` 留接口后期补。

### 4.2 配置（.env 新增，沿用既有 config 模式）

```
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-...
LLM_BASE_URL=              # 可选，自托管 OpenAI 兼容端点时覆盖
LLM_MODEL=deepseek-chat
LLM_TEMPERATURE=0.4
LLM_MAX_TOKENS=2048
LLM_TIMEOUT_MS=60000
LLM_RATE_LIMIT_PER_MIN=20  # 每老师限流
```

### 4.3 Tool 清单（3 个，按需拉）

| Tool                         | 参数             | 返回                                             | Handler                                   | 何时可用    |
| ---------------------------- | -------------- | ---------------------------------------------- | ----------------------------------------- | ------- |
| `get_capability_detail`      | `capabilityId` | 完整能力（含 examPatterns/ruleActions/prerequisites） | `findCapability`                          | 始终      |
| `get_standard_answer_schema` | —              | sheets/fields/views 摘要                         | `KingsoftAdapter.getSchema()`             | 已导入标准答案 |
| `get_records`                | `tableName`    | 该表记录                                           | `KingsoftAdapter.getRecordsByTableName()` | 已导入标准答案 |

**体积保护**：`get_records` 截断至 50 条 / 8KB，超出附 note；`get_standard_answer_schema` 字段数超 200 截断。防 token 爆炸。

### 4.4 建议卡协议

```typescript
// packages/server/src/coaching/proposals.ts
export type Proposal =
  | { type: 'add_capability'; capabilityId: string; reason: string }
  | { type: 'rewrite_description'; newDescription: string; reason: string }
  | { type: 'adjust_score'; ruleId: string; newScore: number; reason: string }
  | { type: 'remove_rule'; ruleId: string; reason: string }
  | { type: 'add_hint'; hint: string; reason: string }
  | { type: 'add_rule'; action: RuleAction; tableName: string; fieldName?: string; reason: string };
```

LLM 回复格式约定（跨 provider）：先给老师文字，尾部一个 ` ```proposals ` JSON 数组块。服务端解析后剥离该块、逐条校验：

| 卡类型                            | 校验                                |
| ------------------------------ | --------------------------------- |
| `add_capability`               | id 在图谱内、未已选                       |
| `rewrite_description`          | 非空且与当前不同                          |
| `adjust_score` / `remove_rule` | ruleId 在当前 suggestions/rules 内    |
| `add_hint`                     | 非空                                |
| `add_rule`                     | action ∈ 白名单、tableName 在 Schema 内 |

**`add_rule`** **白名单**（MVP 只支持能从 Schema 确定性 ground 的字段级/表级 action）：
`check_field` / `check_field_options` / `check_field_required` / `check_field_unique` / `check_field_format` / `check_field_link_target` / `check_table_exists` / `check_table_name` / `check_table_fields` / `check_field_count`

视图/表单/记录值/记录数/关联记录规则**不支持**（grounding 有歧义：需 viewName/formName/或从记录里挑值）。AI 在系统提示里被明确告知不要提这类卡；若提了，校验丢弃并附 note。Phase 3 可扩。

### 4.5 groundProposal 算法（扩展 [answer-reverser.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/answer-reverser.ts)）

```typescript
groundProposal(
  proposal: { action: RuleAction; tableName: string; fieldName?: string },
  schema: SchemaResponse,        // 本轮已取，复用避免再拉
): { rule: AnswerRule } | { error: string }
```

1. 在 schema 中找 sheet（严格按 tableName，找不到返回 error）
2. 按 action 从真实 schema 解析参数（**复用** **[answer-reverser.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/answer-reverser.ts)** **已有的** **`extractOptions`/`extractFormat`/`resolveLinkTarget`** **等辅助函数**）：

   * 字段类：定位 fieldName → 解析 type(canonicalType)/options/format/unique/linkTarget

   * 表类：解析 tableName/sheetCount/fieldNames/fieldCount
3. 生成 AnswerRule（id 沿用 `applyTemplate` 的 `capabilityId_action_sheet[_field]_idx` 模式），score=0 待老师分配
4. 任一步缺数据 → `{ error }`，该卡丢弃并附 note

**编排细节**：本轮若有 `add_rule` 卡且 schema 尚未取（AI 没调 tool），orchestrator 用 fileId/token 取一次 schema 再 ground。正常情况 AI 提 add\_rule 前必已调过 `get_standard_answer_schema`，schema 已在手。

### 4.6 路由

唯一端点 `POST /api/coaching/chat`（SSE 流式，需教师鉴权）：

请求：`{ questionState, history[], fileId?, accessToken? }`
响应事件流：

* `event: delta` → `{ text }` 文本增量

* `event: proposals` → `{ proposals: Proposal[], notes: string[] }` 最终建议卡（已 ground、已校验）

* `event: done` → `{ usage }`

* `event: error` → `{ message }`

**限流**：每教师 `LLM_RATE_LIMIT_PER_MIN`（默认 20）轮，超限 429。fileId/accessToken 仅存请求内存，不持久化（沿用 Phase 1 token 安全模式）。

### 4.7 系统提示结构

````
你是 WPS 多维表格实操题出题教练…
【当前题目状态】{questionState JSON}
【能力图谱 66 项】{id/name/domain/scorable/promptHints 摘要}
【工具】get_capability_detail / get_standard_answer_schema / get_records
【建议卡规则】
- 确有价值才提，每条带 reason
- add_rule 仅白名单 action；只给 action+tableName+fieldName?，参数系统从标准答案解析，你不要给参数
- 视图/表单/记录值规则不要提
【回复格式】先文字，最后 ```proposals JSON 块；无建议给 []
````

***

## 5. 前端详细设计

### 5.1 组件树

```
QuestionEditor.tsx（扩展）
├── 既有三段式（不动）
├── CoachingPanel（新增，挂 AntD Drawer，"AI 教练"按钮触发）  ← 仅 type==='practical' 渲染
│   ├── Header（标题 + 未导入标准答案警告 banner）
│   ├── MessageList
│   │   ├── UserMessage
│   │   └── AiMessage（流式文字 + 挂在该消息下的 ProposalCardList）
│   ├── ProposalCardList
│   │   └── ProposalCard（类型化渲染 + 【应用】【忽略】）
│   └── Composer（输入框 + 发送 + 流式时的【停止】）
└── 类型补充到 types.ts
```

**形态选 Drawer**（右侧 \~480px，浮动按钮触发）：对既有单列 `maxWidth:1000` 布局零侵入，老师按需召出/收起，符合"侧栏搭档"定位。

### 5.2 建议卡应用 handler（QuestionEditor 持有，下传 CoachingPanel）

`add_rule` 卡在服务端已 ground，到前端时带 `groundedRule: AnswerRule`。应用 = 把它包成 `RuleSuggestion` 追加进 `suggestions`（自动出现在第③段，selected=true 待老师分配分值）：

```typescript
function applyProposal(p: Proposal): { ok: boolean; reason?: string } {
  switch (p.type) {
    case 'add_capability':
      if (selectedCapabilityIds.includes(p.capabilityId)) return { ok: false, reason: '已选' };
      setSelectedCapabilityIds([...selectedCapabilityIds, p.capabilityId]);
      return { ok: true };
    case 'rewrite_description':
      form.setFieldsValue({ description: p.newDescription }); return { ok: true };
    case 'add_hint':
      const cur = form.getFieldValue('hints') || '';
      form.setFieldsValue({ hints: cur + (cur ? '\n' : '') + p.hint }); return { ok: true };
    case 'adjust_score':                                 // ruleId 在 suggestions 或 rules 里
      return mutateRuleById(p.ruleId, r => ({ ...r, score: p.newScore }));
    case 'remove_rule':
      return removeRuleById(p.ruleId);
    case 'add_rule':                                     // 已 ground
      setSuggestions([...suggestions, {
        rule: p.groundedRule,
        source: { sheetName: p.tableName, sheetId: 0, fieldName: p.fieldName, capabilityId: '' },
        editable: false, selected: true, missingParams: [],
      }]);
      return { ok: true };
  }
}
```

`mutateRuleById` / `removeRuleById` 先查 `suggestions`（按 `rule.id`）再查 `rules`，兼顾"未应用"与"已应用"两种。

### 5.3 流式客户端（补到 [api.ts](file:///data/wps_dbsheet_examination_system/packages/client/src/services/api.ts)）

axios 不适合 SSE，新增 `coachingApi` 用 fetch + ReadableStream（JWT 仍从 localStorage 取）：

```typescript
export const coachingApi = {
  chat: (params, { onDelta, signal }: { onDelta: (t: string)=>void; signal: AbortSignal }) =>
    fetch('/api/coaching/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: JSON.stringify(params), signal,
    }).then(async (res) => {
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      let buf = '', proposals: Proposal[] = [], notes: string[] = [];
      // 解析 SSE：按空行分块，提取 event:/data: 行
      // delta → onDelta(text)；proposals → 收集；done/error → 结束
      // ...（~30 行手写 SSE parser，避免引新依赖）
      return { proposals, notes };
    }),
};
```

### 5.4 QuestionEditor 接线与小重构

1. **上提凭据**：QuestionEditor 新增 `const [credentials, setCredentials] = useState<Credentials>()`；[AnswerImporter.tsx](file:///data/wps_dbsheet_examination_system/packages/client/src/pages/teacher/components/AnswerImporter.tsx) 加 `onCredentialsChange(creds)` 回调（Form 变更时触发），不再独占凭据。CoachingPanel 与反向生成都用这份。
2. **构建 questionState**：每轮发送前从 `form.getFieldsValue()` + `selectedCapabilityIds` + `suggestions` + `rules` 现场拼装，保证 AI 看到最新状态（含刚应用的卡）。
3. **挂载点**：QuestionEditor 末尾加 `<CoachingPanel questionState={...} credentials={credentials} onApplyProposal={applyProposal} />`，内部自管 Drawer 开合。
4. **门控**：`type === 'practical'` 才渲染 CoachingPanel（与三段式同一门控；当前 [QuestionEditor.tsx](file:///data/wps_dbsheet_examination_system/packages/client/src/pages/teacher/QuestionEditor.tsx) 三段式是无条件渲染，实现时一并加门控）。

### 5.5 CoachingPanel 内部状态与 UX

* `messages: { id, role, text }[]`、`proposalsByMsg: Map<id, {proposal, status}[]>`（status: pending/applied/dismissed）、`input`、`streaming`、`abortController`

* **空态**：占位语 + 三个建议提问（"看看这题还能怎么完善" / "帮我补一个单选字段考点" / "描述写得更地道点"）一键发送

* **流式中**：打字指示 + 【停止】（abort AbortController）

* **无标准答案**：顶部 banner「未导入标准答案，AI 看不到你的表，规则类建议不可用」

* **已应用卡**：标 ✓ 已应用、置灰；【忽略】移除该卡

* **历史**：`history` 只回传每条消息的文字 `{role, content}`，proposals 不回传（UI 临时态，保持简单）

### 5.6 新增前端文件

```
packages/client/src/pages/teacher/components/
├── CoachingPanel.tsx           （新增）
├── ProposalCard.tsx            （新增，类型化渲染）
└── （AnswerImporter.tsx 改：加 onCredentialsChange）
packages/client/src/types.ts    （加 Proposal/ChatMessage/QuestionState/CoachingResponse）
packages/client/src/services/api.ts  （加 coachingApi）
```

***

## 6. 错误处理与边界

| 场景                                                     | 处理                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| LLM 不可达/超时                                             | `LLM_TIMEOUT_MS` 触发 abort → error event「AI 暂不可用」；前端可重试           |
| LLM 回复无 proposals 块 / JSON 损坏                          | 当作无建议卡，文字照常显示，附 note                                             |
| LLM 幻觉（白名单外 action / 不存在 capabilityId / 不存在 tableName） | 校验阶段丢弃，附 note「已忽略无效建议：…」                                         |
| grounding 失败（字段不存在/缺数据）                                | `groundProposal` 返回 `{error}`，该卡丢弃 + note                        |
| accessToken 过期 / WPS 401                               | tool 调用透传 401；CoachingPanel 提示「令牌过期，请重新导入」；AI 降级不再提 add\_rule    |
| 无标准答案                                                  | schema/records tool 返回 `{available:false}`；AI 仅给非规则类建议；顶部 banner |
| 记录过大                                                   | `get_records` 截断 50 条/8KB + note                                 |
| 限流（>20 轮/分）                                            | 429 + 前端提示                                                       |
| 流式中断（网络/abort）                                         | 保留已收文字，标「已中断」，可重发                                                |
| env 配置错误（缺 API\_KEY）                                   | 启动 config 校验；调用抛 500「AI 服务未配置」                                   |
| 竞态（AI 回复前老师手改状态）                                       | questionState 每轮现取；应用时按最新状态校验，失败给 reason                         |
| LLM 调用未定义 tool                                         | 仅注册 3 个 tool，未知 tool\_call 回「未知工具」结果                             |

***

## 7. 测试策略

| 层                       | 测什么                                                                           | mock                     |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------ |
| **LLMClient 契约**        | 固定 chunks（delta+tool\_calls+stop）下，service 正确循环/聚合/执行 tool/产 proposals；超时处理   | fake LLMClient           |
| **Tool handler**        | get\_capability\_detail 合法/非法；schema 有/无凭据/401；records 截断（>50 条）              | mock KingsoftAdapter     |
| **建议卡校验**               | 每类型合法/非法；白名单外 action 丢；已选 capability 丢；不存在的 ruleId 丢                          | —                        |
| **groundProposal**      | 字段类正确解析 type/options/format/unique/linkTarget；表类正确；字段不存在→{error}；与反向器既有辅助函数一致 | mock schema              |
| **coaching-service 集成** | 端到端一轮（提问→调 tool→返 add\_rule→ground→校验→输出）；降级路径；proposals 块解析（正常/缺块/损坏）        | mock LLMClient + adapter |
| **路由**                  | 401；429 限流；SSE 事件格式；fileId/accessToken 不写库                                    | mock service             |
| **前端**                  | applyProposal 各类型正确 mutate；SSE parser 解析 delta/proposals/error；竞态失败显示         | —                        |

**不测**：真实 LLM 调用、真实 WPS API（沿用 Phase 1 mock 做法）。

***

## 8. Phase 1 不变量保护

| 不变量                    | 保护                                         | 验证                  |
| ---------------------- | ------------------------------------------ | ------------------- |
| rule-engine.ts 零改动     | coaching 不 import 进 rule-engine            | 既有测试全过              |
| grading-service.ts 零改动 | coaching 不进判分链路                            | 既有测试全过              |
| AnswerRule 格式不变        | groundProposal 复用 `rule-engine.AnswerRule` | 类型同源                |
| 参数 100% 真实             | LLM 不产参数，groundProposal 从 schema 解析        | groundProposal 测试断言 |
| accessToken 不持久化       | 路由不写库、日志 redact token                      | 路由测试 + 日志审查         |
| 非实操题不受影响               | CoachingPanel 门控 `type==='practical'`      | 前端测试                |

**回归基线**：Phase 1 既有测试（capability-graph 完整性 / skeleton-generator / answer-reverser / reverse-rules 路由）全过 = PR 合并门槛。

***

## 9. 实现顺序

| 步骤 | 内容                                                | 依赖      |
| -- | ------------------------------------------------- | ------- |
| 1  | config + env（`LLM_*`）+ .env.example               | 无       |
| 2  | LLMClient 接口 + OpenAICompatibleClient + 契约测试      | 1       |
| 3  | coaching/tools.ts（3 tool 定义+handler）+ 测试          | 1       |
| 4  | coaching/proposals.ts（类型+校验）+ 测试                  | 无       |
| 5  | answer-reverser.groundProposal() + 测试（复用既有辅助函数）   | 4       |
| 6  | coaching/context-builder.ts + prompt-templates.ts | 3,4     |
| 7  | coaching-service.ts（编排）+ 集成测试                     | 2,3,5,6 |
| 8  | routes/coaching.ts（SSE+鉴权+限流）+ 路由测试               | 7       |
| 9  | 前端 types + coachingApi（SSE parser）+ 测试            | 8       |
| 10 | ProposalCard + CoachingPanel + applyProposal      | 9       |
| 11 | AnswerImporter 凭据上提 + QuestionEditor 接线 + 门控      | 10      |
| 12 | 端到端手测（接 DeepSeek）+ 回归 Phase 1                     | 全部      |

***

## 10. 验收标准

1. 实操题编辑页打开 AI 教练 Drawer，对话流式返回
2. AI 通过 tool-calling 读标准答案 Schema/记录，给有依据的建议
3. 建议卡一键应用，正确反映到三段式 UI
4. `add_rule` 卡应用后 AnswerRule 参数 100% 来自真实 Schema（标准答案自测，rule-engine 判分通过）
5. 无标准答案时降级：仅非规则类建议 + banner
6. accessToken 不进 LLM 请求、不写库（日志审查）
7. LLM provider 可 env 切换（DeepSeek 配置跑通）
8. Phase 1 既有测试全过、判分链路无回归
9. 非实操题不渲染 CoachingPanel

***

## 11. Phase 3 预留

* **扩展** **`add_rule`** **白名单**：视图类（需 viewName）、表单类（需 formName）、记录值类（需从记录挑值的策略）的 grounding 算法

* **OllamaClient 原生实装**：数据零出境场景

* **对话历史持久化**：跨会话保留打磨记录（当前为 UI 临时态）

* **AI 解释规则**：选某条规则让 AI 解释为何这样判分（教学复盘场景）

***

## 12. 参考资料

* Phase 1 spec：[2026-07-07-exam-authoring-assist.md](./2026-07-07-exam-authoring-assist.md)

* 现有代码：[rule-engine.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/rule-engine.ts)、[answer-reverser.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/answer-reverser.ts)、[kingsoft-adapter.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/adapters/kingsoft-adapter.ts)、[grading-service.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/services/grading-service.ts)、[QuestionEditor.tsx](file:///data/wps_dbsheet_examination_system/packages/client/src/pages/teacher/QuestionEditor.tsx)

