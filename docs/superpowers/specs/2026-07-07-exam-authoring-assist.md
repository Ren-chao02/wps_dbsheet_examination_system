# Spec: 考试出题辅助系统（Phase 1）

**创建日期**: 2026-07-07
**状态**: 待审阅
**作者**: brainstorming session
**关联**: Phase 2（AI 辅助出题）预留接口，本 spec 不展开

---

## 1. 背景与问题

### 1.1 当前痛点

现有出题流程中，教师通过 [QuestionEditor.tsx](file:///data/wps_dbsheet_examination_system/packages/client/src/pages/teacher/QuestionEditor.tsx) 的 `RuleEditor` 组件（一个纯文本 JSON 输入框）手写 `answerRules` 参数。这导致三大问题：

1. **规则参数瞎编**：出题人在孤立文本框里凭想象写 `{"tableName":"员工表","fieldName":"姓名","type":"text"}`，但 WPS API 实际返回的可能是 `"name":"Sheet1"` 或 `"type":"SingleLineText"`，导致严格匹配失败（[rule-engine.ts:149-155](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/rule-engine.ts#L149-L155)）
2. **不知道能考什么**：WPS 多维表格有 30 种字段类型、7 种视图、字段属性、表单、记录操作等丰富能力，但出题人难以系统掌握
3. **不会设计题目**：出题需要对多维表格熟悉，并知道要教会学生什么知识点

### 1.2 已有架构基础

项目已完整实现判分链路：
- [KingsoftAdapter](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/adapters/kingsoft-adapter.ts) 封装 WPS 开放接口（v7 Bearer JWT + v3 WPS-3 签名）
- [rule-engine.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/rule-engine.ts) 实现 25 种规则处理器
- [grading-service.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/services/grading-service.ts) 端到端打通判分流程

**核心结论**：判分侧已完备，问题在出题侧。规则参数与真实 API 数据脱节是根因。

---

## 2. 目标与非目标

### 2.1 目标

1. **根治规则瞎编**：规则参数 100% 来自标准答案的真实 Schema，而非手写
2. **解决"不知道能考什么"**：提供结构化的能力图谱（6 域 67 个能力项），覆盖 WPS 多维表格全部可自动判分的能力
3. **降低出题门槛**：出题人勾选能力 → 系统生成骨架 → 导入标准答案 → 反向生成规则 → 确认保存
4. **零判分侧改动**：rule-engine 和 grading-service 完全不动，answerRules 格式不变

### 2.2 非目标

- ❌ **不引入 LLM**（Phase 2 的工作）
- ❌ **不扩展 rule-engine**（Phase 1 复用现有 25 种 action）
- ❌ **不覆盖自动化/权限/仪表盘**（WPS API 不返回这些数据，无法自动判分）
- ❌ **不改判分流程**（grading-service 完全不动）

---

## 3. 整体架构

### 3.1 出题流程

```
┌──────────────────────────────────────────────────────────────────┐
│                        出题流程（Phase 1）                         │
│                                                                  │
│  ┌─────────────┐    勾选能力    ┌──────────────┐                │
│  │ 能力图谱面板 │ ────────────▶ │ 题目骨架生成  │                │
│  │ (结构化数据) │               │ (标题/描述/   │                │
│  │ 6域67项     │               │  规则模板)    │                │
│  └─────────────┘               └──────┬───────┘                │
│       ▲                               │                         │
│       │ 浏览                          ▼                         │
│       │                      ┌────────────────┐                 │
│       │                      │ 出题人微调描述  │                 │
│       │                      │ + 在 WPS 做答案 │                 │
│       │                      └───────┬────────┘                 │
│       │                              │ 粘贴 fileId+token        │
│       │                              ▼                          │
│       │                      ┌────────────────┐                 │
│       │                      │ 标准答案导入    │                 │
│       │                      │ (KingsoftAdapter│                 │
│       │                      │  .getSchema())  │                 │
│       │                      └───────┬────────┘                 │
│       │                              │ 真实 Schema               │
│       │                              ▼                          │
│       │                      ┌────────────────┐                 │
│       │                      │ 反向规则生成    │                 │
│       │                      │ (Schema→rules)  │                 │
│       │                      └───────┬────────┘                 │
│       │                              │                          │
│       │                              ▼                          │
│       │                      ┌────────────────┐                 │
│       │                      │ answerRules    │                 │
│       │                      │ (参数100%真实) │                 │
│       │                      └───────┬────────┘                 │
│       │                              │                          │
│       │                              ▼                          │
│       │     保存到 Question     ┌────────────┐                  │
│       └──────────────────────── │ 题目完成    │                  │
│                                └────────────┘                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 三大新增组件

| 组件 | 位置 | 职责 | 复用现有 |
|------|------|------|----------|
| **能力图谱数据** | `packages/server/src/data/capability-graph.ts` | 结构化描述多维表格所有可考能力 | 无（新建） |
| **题目骨架生成器** | `packages/server/src/engine/skeleton-generator.ts` | 根据勾选能力生成题目草稿 | 复用 rule-engine 的 action 定义 |
| **标准答案反向器** | `packages/server/src/engine/answer-reverser.ts` | 从真实 Schema 推导 answerRules | 复用 KingsoftAdapter |

### 3.3 与现有系统的关系

- **QuestionEditor.tsx 改造**：现有 RuleEditor 文本框 → 升级为三段式（能力选择 + 标准答案导入 + 规则预览）
- **Question.answerRules 字段不变**：仍是 `Rule[]` JSON，但填充方式从"手写"变为"反向生成"
- **rule-engine.ts 完全不动**：25 种规则处理器照旧
- **grading-service.ts 完全不动**：判分流程不变

### 3.4 Phase 2 预留

能力图谱数据结构预留 `promptHints` 字段，Phase 2 时作为 LLM prompt context 使用。Phase 1 不消费此字段。

---

## 4. 详细设计

### 4.1 能力图谱数据结构

#### 核心类型

```typescript
// packages/server/src/data/capability-graph.ts

type CapabilityDomain = 'tables' | 'fields' | 'field_props' | 'views' | 'forms' | 'records';

interface Capability {
  id: string;                      // 如 'field.single_select'
  domain: CapabilityDomain;        // 所属域
  name: string;                    // 中文名
  description: string;             // 一句话定义
  wpsConcept: string;              // 对应 WPS API 概念，如 "SingleSelectField"
  scorable: 'auto' | 'manual' | 'needsReview';
  ruleActions: RuleAction[];       // 对应 rule-engine 的 action
  examPatterns: ExamPattern[];     // 常见考法
  prerequisites?: string[];        // 前置能力 id
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  apiSupport?: {
    schema?: boolean;
    endpoint?: string;
    limitations?: string;
  };
  promptHints?: string;            // Phase 2 预留
}

interface ExamPattern {
  title: string;
  description: string;
  suggestedScore: number;
  ruleTemplate: RuleTemplate | null;  // null 表示人工评分
}

interface RuleTemplate {
  action: RuleAction;
  paramsSchema: object;
  paramResolvers: ParamResolver[];
}

interface ParamResolver {
  param: string;
  from?: string;      // 从 Schema 取值，如 'schema.sheet.name'
  value?: any;        // 固定值
}
```

#### 能力域总览（6 域 67 项）

| 域 | 能力数 | 判分方式 | 覆盖内容 |
|----|--------|---------|---------|
| **tables** 表操作 | 6 | auto | 创建/重命名/删除/主字段/字段管理/多表协作 |
| **fields** 字段类型 | 30 | auto | 基础10+业务11+高级9 |
| **field_props** 字段属性 | 6 | auto | 必填/默认值/唯一/格式/选项/公式 |
| **views** 视图配置 | 12 | auto(部分needsReview) | 7种类型 + 创建/筛选/排序/分组/隐藏字段 |
| **forms** 表单 | 5 | auto | 创建/字段/必填/默认值/布局 |
| **records** 记录操作 | 8 | auto | 增/删/改/筛选/排序/批量/校验/关联 |

#### 字段类型 30 种（WPS 官方完整清单）

```
基础字段（10）:
  text(SingleLineText) / number(Number) / single_select(SingleSelectField)
  multi_select(MultiSelectField) / date(Date) / time(Time)
  person(User) / rich_text(MultiLineText) / attachment(Attachment) / formula(Formula)

业务字段（11）:
  id_card / address / progress(Progress) / percent(Percent) / url(URL)
  cascade(Cascade) / phone / email / rating(Rating) / currency(Currency) / checkbox(Checkbox)

高级字段（9）:
  link(Link) / rollup(Rollup) / summary(Summary) / auto_number(AutoNumber)
  created_time(CreatedTime) / modified_time(LastModifiedTime)
  qr_code(QRCode) / barcode(Barcode) / lookup(Lookup)
```

#### 数据存储

能力图谱为**静态 TypeScript 常量**（不入库），按域分 6 文件：

```
packages/server/src/data/
├── capability-graph.ts              (聚合导出 + 类型定义 + 查询工具)
└── capabilities/
    ├── tables.ts                    (6 项)
    ├── fields.ts                    (30 项)
    ├── field-props.ts               (6 项)
    ├── views.ts                     (12 项)
    ├── forms.ts                     (5 项)
    └── records.ts                   (8 项)
```

不入库理由：能力图谱描述 WPS 多维表格的客观能力，不随业务变化，放代码里版本管理更清晰。

### 4.2 标准答案反向器

#### 职责

`AnswerReverser` 接收标准答案的真实 Schema + 用户勾选的能力，自动推导出参数 100% 真实的 `answerRules`。

#### 输入输出契约

```typescript
interface ReverseInput {
  capabilities: string[];     // 用户勾选的能力 id 列表
  fileId: string;
  accessToken: string;
}

interface RuleSuggestion {
  rule: Rule;                 // 完整规则（参数已填）
  source: {
    sheetName: string;
    fieldName?: string;
    capabilityId: string;
  };
  editable: boolean;
  selected: boolean;          // 默认是否勾选
}

interface ReverseOutput {
  suggestions: RuleSuggestion[];
  schemaSummary: {
    sheets: { name: string; fieldCount: number; viewCount: number }[];
    forms: { name: string; fieldCount: number }[];
  };
}
```

#### 核心算法：能力匹配器

每个能力域对应一个 Matcher，扫描 Schema 找到该能力的所有实例：

```typescript
const matchers: Record<CapabilityDomain, CapabilityMatcher> = {
  tables: new TableMatcher(),
  fields: new FieldMatcher(),
  field_props: new FieldPropMatcher(),
  views: new ViewMatcher(),
  forms: new FormMatcher(),
  records: new RecordMatcher(),
};

interface CapabilityMatcher {
  scan(capabilityId: string, schema: WpsSchema): Match[];
}
```

#### 反向生成流程

```
1. KingsoftAdapter.getSchema(fileId, token) → 真实 Schema
2. 对每个勾选能力：
   a. 找到对应域的 Matcher
   b. matcher.scan(capabilityId, schema) → Match[]
   c. 对每个 Match，applyTemplate(ruleTemplate, match) → Rule
3. 收集所有 RuleSuggestion
4. 返回 { suggestions, schemaSummary }
```

#### 边界情况

| 场景 | 处理 |
|------|------|
| 标准答案无匹配项 | 返回空 suggestions + 提示 |
| 匹配项过多 | 默认全生成但 selected=false，前端支持全选/反选 |
| 字段名含特殊字符 | 严格保留原值（rule-engine 也严格匹配） |
| accessToken 过期 | 透传 401 |
| 多表同名 | source 加 sheetId 供前端区分 |

### 4.3 前端 UI 组件

#### 三段式布局

```
┌─ 基本信息 ─────────────────────────────────────────────┐
│  标题 / 分值 / 难度 / 描述                              │
└──────────────────────────────────────────────────────┘
┌─ 第①段：能力选择 ─────────────────────────────────────┐
│  左侧域树 + 右侧能力清单 + 搜索 + 已选计数              │
└──────────────────────────────────────────────────────┘
┌─ 第②段：标准答案导入 ─────────────────────────────────┐
│  fileId + accessToken + 测试连接 + 反向生成 + Schema预览│
└──────────────────────────────────────────────────────┘
┌─ 第③段：规则预览与确认 ───────────────────────────────┐
│  规则建议列表（勾选/编辑/删除）+ 分值汇总 + 保存        │
└──────────────────────────────────────────────────────┘
```

#### 组件树

```
QuestionEditor (改造)
├── BasicInfoSection (现有，不变)
├── CapabilitySelector (新增)           ← 第①段
│   ├── CapabilityDomainTree
│   └── CapabilityList
├── AnswerImporter (新增)               ← 第②段
│   ├── CredentialsInput
│   ├── ConnectionStatus
│   └── SchemaPreview
└── RulePreviewer (新增，替换原 RuleEditor)  ← 第③段
    ├── RuleSuggestionList
    │   └── RuleSuggestionItem
    ├── RuleEditorModal
    └── ScoreSummary
```

#### 新增前端文件

```
packages/client/src/pages/teacher/
├── QuestionEditor.tsx                    (改造)
└── components/
    ├── CapabilitySelector.tsx            (新增)
    ├── AnswerImporter.tsx                (新增)
    ├── RulePreviewer.tsx                 (新增)
    └── RuleEditorModal.tsx               (新增)
```

#### 流程编排

- 第①段 → 第②段：selectedCapabilities 非空时激活
- 第②段 → 第③段：反向生成成功后激活
- 允许回退，但从第③段回第①段会清空 suggestions（能力变了需重新生成）
- 三段式仅对实操题（`type: 'practical'`）激活，其他题型走原流程

### 4.4 后端实现

#### 新增路由

| 端点 | 用途 |
|------|------|
| `GET /api/capabilities` | 返回完整能力图谱 |
| `GET /api/capabilities/:domain` | 按域查询 |
| `POST /api/questions/skeleton` | 根据勾选能力生成题目骨架 |
| `POST /api/questions/reverse-rules` | 反向生成规则 |

#### 骨架生成器

```typescript
class SkeletonGenerator {
  generate(input: { capabilityIds: string[]; difficulty?: string }): QuestionSkeleton {
    // 1. 按域分组勾选能力
    // 2. 拼接标题（如"创建工作表并配置单选字段"）
    // 3. 生成描述（操作步骤）
    // 4. 收集 ruleTemplates
    // 5. 汇总建议分值
  }
}
```

#### 与 grading-service 集成确认

**关键不变量**：`Question.answerRules` 字段格式不变，仍是 `Rule[]` JSON。

判分流程完全不动：
```
学生提交 → grading-service.evaluateQuestion()
  → KingsoftAdapter.getSchema(学生 fileId)
  → rule-engine.evaluateRules(question.answerRules, context)
  → 分数
```

反向器生成的 Rule 格式与现有完全一致，grading-service 和 rule-engine 无需改动。

---

## 5. 测试策略

### 5.1 能力图谱数据完整性测试

- 67 个能力项总数校验
- id 唯一性
- ruleActions 在 rule-engine 支持的 25 种内
- prerequisites 引用的 id 都存在
- scorable=auto 的能力都有 ruleTemplate

### 5.2 骨架生成器测试

- 单域能力生成正确骨架
- 多域能力生成组合标题
- 空能力列表返回空骨架

### 5.3 反向器测试（mock adapter）

- 反向生成单选字段规则（含 options）
- 标准答案无匹配能力返回空建议
- accessToken 过期透传 401

### 5.4 路由集成测试

- 未认证返回 401
- 有效请求返回规则建议
- fileId 不存在返回 404
- GET /api/capabilities 返回 67 个能力项

---

## 6. 实现顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 能力图谱数据（6 域文件 + 聚合） | 无 |
| 2 | 能力图谱数据完整性测试 | 步骤 1 |
| 3 | `GET /api/capabilities` 路由 | 步骤 1 |
| 4 | 骨架生成器 + 测试 | 步骤 1 |
| 5 | 反向器 + 6 个 Matcher + 测试 | 步骤 1 |
| 6 | `POST /api/questions/reverse-rules` 路由 | 步骤 5 |
| 7 | 前端 4 个组件 | 步骤 3、6 |
| 8 | QuestionEditor 集成改造 | 步骤 7 |
| 9 | 端到端验证 | 全部 |

---

## 7. Phase 2 预留

Phase 2（AI 辅助出题）不在本 spec 范围，但预留以下接口：

1. **`Capability.promptHints` 字段**：每个能力项预留提示文本，Phase 2 作为 LLM prompt context
2. **骨架生成器可替换**：Phase 2 可新增 AI 骨架生成器，与现有 SkeletonGenerator 实现相同接口
3. **反向器仍为最终校准**：即使 Phase 2 用 LLM 生成规则草稿，仍需经标准答案反向器校准，确保参数真实

Phase 2 的 LLM 不直接生成最终规则，而是生成草稿 → 经标准答案反向器校准 → 才落地。避免 LLM 瞎编。

---

## 8. 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| 能力图谱 67 项整理工作量大 | 高 | 中 | 按域分文件，可并行整理；优先做高频域（fields/tables） |
| WPS API Schema 字段名与文档不一致 | 中 | 高 | 反向器基于真实 Schema 生成，不依赖文档；首次接入时跑 smoke test 验证 |
| 出题人不会做标准答案 | 中 | 中 | 骨架生成器给出建议结构，出题人照着做 |
| 匹配器对复杂字段（如公式）识别不准 | 中 | 中 | 标记 scorable=needsReview，自动判+人工复核 |
| accessToken 安全性 | 低 | 高 | token 仅存内存不持久化；保存题目时只存 rules 不存 token |

---

## 9. 验收标准

1. `GET /api/capabilities` 返回 67 个能力项，6 个域
2. 出题人勾选能力 → 生成骨架 → 导入标准答案 → 反向生成规则 → 保存，全流程跑通
3. 反向生成的规则参数（tableName/fieldName/type/options）100% 来自真实 Schema
4. 反向生成的规则能被 rule-engine 正常判分（用标准答案自测，应得满分）
5. 现有判分流程无回归（grading-service 测试全通过）
6. 非实操题不受影响（选择题/填空题走原流程）

---

## 10. 参考资料

- [WPS 多维表基础字段详解](https://bbs.wps.cn/topic/18232)
- [WPS 多维表业务字段详解](https://bbs.wps.cn/topic/18635)
- [WPS 开放平台多维表格 API 文档](https://open.wps.cn/previous/docs/dbSheet/api-info)
- 现有代码：[rule-engine.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/rule-engine.ts)、[kingsoft-adapter.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/engine/adapters/kingsoft-adapter.ts)、[grading-service.ts](file:///data/wps_dbsheet_examination_system/packages/server/src/services/grading-service.ts)
