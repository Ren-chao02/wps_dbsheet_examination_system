# 智能组卷引擎（P1：选题优化）设计方案

> 2026-10-23 定稿（分期与边界已与项目负责人逐项确认）。本文件只覆盖 **P1「选题优化」**；AI 参与组卷（P2）、自适应组卷（P3）与题库标注通道各自独立成 spec。

## 一、背景：题库现状决定了"智能"从哪里开始

2026-10-23 在 dev 库实测（254 道 published 题）：

| 维度 | 现状 | 含义 |
| --- | --- | --- |
| 题量 | 实操 51 / 客观 203 | 分层很薄 |
| **知识点（capabilityIds）** | **仅 3/254 有**；51 道实操全空 | "知识点覆盖"暂无可优化的数据 |
| 难度 | 实操 易 21 / 中 23 / 难 7；客观 **中 200 / 易 2 / 难 1** | 实操有区分度；客观题几乎全"中" |
| 分值 | 实操全部 10 分 | 无分值配比空间 |
| 结构 | 实操 `schemaRefs.tables` 16 种签名 | 结构一致性可做，且是硬约束 |
| 试卷/题位 | 3 卷 / 19 题位（17 fixed / 2 rule），rule 题位均未声明知识点 | 抽题实际按"题型+难度"在抽 |

现状链路：`generateStudentPaper(examId, studentId)` **只在开考时**被调用（`routes/my-exams.ts:573`），逐题位独立抽取，**静默降级**（strict → 放宽结构 → 放宽难度）；`StudentExamQuestion` 不记录"为什么选它/放宽了哪级"，教师事后无法解释。

**结论**：P1 的瓶颈不是算法而是（a）元数据稀疏、（b）组卷时机与可解释性。因此 P1 = 预检 + 发布时预生成 + 难度分布优化 + 可解释报告；知识点覆盖等标注数据到位后再接入（不改架构）。

## 二、已确认的决策

| # | 决策点 | 选定 |
| --- | --- | --- |
| 1 | 分期 | **P1 选题优化 → P2 AI 参与 → P3 自适应**（P3 只用于练习，考试永远保持等值） |
| 2 | P1 的"智能" | 纯算法：难度分布可控 + 结构一致 + 去重均衡 + 可解释；不依赖 AI、不依赖知识点标注 |
| 3 | 数据前提 | 优化器先上；标注通道（AI 建议能力点 + 教师审核）作为独立 spec 并行，知识点覆盖随数据启用 |
| 4 | 组卷时机 | **发布时预生成全场 + 开考兜底**（发布时名单已齐备，见 `routes/exams.ts:612-627`） |
| 5 | 失败行为 | **硬约束阻断发布；软目标只警告**，并逐卷记录实际降级 |
| 6 | 优化器方案 | **先生成后修复（generate-and-repair）**：复用现有 picker，只在硬约束内做局部换题 |

## 三、范围与边界

**P1 做四件事**：

1. 发布前**预检**：硬约束不满足 → 阻断发布，逐题位说明缺口；
2. 发布后**异步预生成**：为名单内每个考生生成完整卷子快照（幂等、可重试、进度可见）；开考读快照、缺则现场生成兜底；
3. **难度分布目标 + 生成后修复**：整卷易/中/难比例可配；修复只在硬约束内换题；
4. **可解释报告**：目标 vs 实际、逐卷降级/修复留痕（教师可见）。

**不做**：

- **知识点覆盖约束**（依赖标注通道；数据到位后作为目标函数第二项接入，不改本期架构）；
- AI 参与（P2）、自适应（P3）；
- **不改现有硬约束语义**：分值一致、题型一致、`schemaRefs` 结构签名一致（strict 级）、同卷不重复、候选池归属（数据范围 P2 口径）、固定题位不动。

## 四、架构

```
发布考试
  │
  ├─ ① 预检（同步，复用候选枚举）
  │     任一 rule 题位 strict 池为空 → 400 + preflight[]  （阻断）
  │     通过 → ② 创建 ExamPaperGeneration(pending) → 入队
  │
  └─ ③ paper-generation job（异步）
        分页取名单 → 逐生 generateStudentPaper（幂等）
                    → 若配了 difficultyTarget：repairDifficultyDistribution
                    → 汇总 → ExamPaperGeneration(done/failed, summary)

开考（start-wps）
  └─ 读已有快照；缺 → 现场 generateStudentPaper（不变，兜底）
```

**一条硬性架构约束**：**预检、生成、修复必须共用同一个候选枚举函数**（`listSlotCandidates`）。三处各写一套 = "预检过了、生成抽不出"或"修复选了预检没算过的题"，这是本设计明确要避免的失败模式。

## 五、数据模型（增量，全部可空）

```prisma
Paper
  + difficultyTarget Json?   // {"easy":0.3,"medium":0.5,"hard":0.2}；null = 不约束（保持现状）

Exam
  + difficultyTarget Json?   // 绑定试卷时从 Paper 拷贝（与 rule 一样是"绑定那一刻的快照"；
                             // 拷贝点：routes/exams.ts 的绑卷/换卷两处，约 :276 / :421）

StudentExamQuestion
  + pickMeta Json?           // {level:'strict'|'relax-schemaRefs'|'relax-difficulty'|'repair',
                             //  candidates, wantedSignature, actualSignature, repairedFrom?}
                             //  level='repair' 表示该行在生成后被优化器换过（repairedFrom=原题 id）
                             //   逐卷"降级/修复"留痕的唯一来源

ExamPaperGeneration         // 新表，一考试一行
  id, examId @unique, status(pending|running|done|failed),
  totalStudents Int, unfilledSlots Json?, summary Json?, error Text?,
  queuedAt, startedAt DateTime?, finishedAt DateTime?
```

**进度不设计数器字段**：`已生成 X/Y` 按需从 `StudentExamQuestion`（已有 `@@index([examId, studentId])`）聚合，避免数千学生并发写同一行。

**为什么 `pickMeta` 必须落库**：没有它，"哪些卷子被降级了"只能事后按当时的候选池重算——而题库与规则会变，重算不可靠。它也是 P1 报告与后续审计的唯一来源。

## 六、链路细节

### 1. 发布预检（同步）

在 `routes/exams.ts` 现有发布校验之后追加：

- 遍历 `ExamQuestion`：`fixed` 题位校验"已绑定题目"（未绑定 = 硬失败）；`rule` 题位调用 `listSlotCandidates(slot, poolWhere)` 取 strict 池；
- 任一项不满足 → `400`，响应体：

```json
{ "message": "组卷预检未通过：N 个题位没有可用题目", 
  "preflight": [{ "slotIndex": 2, "reason": "候选池为空", "candidates": 0,
                  "signatureConflict": false }] }
```

- 通过 → upsert `ExamPaperGeneration`（`status='pending'`, `totalStudents=名单数`）→ `enqueuePaperGeneration(examId)`。

### 2. 预生成 job（`jobs/paper-generation-queue.ts`）

复用 `jobs/grading-queue.ts` / `import-queue.ts` 的 BullMQ 范式：

- 顶部：`status='running'`、`startedAt=now`；`jobId = exam:<examId>`（同考试去重）；
- 每页 200 人取 `examRoomStudent`（`assignment.examId`），**每页开始前**读考试状态：已 `cancelled`/`ended`/删除 → 提前结束（`failed` + 原因）；
- 每页内并发上限 4 调 `generateStudentPaper(examId, studentId)`（自带幂等早退）；收集 `unfilledSlots`；
- 若 `exam.difficultyTarget` 非空 → 对该生调用 `repairDifficultyDistribution`（见第七节）并写回；
- 结束时聚合 `summary`：

```json
{ "generated": 198, "missing": 2,
  "distribution": {                                            // 一律按道数计
    "ruleSlots": 8, "target": {...}, "actual": {...},          // 可调题位：目标 vs 实际
    "wholePaper": {...} },                                      // 全卷实际（含固定题位，仅供参考）
  "degradation": { "strict": 180, "relaxSchemaRefs": 3, "relaxDifficulty": 2, "repaired": 9 },
  "unfilledSlots": [{ "slotIndex": 4, "reason": "候选池为空（含修复后）", "students": 2 }] }
```

- BullMQ `attempts: 3`；重试幂等（已生成学生直接跳过）。

### 3. 开考兜底（不变）

`start-wps` 保留 `generateStudentPaper` 调用（`my-exams.ts:573`）。预生成未完成/新增考生/队列不可用都会走到这里；`generateStudentPaper` 的"已有快照直接返回"保证不会重复生成。开考兜底生成的卷子同样写 `pickMeta`，但**不做修复**（开考瞬间不做额外计算；报告里标注"现场生成"）。

### 4. 重跑与名单变更（安全边界）

| 考试状态 | 允许 |
| --- | --- |
| 尚无任何已开考提交 | 「重新组卷」：删除该考试全部 `StudentExamQuestion` → 重新预检 → 重跑 job |
| 已有提交（in_progress 及以后） | 只允许「补生成」：`generateStudentPaper` 补齐缺卷学生 + 修复，**不动已有快照** |

- 发布后新增考生：开考兜底或教师点「补生成」；
- 移出考生：快照保留（审计需要），不影响考试。

### 5. 接口

- `GET /api/exams/:id/paper-generation`：状态 + 进度（按需聚合）+ summary（沿用考试读权限与数据范围）；
- `POST /api/exams/:id/paper-generation/retry`：按上表判定"重跑/补生成"，非法组合返回 409 + 原因。

## 七、优化器：generate-and-repair

**输入**：某学生已生成卷的全部 `StudentExamQuestion`（含 `pickMeta` 的 level）+ `ExamQuestion` 题位 + `difficultyTarget` + 候选池来源。

**目标**：设可换题位数为 `n`（`slotType='rule'`），目标道数 `target_d = round(ratio_d × n)`（四舍五入，余数按 `|ratio_d×n − floor|` 降序补齐，保证 Σtarget = n）；`cost = Σ_d |actual_d − target_d|`。

**口径**：难度目标与统计**都按"道数（题位）"计，不按分值加权**——固定题位不可换、也不计入 `n`，因此目标只约束"可调题位"这一部分；报告里同时给出「全卷实际分布」与「可调题位：目标 vs 实际」，避免两个口径混用。

**修复循环**：

```
for iter in 1..min(2n, 20):
  对每个 rule 题位 × 该题位候选池中的每道题:
    若替换后所有硬约束成立 且 cost 下降 且 该题未被本卷其它题位使用:
      记入候选替换（delta = cost 降幅）
  取 delta 最大的替换执行（同 delta 按 (slotIndex, 题目 id) 确定性取舍）
  写回：只更新该题位的行：
        { level: 'repair', repairedFrom: 旧 questionId, candidates, actualSignature }
  无可行替换 → break
```

**硬约束守卫**（每次替换前逐条校验）：

1. 分值 = 题位分值；
2. 题型 = 题位 `rule.type`（若有）；
3. 结构签名 = 题位 `rule.schemaRefs` 签名（strict 级；题位未声明则不限）；
4. 未与本卷其它题位重复；
5. 候选池归属（`poolWhere`）。

**确定性**：候选枚举按题目 id 升序；同 delta 按 `(slotIndex, id)` 升序。同一输入必得同一输出（可复现、可审计）。

**不可达**：停在最小 cost，不报错；`summary.distribution` 里给目标 vs 实际与原因（候选难度不足）。

**无目标**：`difficultyTarget == null` → 直接跳过，零行为变化。

**修复粒度**：只改 `StudentExamQuestion` 行（`questionId`/`score`/`sortOrder`/`pickMeta`），不重建整卷；`fixed` 题位永不动。

## 八、报告与教师界面

1. **发布失败**：把 400 的 `preflight[]` 渲染成逐题位缺口（哪个题位、差在哪、是否结构签名冲突）；
2. **考试详情 · 组卷质量卡片**（教师/管理员）：
   - 状态与进度（排队 / 生成中 X/Y / 完成 / 失败 + 原因）；
   - 难度分布：可调题位的"目标 vs 实际" + 全卷实际（均按道数计）；
   - 降级统计：`strict / relaxSchemaRefs / relaxDifficulty / repaired` 各多少卷；
   - 未填题位清单（slotIndex + 原因 + 涉及人数）；
   - 操作：补生成 / 重新组卷（按第六节规则启用）；
3. **逐卷**：阅卷详情显示该生卷子的降级摘要（哪些题位是放宽/修复来的）——仅教师可见。

## 九、测试策略

- **纯函数** `repairDifficultyDistribution`：
  - 分布收敛（构造候选池，断言修复后 cost 下降/达标）；
  - 硬约束不被破坏（分值/题型/签名/不重复）；
  - 确定性（同输入两次调用结果一致）；
  - 无目标 → 零改动；
  - 目标不可达 → 停在最小 cost 且不抛。
- **候选枚举** `listSlotCandidates`：strict/放宽各级的池正确；与生成结果自洽。
- **预检**：零候选 → 阻断 + 结构；签名冲突 → 阻断；正常 → 通过。
- **队列 job**：幂等重跑（不重复生成）、部分失败、取消、补生成、名单分页。
- **API**：发布 400 结构；`GET paper-generation` 的权限与数据范围；`retry` 的 409 分支。
- **回归**：现有 `services/__tests__/paper-generator.test.ts` 全绿（生成路径语义不变）。

## 十、分期（P1 内）

| 期 | 内容 |
| --- | --- |
| **P1a** | `listSlotCandidates` 抽取 → 发布预检 → 预生成队列 + 状态接口 + 组卷质量卡片（不含难度目标） |
| **P1b** | `difficultyTarget` 字段与配置（试卷编辑页）→ `repairDifficultyDistribution` → `pickMeta` 留痕 → 逐卷展示 |
| **P1c** | 性能压测（几千学生）→ 重跑/补生成的操作打磨 |

## 十一、与其它 spec 的关系

- **P1.5 题库标注通道**（独立 spec）：AI 批量建议 `capabilityIds` + 教师审核；数据到位后，P1 的目标函数增加"覆盖项"（每个声明的能力点至少 1 道、单点不超过 N 道），架构不变；
- **P2 AI 参与组卷**：LLM 只产出"蓝图/候选"，挑选仍由本引擎基于真实题库执行（防幻觉出题号）；
- **P3 自适应组卷**：仅练习；考试永远保持等值口径（本设计的硬约束不变）。

## 十二、风险与已知边界

| 风险 | 处置 |
| --- | --- |
| 预检与生成口径漂移 | 强制共用 `listSlotCandidates`（第九节有测试钉住） |
| 队列不可用（Redis） | 发布仍成功，标 `failed` + 提示"开考现场生成"；兜底路径不变 |
| 数千学生生成耗时 | 分页 + 并发 4 + BullMQ 重试；进度按需聚合，不写热行 |
| 修复耗时 | 候选池小（当前实操 51 题）；上限 `min(2n,20)` 次迭代，超限即停 |
| 名单变动 | 开考兜底 / 补生成；已开考快照绝不动 |
| 目标不可达（题库太薄） | 不阻断，报告给出目标 vs 实际与原因 |
| 客观题全"中" | 客观题题位的难度目标天然不可达 → 报告里如实显示，不静默 |
