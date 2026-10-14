# 题目前置契约 + 场景链 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「员工信息表」这类累积式实操题不再把学生卡死在"表不存在"上——练习按场景成链（从空表开始、按序、可续做），考试只收单题自包含版本（题面 + 系统渲染的前置提示），并顺手把组卷的 `schemaRefs` 等值校验真正接通。

**Architecture:** 从题目的 `answerRules` 反推「前置契约」（requires/creates，纯函数）→ 用它在题目上落 `scenario`/`scenarioOrder`/`schemaRefs` → 四个消费方各取所需：学生提示条（考试）、练习成链、组卷等值签名、判分归因。**判分逻辑一行不改**（仍按表名找表、只看终态），因此推导错了最坏只是多显示一条提示。

**Tech Stack:** TypeScript；后端 Express + Prisma（`packages/server`）、前端 React 18 + antd 6 + Vite（`packages/client`）；测试 vitest（两端）+ supertest（路由）；端到端 Playwright。

**设计文档：** `docs/superpowers/specs/2026-10-14-question-prerequisites-and-scenario-chains-design.md`（本计划的唯一依据，冲突时以文档为准并回来改计划）

---

## Global Constraints

- **判分逻辑零改动**：`engine/rule-engine.ts` 的处理器、`services/grading-service.ts`、`services/practice-grading-service.ts` 的判分口径一律不动（本计划只改"学生知道该做什么"与组卷校验）。
- **注释与文档用中文**，注释解释「为什么」；新代码用 `utils/logger.ts` 的 `logger`，不加 `console.log`（`scripts/` 下的运维脚本沿用现有脚本的 `console` 风格）。
- **提交必须带 pathspec**（本工作区常有并行会话）：`git commit -m "..." -- <明确的文件>`，绝不 `git add -A` / `git commit -a`。
- 测试命令（在对应 package 目录下执行）：`cd packages/server && npx vitest run <file>`；客户端同理。路由测试用 `vi.mock` 替换 `middleware/auth` + `config/prisma`（免 JWT / 免 DB），参考 `packages/server/src/routes/__tests__/papers-pool-scope.test.ts`。
- 数据模型只加**可空列**，不做一次性数据迁移；老数据行为与今天完全一致。
- 命名固定：`Question.scenario`（String?，@db.VarChar(128)）、`Question.scenarioOrder`（Int?）；`schemaRefs = { requires, creates, tables, fields }`，其中 `tables` = `requires.tables ∪ creates.tables`（去重排序，**组卷等值签名只认它**，`paper-generator.ts` 的 `schemaRefsSignature` 不动）。
- 提示条文案（逐字，来自设计文档第七节）：
  `本题需要「员工信息表」（含字段：姓名、入职日期）。若你的表格里还没有它，请先在左侧新建这张表并建好这些字段，再完成题目要求。`
- 硬性阈值：场景练习题数上限 **50**（超过直接拒绝，不静默截断）；「场景实战」卡片只对**题数 ≥ 2** 的场景出现。
- 「待人工确认」的题（推导不出 / 跨链 / 依赖成环 / 规则 action 未实现）**不自动猜**，进清单由教师处理。

---

## 文件结构（先看清全貌再动手）

**新增（后端）**

| 文件 | 职责 |
| --- | --- |
| `packages/server/src/engine/prerequisite-deriver.ts` | 纯函数：`answerRules` → `{ requires, creates, tables, fields }` |
| `packages/server/src/services/scenario-cluster.ts` | 纯函数：按表名并查集归链 + 链内拓扑排序 |
| `packages/server/src/services/question-refs-backfill.ts` | 纯函数：把上面两个合成「回填计划」（自动项 + 待人工清单） |
| `packages/server/scripts/backfill-question-refs.ts` | 薄 I/O 脚本：读库 → 调回填计划 → dry-run 打印 / `--apply` 写库 + 导出清单 |

**新增（前端）**

| 文件 | 职责 |
| --- | --- |
| `packages/client/src/utils/question-refs-hint.ts` | 纯函数：`requires` → 提示条文案（考试页与教师预览共用） |
| `packages/client/src/utils/practice-attribution.ts` | 纯函数：判分明细 → 链级归因（多题因同一缺失失败时折叠） |

**修改（后端）**：`prisma/schema.prisma`（Question 两列 + 索引）、`routes/questions.ts`（`POST /derive-refs`）、`routes/my-exams.ts`（`toStudentQuestion` 下发 `requires`）、`routes/papers.ts`（fixed 题位继承 schemaRefs）、`routes/practice.ts`（scenarios 列表 / scenarioKey 开练 / 记录恢复 / 快照带 scenario 与契约）。

**修改（前端）**：`pages/teacher/QuestionEditor.tsx`（前置契约卡片）、`pages/teacher/QuestionBank.tsx`（场景列 + 筛选）、`pages/student/WpsExamDoing.tsx`（提示条）、`pages/student/PracticeList.tsx`（场景卡片）、`pages/student/PracticeDoing.tsx`（续做 + 归因 + needsReview）、`utils/paperAssembly.ts` + `pages/teacher/PaperEditor.tsx`（rule 题位 schemaRefs 可编辑）、`services/api.ts`（新接口）。

---

## Task 1: 前置契约推导器（纯函数）

**Files:**
- Create: `packages/server/src/engine/prerequisite-deriver.ts`
- Test: `packages/server/src/engine/__tests__/prerequisite-deriver.test.ts`

**Interfaces:**
- Consumes: `AnswerRule`（`engine/rule-engine.ts:15-20`，`{ id, action, params, score }`）
- Produces: `derivePrerequisites(rules: AnswerRule[]): DeriveResult`；类型 `SchemaRefs`、`RefGroup`、`FieldRef`、`ViewRef`、`DeriveResult`（后续 Task 3/5/6 与前端提示条都依赖这些名字与形状）

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/engine/__tests__/prerequisite-deriver.test.ts`：

```ts
/**
 * 前置契约推导器测试。
 *
 * 夹具取自生产库的真实规则（2026-10-14 抽查）：建表题、加字段题、视图题、
 * 关联题各一条，外加 16 道「引擎未实现 action」的题各取一个代表。
 */
import { describe, it, expect } from 'vitest';
import { derivePrerequisites } from '../prerequisite-deriver';
import type { AnswerRule } from '../rule-engine';

const rule = (action: string, params: Record<string, any>): AnswerRule => ({ id: 'r1', action, params, score: 10 });

describe('derivePrerequisites', () => {
  it('建表题（真实题：在左侧导航面板中创建新的数据表）→ creates 该表，requires 为空', () => {
    const { refs, unresolved } = derivePrerequisites([rule('check_table_exists', { tableName: '员工信息表' })]);
    expect(refs.creates.tables).toEqual(['员工信息表']);
    expect(refs.requires.tables).toEqual([]);
    expect(refs.tables).toEqual(['员工信息表']);
    expect(unresolved).toEqual([]);
  });

  it('加字段题（真实题：创建时间字段「打卡时间」）→ requires 员工信息表 + creates 该字段', () => {
    const { refs } = derivePrerequisites([
      rule('check_field', { tableName: '员工信息表', fieldName: '打卡时间', fieldType: 'Time' }),
    ]);
    expect(refs.requires.tables).toEqual(['员工信息表']);
    expect(refs.creates.fields).toEqual([{ table: '员工信息表', field: '打卡时间' }]);
    expect(refs.tables).toEqual(['员工信息表']);
    expect(refs.fields).toEqual(['打卡时间']);
  });

  it('同一题里既建表又建字段 → 表算 creates，不再算 requires', () => {
    const { refs } = derivePrerequisites([
      rule('check_table_exists', { tableName: '员工信息表' }),
      rule('check_field', { tableName: '员工信息表', fieldName: '姓名' }),
    ]);
    expect(refs.creates.tables).toEqual(['员工信息表']);
    expect(refs.requires.tables).toEqual([]);
    expect(refs.creates.fields).toEqual([{ table: '员工信息表', field: '姓名' }]);
  });

  it('视图题（真实题：在表格视图中设置筛选条件）→ requires 表与视图，creates 为空', () => {
    const { refs } = derivePrerequisites([
      rule('check_view_filter', { tableName: '员工信息表', viewName: '员工总览', conditions: [] }),
    ]);
    expect(refs.requires.tables).toEqual(['员工信息表']);
    expect(refs.requires.views).toEqual([{ table: '员工信息表', view: '员工总览' }]);
    expect(refs.creates.views).toEqual([]);
  });

  it('同一题里先建视图再配置 → 自己建的视图不算 requires', () => {
    const { refs } = derivePrerequisites([
      rule('check_view_exists', { tableName: '员工信息表', viewName: '员工总览' }),
      rule('check_view_filter', { tableName: '员工信息表', viewName: '员工总览', conditions: [] }),
    ]);
    expect(refs.creates.views).toEqual([{ table: '员工信息表', view: '员工总览' }]);
    expect(refs.requires.views).toEqual([]);
    expect(refs.requires.tables).toEqual(['员工信息表']);
  });

  it('关联题 → 同时 requires 源表与 targetTable', () => {
    const { refs } = derivePrerequisites([
      rule('check_linked_record', { tableName: '任务表', targetTable: '项目表' }),
    ]);
    expect(refs.requires.tables).toEqual(['任务表', '项目表']);
  });

  it('表单题 → requires 表 + creates 表单', () => {
    const { refs } = derivePrerequisites([
      rule('check_form_exists', { tableName: '设备巡检表', formName: '巡检登记' }),
    ]);
    expect(refs.requires.tables).toEqual(['设备巡检表']);
    expect(refs.creates.views).toEqual([{ table: '设备巡检表', view: '巡检登记' }]);
  });

  it('引擎未实现的 action（真实题：创建仪表盘并添加柱状图）→ 契约空 + unresolved 标记', () => {
    const { refs, unresolved } = derivePrerequisites([rule('verify_dashboard_chart', { chartType: 'bar' })]);
    expect(refs.requires.tables).toEqual([]);
    expect(refs.creates.tables).toEqual([]);
    expect(refs.tables).toEqual([]);
    expect(unresolved).toEqual(['verify_dashboard_chart']);
  });

  it('缺关键参数的规则不猜 → 进 unresolved', () => {
    const { unresolved } = derivePrerequisites([rule('check_field', { fieldName: '姓名' })]);
    expect(unresolved).toEqual(['check_field']);
  });

  it('多表题（真实题：创建单向关联字段连接两个数据表）→ 两张表都算 creates', () => {
    const { refs } = derivePrerequisites([
      rule('check_table_exists', { tableName: '项目表' }),
      rule('check_table_exists', { tableName: '任务表' }),
      rule('check_field', { tableName: '任务表', fieldName: '所属项目', linkTarget: '项目表' }),
    ]);
    expect(refs.creates.tables).toEqual(['任务表', '项目表']);
    expect(refs.tables).toEqual(['任务表', '项目表']);
    expect(refs.requires.tables).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/engine/__tests__/prerequisite-deriver.test.ts`
Expected: FAIL —— `Failed to resolve import "../prerequisite-deriver"`

- [ ] **Step 3: 实现推导器**

创建 `packages/server/src/engine/prerequisite-deriver.ts`：

```ts
/**
 * 前置契约推导器：从题目的判分规则（answerRules）反推「这题需要什么 / 会产出什么」。
 *
 * 为什么能推：规则处理器的语义是稳定的 —— check_table_exists 的考点就是"把表建出来"（creates），
 * check_field_* 的考点是"字段配对了"（creates 字段），而它引用的表必须已存在（requires）。
 * 推导结果只用于提示 / 归链 / 组卷签名，**判分一行都不看它**；推错最多多显示一条提示。
 */
import type { AnswerRule } from './rule-engine';

export interface FieldRef { table: string; field: string }
export interface ViewRef { table: string; view: string }

export interface RefGroup {
  tables: string[];
  fields: FieldRef[];
  views: ViewRef[];
}

export interface SchemaRefs {
  requires: RefGroup;
  creates: RefGroup;
  /** 组卷等值签名用：requires.tables ∪ creates.tables（去重、排序） */
  tables: string[];
  /** 兼容旧字段：涉及的字段名（去重、排序） */
  fields: string[];
}

export interface DeriveResult {
  refs: SchemaRefs;
  /** 推不出来的 action（引擎未实现 / 缺关键参数）——这类题大概率也判不了分，交人工 */
  unresolved: string[];
}

/** 考点 = "这张表建出来/建对了" → creates */
const CREATES_TABLE = new Set([
  'check_table_exists', 'check_table_name', 'check_table_count', 'check_table_fields',
]);
/** 考点 = "字段配对了" → creates 字段；所在表属 requires */
const FIELD_ACTIONS = new Set([
  'check_field', 'check_field_count', 'check_field_default', 'check_field_format', 'check_field_formula',
  'check_field_link_multiple', 'check_field_options', 'check_field_required', 'check_field_unique',
]);
/** 考点 = "关联指向对了" → 额外 requires 目标表 */
const LINK_ACTIONS = new Set(['check_field_link_target', 'check_linked_record']);
/** 考点 = "视图在不在" → creates 视图 */
const CREATES_VIEW = new Set(['check_view_exists']);
/** 考点 = "视图配对了" → requires 视图（视图是前序题的产物） */
const VIEW_CONFIG_ACTIONS = new Set([
  'check_view_filter', 'check_view_sort', 'check_view_group', 'check_view_field_hidden', 'check_view_type',
]);
/** 考点 = "记录做对了" → requires 表（且表里要有记录） */
const RECORD_ACTIONS = new Set([
  'check_record_exists', 'check_record_value', 'check_record_count', 'check_record_value_exact',
]);
/** 表单类 → requires 表 + creates 表单 */
const FORM_ACTIONS = new Set([
  'check_form_exists', 'check_form_fields', 'check_form_field_required', 'check_form_settings',
]);

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const uniqSorted = (xs: string[]) => [...new Set(xs)].sort();
const refKey = (r: { table: string } & Record<string, string>) => `${r.table}\u0000${Object.values(r).join('\u0000')}`;
const dedupeRefs = <T extends { table: string } & Record<string, string>>(xs: T[]): T[] =>
  [...new Map(xs.map(x => [refKey(x), x])).values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));

export function derivePrerequisites(rules: AnswerRule[]): DeriveResult {
  const requires: RefGroup = { tables: [], fields: [], views: [] };
  const creates: RefGroup = { tables: [], fields: [], views: [] };
  const unresolved: string[] = [];

  for (const rule of rules ?? []) {
    const action = str(rule?.action);
    const params = (rule?.params ?? {}) as Record<string, unknown>;
    const table = str(params.tableName);
    const field = str(params.fieldName);
    const view = str(params.viewName);

    if (CREATES_TABLE.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      creates.tables.push(table);
    } else if (FIELD_ACTIONS.has(action)) {
      if (!table || !field) { unresolved.push(action); continue; }
      requires.tables.push(table);
      creates.fields.push({ table, field });
    } else if (LINK_ACTIONS.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      requires.tables.push(table);
      const target = str(params.targetTable);
      // 有些历史规则把目标表写在 linkTarget 里（真实题：创建单向关联字段连接两个数据表）
      const target2 = target || str(params.linkTarget);
      if (target2) requires.tables.push(target2); else unresolved.push(action);
    } else if (CREATES_VIEW.has(action)) {
      if (!table || !view) { unresolved.push(action); continue; }
      requires.tables.push(table);
      creates.views.push({ table, view });
    } else if (VIEW_CONFIG_ACTIONS.has(action)) {
      if (!table || !view) { unresolved.push(action); continue; }
      requires.tables.push(table);
      requires.views.push({ table, view });
    } else if (RECORD_ACTIONS.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      requires.tables.push(table);
    } else if (FORM_ACTIONS.has(action)) {
      if (!table) { unresolved.push(action); continue; }
      requires.tables.push(table);
      const form = str(params.formName);
      if (form) creates.views.push({ table, view: form });
    } else {
      // 引擎未实现的 action（verify_* 系列）或空 action：不猜，交人工
      unresolved.push(action || '(空 action)');
    }
  }

  // 本题自己创建的表/字段/视图，不该再算"需要"——先建表再建字段是同一道题的常态
  const createdTables = new Set(creates.tables);
  const createdFields = new Set(creates.fields.map(f => refKey(f)));
  const createdViews = new Set(creates.views.map(v => refKey(v)));

  return {
    refs: {
      requires: {
        tables: uniqSorted(requires.tables.filter(t => !createdTables.has(t))),
        fields: dedupeRefs(requires.fields.filter(f => !createdFields.has(refKey(f)))),
        views: dedupeRefs(requires.views.filter(v => !createdViews.has(refKey(v)))),
      },
      creates: {
        tables: uniqSorted(creates.tables),
        fields: dedupeRefs(creates.fields),
        views: dedupeRefs(creates.views),
      },
      tables: uniqSorted([...requires.tables, ...creates.tables]),
      fields: uniqSorted([...requires.fields, ...creates.fields].map(f => f.field)),
    },
    unresolved: uniqSorted(unresolved),
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/engine/__tests__/prerequisite-deriver.test.ts`
Expected: PASS（10 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(engine): 前置契约推导器（answerRules → requires/creates）" -- \
  packages/server/src/engine/prerequisite-deriver.ts \
  packages/server/src/engine/__tests__/prerequisite-deriver.test.ts
```

---

## Task 2: 场景归链与拓扑排序（纯函数）

**Files:**
- Create: `packages/server/src/services/scenario-cluster.ts`
- Test: `packages/server/src/services/__tests__/scenario-cluster.test.ts`

**Interfaces:**
- Consumes: Task 1 的契约（本任务只吃 `requires.tables` 与 `creates.tables` 两个字符串数组）
- Produces: `clusterScenarios(items: ClusterInput[]): ClusterResult`；类型 `ClusterInput`（`{ id, title, requires: string[], creates: string[] }`）、`ClusterAssignment`（`{ id, scenario, scenarioOrder }`）、`ClusterPending`（`{ id, reason }`）、`ClusterResult`（`{ assignments, pending, scenarios }`）

**归链规则**（设计文档第五节）：
1. 同一道题 `creates` 出的多张表用并查集合并成一条链，链名 = 表名排序后用 ` + ` 连接；
2. `creates` 非空的题归到这些表所在链；
3. 只有 `requires` 的题：若其 requires 的表**没有任何题创建** → 本题自成链根（新建一条链）；若落在同一条链上 → 归该链；跨两条链 → `pending('跨链：同时引用 …')`；
4. 无表信息的题 → `pending('规则里没有表信息')`；
5. 链内拓扑排序：`creates(A) ∩ requires(B) ≠ ∅ ⇒ A 前 B 后`，同层按 title 排序保证确定性；成环 → 剩余按 title 排 + `pending('依赖成环，顺序需人工确认')`。

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/services/__tests__/scenario-cluster.test.ts`：

```ts
/**
 * 场景归链测试。数据形态取自生产库真实题（2026-10-14）：
 * 员工信息表链、项目/任务链、以及同时引用两张表的跨链题。
 */
import { describe, it, expect } from 'vitest';
import { clusterScenarios } from '../scenario-cluster';

const q = (id: string, title: string, creates: string[], requires: string[] = []) =>
  ({ id, title, creates, requires });

describe('clusterScenarios', () => {
  it('建表题当链根，后续字段题按顺序排在后面', () => {
    const r = clusterScenarios([
      q('q2', '创建时间字段', [], ['员工信息表']),
      q('q1', '创建员工信息表', ['员工信息表']),
      q('q3', '创建日期字段', [], ['员工信息表']),
    ]);
    expect(r.scenarios).toEqual([{ key: '员工信息表', questionIds: ['q1', 'q2', 'q3'] }]);
    expect(r.assignments).toEqual([
      { id: 'q1', scenario: '员工信息表', scenarioOrder: 1 },
      { id: 'q2', scenario: '员工信息表', scenarioOrder: 2 },
      { id: 'q3', scenario: '员工信息表', scenarioOrder: 3 },
    ]);
    expect(r.pending).toEqual([]);
  });

  it('一道题创建两张表 → 两表合成一条链', () => {
    const r = clusterScenarios([
      q('q1', '创建项目表和任务表', ['项目表', '任务表']),
      q('q2', '建引用字段', [], ['任务表']),
    ]);
    expect(r.scenarios).toEqual([{ key: '任务表 + 项目表', questionIds: ['q1', 'q2'] }]);
  });

  it('视图配置题依赖前序题建的视图 → 排在视图题之后', () => {
    const r = clusterScenarios([
      q('q2', '在员工总览视图加筛选', [], ['员工信息表']),
      q('q1', '创建员工信息表', ['员工信息表']),
      q('q3', '新建字段', [], ['员工信息表']),
    ]);
    // q2 的 requires 里没有"视图"这一维度时，只能按 title 稳定排序；
    // 顺序的最终话语权在教师手里（题库页可改 scenarioOrder）
    expect(r.scenarios[0].questionIds).toEqual(['q1', 'q2', 'q3']);
  });

  it('跨链题不猜 → 进待确认清单', () => {
    const r = clusterScenarios([
      q('q1', '创建员工信息表', ['员工信息表']),
      q('q2', '创建项目表任务表', ['项目表', '任务表']),
      q('q9', '设置关联字段允许多条记录关联', [], ['任务表', '员工信息表']),
    ]);
    expect(r.scenarios.map(s => s.key).sort()).toEqual(['员工信息表', '任务表 + 项目表']);
    expect(r.pending).toEqual([{ id: 'q9', reason: '跨链：需要 任务表、员工信息表（分属两条链），请人工指定场景' }]);
  });

  it('requires 的表没人创建 → 本题自成链根', () => {
    const r = clusterScenarios([q('q1', '创建统计字段求和', [], ['销售员表', '销售报表'])]);
    expect(r.scenarios).toEqual([{ key: '销售员表 + 销售报表', questionIds: ['q1'] }]);
  });

  it('规则里没有表信息 → 进待确认清单', () => {
    const r = clusterScenarios([q('q1', '创建仪表盘', [], [])]);
    expect(r.scenarios).toEqual([]);
    expect(r.pending).toEqual([{ id: 'q1', reason: '规则里没有表信息，无法归链' }]);
  });

  it('依赖成环 → 不再挣扎排序，进待确认清单', () => {
    const r = clusterScenarios([
      q('q1', 'A', ['表X'], ['表Y']),
      q('q2', 'B', ['表Y'], ['表X']),
    ]);
    expect(r.pending).toEqual([
      { id: 'q1', reason: '依赖成环，顺序需人工确认' },
      { id: 'q2', reason: '依赖成环，顺序需人工确认' },
    ]);
    // 成环也给出一个可用的兜底顺序（按 title），不是空手而归
    expect(r.scenarios[0].questionIds).toEqual(['q1', 'q2']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/scenario-cluster.test.ts`
Expected: FAIL —— `Failed to resolve import "../scenario-cluster"`

- [ ] **Step 3: 实现归链**

创建 `packages/server/src/services/scenario-cluster.ts`：

```ts
/**
 * 场景归链：把一道链的题（如「员工信息表」20 题）聚在一起并排出教学顺序。
 *
 * 为什么用「表」当锚点：题面里的表名是判分与提示的唯一稳定标识（判分就是按表名找表）。
 * 归不进去的（跨链 / 无表信息 / 依赖成环）一律进待确认清单——不猜，交教师指定。
 */

export interface ClusterInput {
  id: string;
  title: string;
  /** 本题引用的表（前一题的产物），来自前置契约 */
  requires: string[];
  /** 本题创建的表，来自前置契约 */
  creates: string[];
}

export interface ClusterAssignment { id: string; scenario: string; scenarioOrder: number }
export interface ClusterPending { id: string; reason: string }
export interface ClusterResult {
  assignments: ClusterAssignment[];
  pending: ClusterPending[];
  scenarios: { key: string; questionIds: string[] }[];
}

/** 并查集：把"同一道题创建的表"并成一条链 */
class Dsu {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) { this.parent.set(x, x); return x; }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function clusterScenarios(items: ClusterInput[]): ClusterResult {
  const dsu = new Dsu();
  // 1) 同一道题创建的多张表并入同一条链
  for (const it of items) {
    for (let i = 1; i < it.creates.length; i++) dsu.union(it.creates[0], it.creates[i]);
  }

  /** 某张表是否被某道题创建过（用于判断"本题所需的表归谁管"） */
  const creatorOf = new Map<string, string>();
  for (const it of items) for (const t of it.creates) if (!creatorOf.has(t)) creatorOf.set(t, it.id);

  // 2) 归属
  const chainOf = new Map<string, string>();          // questionId → 链根
  const pending: ClusterPending[] = [];
  for (const it of items) {
    if (it.creates.length > 0) { chainOf.set(it.id, dsu.find(it.creates[0])); continue; }

    const owners = [...new Set(it.requires.filter(t => creatorOf.has(t)).map(t => dsu.find(t)))];
    if (it.requires.length === 0) {
      pending.push({ id: it.id, reason: '规则里没有表信息，无法归链' });
    } else if (owners.length === 0) {
      // 需要的表没人创建 → 本题自成链根（题面自建场景，如销售报表）
      for (let i = 1; i < it.requires.length; i++) dsu.union(it.requires[0], it.requires[i]);
      chainOf.set(it.id, dsu.find(it.requires[0]));
    } else if (owners.length === 1) {
      chainOf.set(it.id, owners[0]);
    } else {
      const tables = [...it.requires].sort().join('、');
      pending.push({ id: it.id, reason: `跨链：需要 ${tables}（分属两条链），请人工指定场景` });
    }
  }

  // 3) 链名 + 链内拓扑排序
  const tableOfRoot = new Map<string, string[]>();
  for (const it of items) {
    for (const t of [...it.creates, ...it.requires]) {
      const root = dsu.find(t);
      if (!tableOfRoot.has(root)) tableOfRoot.set(root, []);
      tableOfRoot.get(root)!.push(t);
    }
  }

  const byChain = new Map<string, ClusterInput[]>();
  for (const it of items) {
    const root = chainOf.get(it.id);
    if (!root) continue;
    if (!byChain.has(root)) byChain.set(root, []);
    byChain.get(root)!.push(it);
  }

  const assignments: ClusterAssignment[] = [];
  const scenarios: { key: string; questionIds: string[] }[] = [];

  for (const [root, members] of byChain) {
    const key = [...new Set(tableOfRoot.get(root) ?? [])].sort().join(' + ');
    const ordered = topoSort(members, pending);
    // 依赖成环时 topoSort 返回 null → 用 title 兜底，但仍标进待确认
    const finalOrder = ordered ?? [...members].sort((a, b) => a.title.localeCompare(b.title));
    finalOrder.forEach((it, i) => assignments.push({ id: it.id, scenario: key, scenarioOrder: i + 1 }));
    scenarios.push({ key, questionIds: finalOrder.map(it => it.id) });
  }

  // 输出排序稳定：链按 key、链内按顺序，便于测试与人工核对
  scenarios.sort((a, b) => a.key.localeCompare(b.key));
  assignments.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.scenarioOrder - b.scenarioOrder);
  pending.sort((a, b) => a.id.localeCompare(b.id));
  return { assignments, pending, scenarios };
}

/**
 * 链内拓扑排序：creates(A) ∩ requires(B) ≠ ∅ ⇒ A 在 B 前。
 * 同层按 title 排序（确定性）。成环返回 null，由调用方兜底并标进待确认。
 */
function topoSort(members: ClusterInput[], pending: ClusterPending[]): ClusterInput[] | null {
  const indegree = new Map<string, number>();
  const edges = new Map<string, string[]>();   // 前置题 → 后继题
  const byId = new Map(members.map(m => [m.id, m]));
  for (const m of members) { indegree.set(m.id, 0); edges.set(m.id, []); }

  for (const b of members) {
    for (const a of members) {
      if (a.id === b.id) continue;
      const shares = a.creates.some(t => b.requires.includes(t));
      if (shares) { edges.get(a.id)!.push(b.id); indegree.set(b.id, (indegree.get(b.id) ?? 0) + 1); }
    }
  }

  const ready = members.filter(m => (indegree.get(m.id) ?? 0) === 0).sort((a, b) => a.title.localeCompare(b.title));
  const out: ClusterInput[] = [];
  while (ready.length > 0) {
    const cur = ready.shift()!;
    out.push(cur);
    for (const next of edges.get(cur.id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) { ready.push(byId.get(next)!); ready.sort((a, b) => a.title.localeCompare(b.title)); }
    }
  }

  if (out.length !== members.length) {
    for (const m of members) pending.push({ id: m.id, reason: '依赖成环，顺序需人工确认' });
    return null;
  }
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/services/__tests__/scenario-cluster.test.ts`
Expected: PASS（7 个用例全绿）。若「跨链题」用例失败，检查 pending 文案里的表名排序（`[...requires].sort()` 后是 `任务表、员工信息表`）。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(services): 场景归链与链内拓扑排序（跨链/成环进人工清单）" -- \
  packages/server/src/services/scenario-cluster.ts \
  packages/server/src/services/__tests__/scenario-cluster.test.ts
```

---

## Task 3: 回填计划构建器（纯函数）

**Files:**
- Create: `packages/server/src/services/question-refs-backfill.ts`
- Test: `packages/server/src/services/__tests__/question-refs-backfill.test.ts`

**Interfaces:**
- Consumes: `derivePrerequisites`（Task 1）、`clusterScenarios`（Task 2）
- Produces: `buildBackfillPlan(questions: BackfillInput[]): BackfillPlan`；类型 `BackfillInput`（`{ id, title, answerRules: unknown }`）、`BackfillEntry`（`{ id, title, refs, unresolved, scenario, scenarioOrder, pendingReason? }`）、`BackfillPlan`（`{ entries, scenarios, autoCount, pendingCount }`）。Task 6 的脚本与 Task 6/11 的清单导出都依赖这些名字。

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/services/__tests__/question-refs-backfill.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildBackfillPlan } from '../question-refs-backfill';

const Q = (id: string, title: string, answerRules: any[]) => ({ id, title, answerRules });

describe('buildBackfillPlan', () => {
  it('能推导的题：契约 + 场景 + 顺序一起填好，不进人工清单', () => {
    const plan = buildBackfillPlan([
      Q('q1', '创建员工信息表', [{ id: 'r', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 100 }]),
      Q('q2', '创建时间字段', [{ id: 'r', action: 'check_field', params: { tableName: '员工信息表', fieldName: '打卡时间' }, score: 100 }]),
    ]);
    expect(plan.autoCount).toBe(2);
    expect(plan.pendingCount).toBe(0);
    expect(plan.scenarios).toEqual([{ key: '员工信息表', questionCount: 2 }]);
    const q2 = plan.entries.find(e => e.id === 'q2')!;
    expect(q2.scenario).toBe('员工信息表');
    expect(q2.scenarioOrder).toBe(2);
    expect(q2.refs.requires.tables).toEqual(['员工信息表']);
    expect(q2.pendingReason).toBeUndefined();
  });

  it('引擎未实现的 action：契约空 + 进人工清单（标出 action 名）', () => {
    const plan = buildBackfillPlan([
      Q('q9', '创建仪表盘并添加柱状图', [{ id: 'r', action: 'verify_dashboard_chart', params: {}, score: 100 }]),
    ]);
    expect(plan.pendingCount).toBe(1);
    const e = plan.entries[0];
    expect(e.refs.tables).toEqual([]);
    expect(e.pendingReason).toContain('verify_dashboard_chart');
  });

  it('answerRules 是脏数据（不是数组）时不炸，进人工清单', () => {
    const plan = buildBackfillPlan([Q('q0', '坏题', null as any)]);
    expect(plan.pendingCount).toBe(1);
    expect(plan.entries[0].pendingReason).toBeTruthy();
  });

  it('跨链题：仍给出推导出的契约，但不给场景，pendingReason 说明原因', () => {
    const plan = buildBackfillPlan([
      Q('q1', '创建员工信息表', [{ id: 'r', action: 'check_table_exists', params: { tableName: '员工信息表' }, score: 100 }]),
      Q('q2', '创建项目表任务表', [
        { id: 'r1', action: 'check_table_exists', params: { tableName: '项目表' }, score: 50 },
        { id: 'r2', action: 'check_table_exists', params: { tableName: '任务表' }, score: 50 },
      ]),
      Q('q9', '允许多条记录关联', [
        { id: 'r', action: 'check_field_link_multiple', params: { tableName: '任务表', fieldName: '负责人' }, score: 100 },
      ]),
    ]);
    const e = plan.entries.find(x => x.id === 'q9')!;
    if (e.pendingReason) {
      expect(e.scenario).toBeNull();
      expect(e.pendingReason).toContain('跨链');
    } else {
      // 两条链里只有 任务表 能对上（员工信息表不在 requires 里），归到任务链也是对的
      expect(e.scenario).toBe('任务表 + 项目表');
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/question-refs-backfill.test.ts`
Expected: FAIL —— `Failed to resolve import "../question-refs-backfill"`

- [ ] **Step 3: 实现构建器**

创建 `packages/server/src/services/question-refs-backfill.ts`：

```ts
/**
 * 回填计划：把「推导前置契约」与「场景归链」合成一份可直接落库的计划 + 待人工清单。
 * 抽成纯函数是为了可测——真正写库的薄脚本（scripts/backfill-question-refs.ts）不做任何判断。
 */
import { derivePrerequisites, type DeriveResult, type SchemaRefs } from '../engine/prerequisite-deriver';
import { clusterScenarios } from './scenario-cluster';
import type { AnswerRule } from '../engine/rule-engine';

export interface BackfillInput {
  id: string;
  title: string;
  /** 直接来自 Prisma 的 Json 列，可能是任意脏数据 */
  answerRules: unknown;
}

export interface BackfillEntry {
  id: string;
  title: string;
  refs: SchemaRefs;
  unresolved: string[];
  scenario: string | null;
  scenarioOrder: number | null;
  /** 有值 = 进「待人工确认」清单（可能仍有参考用的 scenario） */
  pendingReason?: string;
}

export interface BackfillPlan {
  entries: BackfillEntry[];
  scenarios: { key: string; questionCount: number }[];
  autoCount: number;
  pendingCount: number;
}

const asRules = (raw: unknown): AnswerRule[] => (Array.isArray(raw) ? (raw as AnswerRule[]) : []);
const emptyRefs = (): SchemaRefs => ({
  requires: { tables: [], fields: [], views: [] },
  creates: { tables: [], fields: [], views: [] },
  tables: [],
  fields: [],
});

export function buildBackfillPlan(questions: BackfillInput[]): BackfillPlan {
  const derived = new Map<string, DeriveResult>();
  for (const q of questions) {
    try {
      derived.set(q.id, derivePrerequisites(asRules(q.answerRules)));
    } catch {
      // 脏规则（不是数组 / 结构异常）不该让整批回填失败
      derived.set(q.id, { refs: emptyRefs(), unresolved: ['(规则解析失败)'] });
    }
  }

  const cluster = clusterScenarios(
    questions.map(q => ({
      id: q.id,
      title: q.title,
      requires: derived.get(q.id)!.refs.requires.tables,
      creates: derived.get(q.id)!.refs.creates.tables,
    })),
  );

  const assignmentOf = new Map(cluster.assignments.map(a => [a.id, a]));
  const pendingOf = new Map(cluster.pending.map(p => [p.id, p]));

  const entries: BackfillEntry[] = questions.map(q => {
    const { refs, unresolved } = derived.get(q.id)!;
    const a = assignmentOf.get(q.id);
    const p = pendingOf.get(q.id);
    const reasons: string[] = [];
    if (p) reasons.push(p.reason);
    if (unresolved.length > 0) reasons.push(`规则 action 引擎未实现/缺参数：${unresolved.join('、')}`);
    return {
      id: q.id,
      title: q.title,
      refs,
      unresolved,
      scenario: a?.scenario ?? null,
      scenarioOrder: a?.scenarioOrder ?? null,
      ...(reasons.length > 0 ? { pendingReason: reasons.join('；') } : {}),
    };
  });

  const counts = new Map<string, number>();
  for (const a of cluster.assignments) counts.set(a.scenario, (counts.get(a.scenario) ?? 0) + 1);

  return {
    entries,
    scenarios: [...counts.entries()]
      .map(([key, questionCount]) => ({ key, questionCount }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    autoCount: entries.filter(e => !e.pendingReason).length,
    pendingCount: entries.filter(e => e.pendingReason).length,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/services/__tests__/question-refs-backfill.test.ts`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(services): 回填计划构建器（推导 + 归链 + 待人工清单）" -- \
  packages/server/src/services/question-refs-backfill.ts \
  packages/server/src/services/__tests__/question-refs-backfill.test.ts
```

---

## Task 4: Question 数据模型加 scenario / scenarioOrder

**Files:**
- Modify: `packages/server/prisma/schema.prisma`（`model Question`，第 253 行 `schemaRefs` 之后）

**Interfaces:**
- Produces: Prisma 客户端上的 `Question.scenario: string | null`、`Question.scenarioOrder: number | null`——Task 5/6/11/12/13 直接读写

- [ ] **Step 1: 加字段**

在 `packages/server/prisma/schema.prisma` 的 `Question` 模型里、`schemaRefs Json?` 之后插入：

```prisma
  /// 场景链（练习「场景实战」）：同一 scenario 的题按 scenarioOrder 顺序出给学生。
  /// 初始由 scripts/backfill-question-refs.ts 从判分规则推导，教师可在题库页改。
  scenario       String? @db.VarChar(128)
  scenarioOrder  Int?    @map("scenario_order")
```

并在该模型现有 `@@index` 之后加一条：

```prisma
  @@index([scenario, scenarioOrder])
```

- [ ] **Step 2: 手写迁移（**禁止 `migrate dev`** —— 本库会触发 RESET）**

> ⚠️ 环境事实（2026-10-14 账本）：共享开发库 `_prisma_migrations` 有 6 条 baseline 之前的陈旧记录，
> `prisma migrate dev` 会要求 **RESET 公共 schema —— 禁止执行**。本计划一律走「手写 SQL + `migrate deploy`」。

先确认没有别人留下的 pending 迁移：

Run: `cd packages/server && npx prisma migrate status`
Expected: `Database schema is up to date!`（若列出 pending 迁移，**停下来问用户**，不要顺手 apply 别人的迁移）

创建目录与 SQL（时间戳格式 `YYYYMMDDHHMMSS`，与现有迁移一致，用你执行时的真实时间）：

```bash
cd packages/server
mkdir -p prisma/migrations/20261014090000_add_question_scenario
cat > prisma/migrations/20261014090000_add_question_scenario/migration.sql <<'SQL'
-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "scenario" VARCHAR(128),
ADD COLUMN     "scenario_order" INTEGER;

-- CreateIndex
CREATE INDEX "questions_scenario_scenario_order_idx" ON "questions"("scenario", "scenario_order");
SQL
```

- [ ] **Step 3: 应用 + 生成客户端 + 校验零差异**

```bash
cd packages/server
npx prisma migrate deploy       # 期望：1 migration applied / Database schema is now up to date
npx prisma generate             # migrate deploy 不会自动 generate，必须显式跑
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
Expected: 最后一条输出 `-- This is an empty migration.` —— 证明手写 SQL 与 Prisma 自生成的完全一致。
若它打出 ALTER 语句：**不要改已应用的迁移文件**（校验和会变、造成 drift），把差集内容作为一条**新的**迁移目录再 `deploy` 一次，并在报告里记录偏差。

Run: `cd packages/server && npx tsc --noEmit -p tsconfig.json`
Expected: 通过（客户端类型里已有 `scenario`）

- [ ] **Step 4: 提交（迁移目录 + schema）**

```bash
git add packages/server/prisma/schema.prisma packages/server/prisma/migrations
git commit -m "feat(db): Question 增加场景链字段 scenario / scenario_order（练习成链）" -- \
  packages/server/prisma/schema.prisma packages/server/prisma/migrations
```

---

## Task 5: POST /api/questions/derive-refs（推导接口）

**Files:**
- Modify: `packages/server/src/routes/questions.ts`（在 `/skeleton` 接口附近，约 420-437 行）
- Test: `packages/server/src/routes/__tests__/questions-derive-refs.test.ts`

**Interfaces:**
- Consumes: `derivePrerequisites`（Task 1）
- Produces: `POST /api/questions/derive-refs`，请求 `{ rules: AnswerRule[] }`，响应 `{ refs: SchemaRefs, unresolved: string[] }`——Task 10 的编辑器卡片调用它

- [ ] **Step 1: 写失败的测试**

创建 `packages/server/src/routes/__tests__/questions-derive-refs.test.ts`：

```ts
/**
 * 前置契约推导接口的回归测试。
 *
 * 三条口径：
 * 1. 只做纯推导，不查库、不联网（教师点一次按钮就出结果）；
 * 2. 学生角色不可访问（路由挂 authorize('teacher','admin')）；
 * 3. 参数非法（空 rules / 缺 action）返回 400，不是 500。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, res: any, next: any) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ message: '未认证' });
      req.user = { id: 'u-1', userId: 'u-1', username: 'u-1', role, permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});
vi.mock('../../config/prisma', () => ({ prisma: {} }));

import { questionRouter } from '../questions';

const app = express();
app.use(express.json());
app.use('/api/questions', questionRouter);

describe('POST /api/questions/derive-refs', () => {
  it('从建表规则推出 creates，从字段规则推出 requires', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({
        rules: [
          { id: 'r1', action: 'check_field', params: { tableName: '员工信息表', fieldName: '打卡时间' }, score: 100 },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.refs.requires.tables).toEqual(['员工信息表']);
    expect(res.body.refs.creates.fields).toEqual([{ table: '员工信息表', field: '打卡时间' }]);
    expect(res.body.unresolved).toEqual([]);
  });

  it('未实现的 action 在 unresolved 里点名，不报错', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({ rules: [{ action: 'verify_dashboard_chart', params: {} }] });
    expect(res.status).toBe(200);
    expect(res.body.unresolved).toEqual(['verify_dashboard_chart']);
  });

  it('学生角色 403', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'student')
      .send({ rules: [{ action: 'check_table_exists', params: { tableName: 'X' } }] });
    expect(res.status).toBe(403);
  });

  it('空 rules → 400', async () => {
    const res = await request(app)
      .post('/api/questions/derive-refs')
      .set('x-test-role', 'teacher')
      .send({ rules: [] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/questions-derive-refs.test.ts`
Expected: FAIL —— 404（接口还不存在），第 1、2 个用例尤其明显

- [ ] **Step 3: 实现接口**

在 `packages/server/src/routes/questions.ts` 顶部 import 区加：

```ts
import { derivePrerequisites } from '../engine/prerequisite-deriver';
```

在 `/skeleton` 接口之后插入：

```ts
/**
 * POST /api/questions/derive-refs
 * 从判分规则反推前置契约（requires/creates），供出题页「自动推导」按钮使用。
 * 纯函数、不查库不联网；推不出来的 action 在 unresolved 里点名，交人工处理。
 */
const deriveRefsSchema = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().optional(),
        action: z.string().min(1, 'action 不能为空'),
        params: z.record(z.any()).default({}),
        score: z.number().optional(),
      }),
    )
    .min(1, '至少一条规则'),
});

questionRouter.post('/derive-refs', authorize('teacher', 'admin'), async (req: Request, res: Response) => {
  const parsed = deriveRefsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: '参数错误', errors: parsed.error.flatten() });
  }
  res.json(derivePrerequisites(parsed.data.rules as AnswerRule[]));
});
```

（`AnswerRule` 类型若文件里尚未 import，从 `../engine/rule-engine` 补 `import type { AnswerRule } from '../engine/rule-engine';`）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/routes/__tests__/questions-derive-refs.test.ts`
Expected: PASS（4 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(api): POST /api/questions/derive-refs —— 从判分规则推导前置契约" -- \
  packages/server/src/routes/questions.ts \
  packages/server/src/routes/__tests__/questions-derive-refs.test.ts
```

---

## Task 6: 回填脚本（dry-run / --apply）+ 白名单 + 导出清单

**Files:**
- Create: `packages/server/scripts/backfill-question-refs.ts`
- Modify: `.gitignore`（`packages/server/scripts/` 白名单区，加一行 `!packages/server/scripts/backfill-question-refs.ts`）

**Interfaces:**
- Consumes: `buildBackfillPlan`（Task 3）、Task 4 的两个新列
- Produces: 命令行行为——默认 dry-run 打印摘要 + 写清单；`--apply` 写库；`--force` 覆盖已有 `scenario`。清单落在 `docs/backfill-question-refs-<YYYY-MM-DD>.md`（`docs/` 不入库，是本地参考资料）

- [ ] **Step 1: 写脚本**

创建 `packages/server/scripts/backfill-question-refs.ts`：

```ts
/**
 * 回填题目前置契约（schemaRefs）与场景链（scenario/scenarioOrder）。
 *
 * 用法（在 packages/server 下执行）：
 *   npx tsx scripts/backfill-question-refs.ts              # dry-run：只打印 + 导出清单
 *   npx tsx scripts/backfill-question-refs.ts --apply      # 写库（只填 scenario 为空的题）
 *   npx tsx scripts/backfill-question-refs.ts --apply --force   # 连已有 scenario 一起覆盖
 *
 * 幂等：默认只处理 scenario 为 NULL 的题；--force 才会覆盖（教师改过的场景名要保住）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '../src/config/prisma';
import { buildBackfillPlan } from '../src/services/question-refs-backfill';

/** 练习支持的实操题型（与 routes/practice.ts 的 PRACTICE_QUESTION_TYPES 一致） */
const HANDS_ON_TYPES = ['create_table', 'add_field', 'config_view', 'create_form', 'comprehensive'] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');

  const questions = await prisma.question.findMany({
    where: { type: { in: HANDS_ON_TYPES as unknown as any } },
    select: { id: true, title: true, answerRules: true, scenario: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = force ? questions : questions.filter(q => q.scenario === null);
  console.log(`实操题 ${questions.length} 道；本次处理 ${targets.length} 道（${force ? '--force 覆盖模式' : '只填空场景'}）`);

  const plan = buildBackfillPlan(targets.map(q => ({ id: q.id, title: q.title, answerRules: q.answerRules })));

  console.log('\n=== 场景（自动归链结果）===');
  for (const s of plan.scenarios) console.log(`  ${s.key}：${s.questionCount} 题`);
  console.log(`\n自动填充 ${plan.autoCount} 道；待人工确认 ${plan.pendingCount} 道`);

  const pending = plan.entries.filter(e => e.pendingReason);
  if (pending.length > 0) {
    console.log('\n=== 待人工确认 ===');
    for (const e of pending) console.log(`  [${e.id.slice(0, 8)}] ${e.title} —— ${e.pendingReason}`);
  }

  // 清单落盘：docs/ 不入库，供教师按清单在题库页逐条改
  const date = new Date().toISOString().slice(0, 10);
  const outPath = resolve(__dirname, `../../../docs/backfill-question-refs-${date}.md`);
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  const md = [
    `# 题目前置契约 + 场景链回填清单（${date}）`,
    '',
    `- 处理范围：${targets.length} 道实操题（${force ? '--force 覆盖' : '只填空场景'}）`,
    `- 自动填充：${plan.autoCount} 道；待人工确认：${plan.pendingCount} 道`,
    '',
    '## 场景',
    ...plan.scenarios.map(s => `- ${s.key}：${s.questionCount} 题`),
    '',
    '## 待人工确认（左：题目标题；右：原因）',
    ...pending.map(e => `- ${e.title} —— ${e.pendingReason}`),
    '',
    '## 明细',
    ...plan.entries.map(e => `- [${e.scenario ?? '（待定）'} ${e.scenarioOrder ?? '-'}] ${e.title}`),
  ].join('\n');
  writeFileSync(outPath, md, 'utf8');
  console.log(`\n清单已写入：${outPath}`);

  if (!apply) {
    console.log('\n（dry-run，未写库；确认无误后加 --apply 重跑）');
    return;
  }

  let written = 0;
  for (const e of plan.entries) {
    await prisma.question.update({
      where: { id: e.id },
      data: {
        schemaRefs: e.refs as any,
        // 待人工确认的题：场景留空（教师后续在题库页指定），契约仍然写入（推导出的部分是可信的）
        ...(e.scenario && !e.pendingReason ? { scenario: e.scenario, scenarioOrder: e.scenarioOrder } : {}),
      },
    });
    written += 1;
  }
  console.log(`\n已写库 ${written} 道`);
}

main()
  .catch(err => { console.error('回填失败：', err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 加 .gitignore 白名单**

在 `.gitignore` 里 `packages/server/scripts/` 那一段（逐条 `!` 的地方）加一行：

```
!packages/server/scripts/backfill-question-refs.ts
```

- [ ] **Step 3: dry-run 实跑，核对输出**

Run: `cd packages/server && npx tsx scripts/backfill-question-refs.ts`
Expected: 打印形如 `实操题 51 道；本次处理 51 道`；场景列表里出现「员工信息表：N 题」「任务表 + 项目表：M 题」等；待人工确认里出现 16 道 verify_* 题；清单写入 `docs/backfill-question-refs-2026-10-14.md`。

**这一步是人工核对关卡**：把打印出的场景表与设计文档第五节的「预估产出」对照。数目对不上不一定是错——以脚本为准，但要在 plan 文档下面追加一行记录实际数目（下一节 Step 4 的收尾里做）。

- [ ] **Step 4: --apply 写库并用 SQL 抽查**

Run: `cd packages/server && npx tsx scripts/backfill-question-refs.ts --apply`
Expected: `已写库 N 道`

Run（用只读库连接抽查，确认字段真的落上）:
```sql
SELECT scenario, count(*) FROM questions WHERE scenario IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FROM questions WHERE schema_refs->'requires'->'tables' IS NOT NULL;
```
Expected: 至少一条 `员工信息表` 记录；`schema_refs` 有 requires 的题数 ≈ 自动填充数

- [ ] **Step 5: 修正计划文档里的预估数字 + 提交**

把 Step 3 实跑的场景表追加到设计文档第五节的表格下方（一行「实测：…」），然后提交：

```bash
git commit -m "chore(scripts): 题目契约与场景链回填脚本（dry-run/--apply，导出人工清单）" -- \
  packages/server/scripts/backfill-question-refs.ts .gitignore \
  docs/superpowers/specs/2026-10-14-question-prerequisites-and-scenario-chains-design.md
```

---

## Task 7: 学生端提示条文案生成器（前端纯函数）

**Files:**
- Create: `packages/client/src/utils/question-refs-hint.ts`
- Test: `packages/client/src/utils/__tests__/question-refs-hint.test.ts`

**Interfaces:**
- Consumes: 服务端下发的 `requires` 形状（Task 8 定义：`{ tables?: string[]; fields?: { table: string; field: string }[]; views?: { table: string; view: string }[] }`）
- Produces: `buildRequirementHint(requires): string | null`——Task 8（学生页）与 Task 10（教师预览）都用它，**文案只有这一处**

- [ ] **Step 1: 写失败的测试**

创建 `packages/client/src/utils/__tests__/question-refs-hint.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildRequirementHint, type StudentRequires } from '../question-refs-hint';

describe('buildRequirementHint', () => {
  it('单表有字段：给出表名 + 字段清单 + 「先建它」的指引', () => {
    const hint = buildRequirementHint({
      tables: ['员工信息表'],
      fields: [{ table: '员工信息表', field: '姓名' }, { table: '员工信息表', field: '入职日期' }],
    });
    expect(hint).toBe(
      '本题需要「员工信息表」（含字段：姓名、入职日期）。若你的表格里还没有它，请先在左侧新建这张表并建好这些字段，再完成题目要求。',
    );
  });

  it('单表无字段', () => {
    expect(buildRequirementHint({ tables: ['订单管理表'] })).toBe(
      '本题需要「订单管理表」。若你的表格里还没有它，请先在左侧新建这张表，再完成题目要求。',
    );
  });

  it('多表：表名用顿号连接，字段按表分组', () => {
    const hint = buildRequirementHint({
      tables: ['任务表', '项目表'],
      fields: [{ table: '任务表', field: '所属项目' }],
    });
    expect(hint).toBe(
      '本题需要「任务表」「项目表」（任务表含字段：所属项目）。若你的表格里还没有它们，请先在左侧新建这些表并建好对应字段，再完成题目要求。',
    );
  });

  it('空 requires / null → 不显示提示条（返回 null）', () => {
    expect(buildRequirementHint(null)).toBeNull();
    expect(buildRequirementHint(undefined)).toBeNull();
    expect(buildRequirementHint({})).toBeNull();
    expect(buildRequirementHint({ tables: [], fields: [] })).toBeNull();
  });

  it('有视图时并入说明（视图由前序题创建的场景）', () => {
    const hint = buildRequirementHint({
      tables: ['员工信息表'],
      views: [{ table: '员工信息表', view: '员工总览' }],
    });
    expect(hint).toContain('视图「员工总览」');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/client && npx vitest run src/utils/__tests__/question-refs-hint.test.ts`
Expected: FAIL —— `Failed to resolve import "../question-refs-hint"`

- [ ] **Step 3: 实现生成器**

创建 `packages/client/src/utils/question-refs-hint.ts`：

```ts
/**
 * 前置提示条文案生成器（纯函数）。
 *
 * 为什么单独抽出来：同一段文案要在三个地方出现 —— 学生考试页、教师出题页的预览、
 * 以及将来的移动端；文案散落各处一定会漂移。判分不读它，改文案零风险。
 */

export interface FieldRef { table: string; field: string }
export interface ViewRef { table: string; view: string }

/** 学生端下发的 requires（服务端已剥掉 creates，避免泄露预期产物） */
export interface StudentRequires {
  tables?: string[];
  fields?: FieldRef[];
  views?: ViewRef[];
}

export function buildRequirementHint(requires?: StudentRequires | null): string | null {
  const tables = requires?.tables ?? [];
  const fields = requires?.fields ?? [];
  const views = requires?.views ?? [];
  if (tables.length === 0 && fields.length === 0 && views.length === 0) return null;

  const quoted = tables.map(t => `「${t}」`).join('');
  const multi = tables.length > 1;

  // 字段按表分组展示：同一张表的字段跟上表名
  const fieldGroups = new Map<string, string[]>();
  for (const f of fields) {
    if (!fieldGroups.has(f.table)) fieldGroups.set(f.table, []);
    fieldGroups.get(f.table)!.push(f.field);
  }
  const fieldText = fieldGroups.size > 0
    ? `（${[...fieldGroups.entries()].map(([t, fs]) => (multi ? `${t}含字段：` : '含字段：') + fs.join('、')).join('；')}）`
    : '';

  const viewText = views.length > 0
    ? `；另需要视图${views.map(v => `「${v.view}」`).join('')}`
    : '';

  const createHint = multi
    ? '若你的表格里还没有它们，请先在左侧新建这些表并建好对应字段，再完成题目要求。'
    : '若你的表格里还没有它，请先在左侧新建这张表' + (fieldGroups.size > 0 ? '并建好这些字段' : '') + '，再完成题目要求。';

  return `${tables.length > 0 ? `本题需要${quoted}` : '本题需要以下结构'}${fieldText}${viewText}。${createHint}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/client && npx vitest run src/utils/__tests__/question-refs-hint.test.ts`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(client): 前置提示条文案生成器（考试页与出题预览共用）" -- \
  packages/client/src/utils/question-refs-hint.ts \
  packages/client/src/utils/__tests__/question-refs-hint.test.ts
```

---

## Task 8: 考试侧——下发 requires + 学生答题页提示条

**Files:**
- Modify: `packages/server/src/routes/my-exams.ts`（`toStudentQuestion`，158-176 行）
- Modify: `packages/client/src/pages/student/WpsExamDoing.tsx`（题目描述与 hints 之间，约 510-520 行）
- Create: `packages/client/src/utils/rule-message.ts`（把「未找到表「X」」翻成人话；Task 15 复用）
- Modify: `packages/client/src/pages/student/ExamResult.tsx`（规则明细的 Tooltip 文案，188 行）
- Test: `packages/server/src/routes/__tests__/my-exams-student-requires.test.ts`

**Interfaces:**
- Consumes: `buildRequirementHint`（Task 7）、`Question.schemaRefs.requires`（Task 1 的形状）
- Produces: 学生接口下发的题目对象新增可选字段 `requires: { tables: string[]; fields: {table,field}[]; views: {table,view}[] }`（**只含 requires，绝不含 creates / answerRules**）；客户端 `friendlyRuleMessage(errorMessage): string | undefined`（Task 15 的归因复用同一个正则）

- [ ] **Step 1: 写失败的服务端测试**

创建 `packages/server/src/routes/__tests__/my-exams-student-requires.test.ts`：

```ts
/**
 * 安全边界回归：学生下发里可以有 requires（提示用），
 * 但 answerRules / analysis / creates 一律不得出现（那是答案）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 's-1', userId: 's-1', username: 's-1', role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

const questionRow = {
  id: 'q-1', title: '创建时间字段', description: '在「员工信息表」中新建时间字段「打卡时间」', type: 'comprehensive',
  difficulty: 'medium', score: 10, hints: null, tags: [], primaryCategoryId: null, secondaryCategoryId: null,
  answerRules: [{ id: 'r1', action: 'check_field', params: { tableName: '员工信息表', fieldName: '打卡时间' }, score: 100 }],
  analysis: '标准答案是……',
  schemaRefs: {
    requires: { tables: ['员工信息表'], fields: [{ table: '员工信息表', field: '姓名' }], views: [] },
    creates: { tables: [], fields: [{ table: '员工信息表', field: '打卡时间' }], views: [] },
    tables: ['员工信息表'],
    fields: ['姓名', '打卡时间'],
  },
  sortOrder: 0,
};

vi.mock('../../config/prisma', () => ({
  prisma: {
    exam: { findUnique: vi.fn().mockResolvedValue({ id: 'e-1', status: 'in_progress', endTime: null, startTime: null, batch: null }) },
    studentExamQuestion: { findMany: vi.fn().mockResolvedValue([{ questionId: 'q-1', sortOrder: 0, score: 10, question: questionRow }]) },
    examTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'https://x', accessToken: null }) },
    submission: { findFirst: vi.fn().mockResolvedValue({ id: 'sub-1', status: 'in_progress' }) },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}));

import { myExamRouter } from '../my-exams';

const app = express();
app.use(express.json());
app.use('/api/my-exams', myExamRouter);

describe('学生题目下发的前置契约', () => {
  it('下发 requires，且绝不下发 answerRules / analysis / creates', async () => {
    const res = await request(app).get('/api/my-exams/e-1');
    expect(res.status).toBe(200);
    const q = (res.body.questions ?? res.body.data?.questions ?? [])[0];
    expect(q.requires).toEqual({
      tables: ['员工信息表'],
      fields: [{ table: '员工信息表', field: '姓名' }],
      views: [],
    });
    expect(JSON.stringify(res.body)).not.toContain('answerRules');
    expect(JSON.stringify(res.body)).not.toContain('打卡时间');
    expect(q.creates).toBeUndefined();
  });
});
```

> 注：`/api/my-exams/:id` 的实际返回结构以该路由现有实现为准（`my-exams.ts:284` 附近）；若字段名不同（如 `questions` 直接在 body 上），按实际调整断言里的取法，**但三条安全断言（无 answerRules / 无 analysis / 无 creates）必须保留**。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/my-exams-student-requires.test.ts`
Expected: FAIL —— `q.requires` 为 `undefined`

- [ ] **Step 3: 服务端下发 requires**

在 `packages/server/src/routes/my-exams.ts` 的 `toStudentQuestion` 里，`options` 之后加：

```ts
  // 前置契约：只下发 requires（学生需要准备什么），creates 是预期产物、属于答案信息，绝不下发。
  // 空 requires 不发字段，前端据此不渲染提示条。
  const req = q?.schemaRefs?.requires;
  const requires = req && (req.tables?.length || req.fields?.length || req.views?.length)
    ? {
        tables: Array.isArray(req.tables) ? req.tables.map(String) : [],
        fields: Array.isArray(req.fields) ? req.fields.map((f: any) => ({ table: String(f?.table ?? ''), field: String(f?.field ?? '') })) : [],
        views: Array.isArray(req.views) ? req.views.map((v: any) => ({ table: String(v?.table ?? ''), view: String(v?.view ?? '') })) : [],
      }
    : undefined;
```

并把返回对象改为：

```ts
  return {
    id, title, description, type, difficulty, score, hints, tags, primaryCategoryId, secondaryCategoryId,
    ...(options ? { options } : {}),
    ...(requires ? { requires } : {}),
    ...extra,
  };
```

- [ ] **Step 4: 客户端渲染提示条**

在 `packages/client/src/pages/student/WpsExamDoing.tsx` 里 import：

```tsx
import { buildRequirementHint } from '../../utils/question-refs-hint';
```

在题目「描述卡片」与「操作提示」Alert 之间（约 516-518 行）插入：

```tsx
{/* 前置提示条：告诉学生"没有这张表是正常的，先建它" —— 自包含化就靠这一条 */}
{(() => {
  const hint = buildRequirementHint((currentQuestion as any).requires);
  if (!hint) return null;
  return (
    <Alert
      type="info"
      showIcon
      icon={<InfoCircleOutlined />}
      message="开始前请确认表格结构"
      description={hint}
      style={{ marginBottom: 16 }}
    />
  );
})()}
```

（`InfoCircleOutlined` 从 `@ant-design/icons` 补 import；若该文件已用别的 info 图标，沿用现成的那一个。）

- [ ] **Step 5: 考试结果页把「未找到表「X」」翻成人话**

创建 `packages/client/src/utils/rule-message.ts`：

```ts
/**
 * 判分规则的 errorMessage → 学生能懂的话。
 * 「未找到表「员工信息表」」对系统是准确的，对学生是黑话——他需要的是"去建这张表"。
 */
export const MISSING_TABLE_RE = /未找到表「(.+?)」|表「(.+?)」不存在/;

/** 提取缺失的表名；不是缺表类的 message 返回 null */
export function extractMissingTable(errorMessage?: string | null): string | null {
  const m = MISSING_TABLE_RE.exec(errorMessage ?? '');
  return m?.[1] ?? m?.[2] ?? null;
}

export function friendlyRuleMessage(errorMessage?: string | null): string | undefined {
  const table = extractMissingTable(errorMessage);
  if (table) return `你的表格里没有「${table}」这张表 —— 本题要求在这张表上操作，请先把它建出来`;
  return errorMessage || undefined;
}
```

在 `ExamResult.tsx` 的规则明细处（188 行）把 Tooltip 的 title 换掉：

```tsx
// import { friendlyRuleMessage } from '../../utils/rule-message';
title={friendlyRuleMessage(vr.errorMessage) || `${actionLabels[vr.action] || vr.action}`}
```

（教师阅卷页 `GradingPage.tsx:325` 已经在展示 errorMessage，教师看得懂原话，本次不动。）

- [ ] **Step 6: 跑测试 + 类型检查 + 提交**

Run: `cd packages/server && npx vitest run src/routes/__tests__/my-exams-student-requires.test.ts && npm run typecheck -w packages/server`
Expected: PASS 且 tsc 无错

Run: `cd packages/client && npm run typecheck`
Expected: 无错

```bash
git commit -m "feat(exam): 答题页前置提示条 + 下发 requires + 缺表话术（不含 creates/答案）" -- \
  packages/server/src/routes/my-exams.ts \
  packages/server/src/routes/__tests__/my-exams-student-requires.test.ts \
  packages/client/src/pages/student/WpsExamDoing.tsx \
  packages/client/src/pages/student/ExamResult.tsx \
  packages/client/src/utils/rule-message.ts
```

---

## Task 9: 组卷——fixed 题位继承 schemaRefs + rule 题位可见可编辑

**Files:**
- Modify: `packages/server/src/routes/papers.ts`（`PUT /:id/questions`，约 274-292 行）
- Modify: `packages/client/src/utils/paperAssembly.ts`（`RuleEditorItem.schemaRefs` 注释与搬运，43-44 行）
- Modify: `packages/client/src/pages/teacher/PaperEditor.tsx`（规则行的 schemaRefs 输入）
- Test: `packages/server/src/routes/__tests__/papers-schema-refs-inherit.test.ts` + `packages/client/src/utils/__tests__/paperAssembly.test.ts`（扩展）

**Interfaces:**
- Consumes: `Question.schemaRefs`（列已存在）
- Produces: ① fixed 题位落库时 `rule` 为空且题位未显式声明——**不用 rule**，改为落 `schemaRefs` 到 `paperQuestions.rule` 的 `{ schemaRefs }`？**不**——fixed 题位不写 rule；继承改为「不下发额外字段，只保证抽题题位可用」。
  **最终实现（简单且够用）**：`PUT /:id/questions` 对 `slotType === 'rule'` 且 `rule.schemaRefs` 为空的题位，**不再猜**；对 fixed 题位不做任何声明（学生拿到的是那道具体的题，结构天然一致）。真正要修的是 rule 题位：教师能声明 + 服务端落库。见 Step 3。

> ⚠️ 实现前先读这两处现有代码：`routes/papers.ts:274-292`（写库）与 `utils/paperAssembly.ts:43-70`（分组/透传）。下面改动以「rule 题位的 schemaRefs 可编辑 + 精确落库」为核心，fixed 题位保持不动。

- [ ] **Step 1: 写失败的服务端测试**

创建 `packages/server/src/routes/__tests__/papers-schema-refs-inherit.test.ts`：

```ts
/**
 * 组卷断链修复的回归测试：题位 rule.schemaRefs 必须原样落库。
 *
 * 背景：教师以前在组卷页根本无法编辑 schemaRefs（UI 标注「不编辑，仅透传」），
 * 导致 paper-generator 的 strict 等值校验永远拿到空签名、形同虚设。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 't-1', userId: 't-1', username: 't-1', role: 'teacher', permissions: [], departmentId: 'd-1' };
      next();
    },
  };
});

const createMany = vi.fn().mockResolvedValue({ count: 1 });
vi.mock('../../config/prisma', () => ({
  prisma: {
    paper: {
      findUnique: vi.fn().mockResolvedValue({ id: 'p-1', createdBy: 't-1', departmentId: 'd-1', paperQuestions: [] }),
      update: vi.fn().mockResolvedValue({ id: 'p-1', paperQuestions: [] }),
    },
    paperQuestion: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany },
    question: { findMany: vi.fn().mockResolvedValue([{ id: 'q-1' }]) },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
}));

import { paperRouter } from '../papers';

const app = express();
app.use(express.json());
app.use('/api/papers', paperRouter);

describe('PUT /api/papers/:id/questions —— rule 题位的 schemaRefs', () => {
  beforeEach(() => createMany.mockClear());

  it('题位声明的 schemaRefs 原样落库（不再被吞掉）', async () => {
    const res = await request(app)
      .put('/api/papers/p-1/questions')
      .send({
        questions: [
          {
            slotType: 'rule', sortOrder: 0, score: 10,
            rule: { type: 'add_field', difficulty: 'easy', capabilityIds: [], schemaRefs: { tables: ['员工信息表'], fields: [] } },
          },
        ],
        totalScore: 10,
      });
    expect(res.status).toBeLessThan(400);
    const arg = createMany.mock.calls[0][0].data[0];
    expect(arg.rule.schemaRefs).toEqual({ tables: ['员工信息表'], fields: [] });
  });
});
```

> 注：mock 需要覆盖 `PUT /:id/questions` 实际用到的 prisma 方法（含题库可见性查询 `question.findMany`）；跑第一遍若报「未 mock 的方法」，按报错补进上面的 mock 对象，**不要改路由实现去迁就 mock**。

- [ ] **Step 2: 跑测试确认失败（或直接通过）**

Run: `cd packages/server && npx vitest run src/routes/__tests__/papers-schema-refs-inherit.test.ts`

- 若 FAIL（例如 rule 被清洗）：按 Step 3 修。
- 若 PASS：说明服务端本来就原样落库（设计文档判断的"断链在客户端"成立）→ **在测试文件顶部注释里写明「服务端本就正确，本用例防回归」**，然后跳过 Step 3，直接做 Step 4 的客户端改动。

- [ ] **Step 3: （仅在 Step 2 失败时）服务端保证 rule 原样落库**

`routes/papers.ts` 的 `createMany` 数据映射保持 `rule: (q.rule ?? undefined) as any`，不要对它做任何字段过滤/清洗；若发现被清洗，删掉清洗代码并在此处补注释：

```ts
              // rule 原样落库：schemaRefs 是抽题等值校验的唯一依据，
              // 清洗字段 = 悄悄关掉「同题位候选题引用同一份结构」的保证
              rule: (q.rule ?? undefined) as any,
```

- [ ] **Step 4: 客户端让 rule 题位的 schemaRefs 可编辑**

1. `packages/client/src/utils/paperAssembly.ts`：把 `schemaRefs` 的注释从「UI 不编辑，仅透传保留」改成：

```ts
  /** 引用结构声明：抽题等值校验依据；教师可在组卷页编辑（留空 = 不校验） */
  schemaRefs?: SchemaRefs | null;
```

`sameRuleGroup` 里对 schemaRefs 的比较保持现状（顺序无关的 JSON 比较已够用）。

2. `packages/client/src/pages/teacher/PaperEditor.tsx`：在每条 rule 行的「知识点」选择器后加一组输入（表名/字段名，回车添加），写回 `item.schemaRefs`：

```tsx
<Select
  mode="tags"
  placeholder="需要同结构的表名（如：员工信息表）"
  value={item.schemaRefs?.tables ?? []}
  onChange={(v) => updateItem(item.key, { schemaRefs: { ...(item.schemaRefs ?? {}), tables: v } })}
  style={{ width: 240 }}
  tokenSeparators={[',', '，']}
/>
```

（`updateItem` 用该文件现有的行内更新函数；若不存在，用 `setItems(items.map(i => i.key === item.key ? { ...i, schemaRefs: ... } : i))` 的现有写法。）

3. 扩展 `packages/client/src/utils/__tests__/paperAssembly.test.ts`：加一条「rule 行带 schemaRefs 往返不丢」的用例（构造 items → 序列化成 questions → 再解析回来，断言 schemaRefs 一致）。

- [ ] **Step 5: 跑测试 + 提交**

Run: `cd packages/server && npx vitest run src/routes/__tests__/papers-schema-refs-inherit.test.ts && cd ../../packages/client && npx vitest run src/utils/__tests__/paperAssembly.test.ts`
Expected: 两侧 PASS

```bash
git commit -m "fix(papers): rule 题位 schemaRefs 可见可编辑并原样落库（接通抽题等值校验）" -- \
  packages/server/src/routes/papers.ts \
  packages/server/src/routes/__tests__/papers-schema-refs-inherit.test.ts \
  packages/client/src/utils/paperAssembly.ts \
  packages/client/src/pages/teacher/PaperEditor.tsx \
  packages/client/src/utils/__tests__/paperAssembly.test.ts
```

---

## Task 10: 教师端——题目编辑器的「前置契约」卡片

**Files:**
- Modify: `packages/client/src/pages/teacher/QuestionEditor.tsx`（现「引用声明」卡片，558-593 行）
- Modify: `packages/client/src/services/api.ts`（加 `deriveRefs`）

**Interfaces:**
- Consumes: `POST /api/questions/derive-refs`（Task 5）、`buildRequirementHint`（Task 7）
- Produces: 编辑器把 `schemaRefs`（含 requires/creates/tables/fields）写回题目——Task 6 的回填脚本之外，教师手动校正也走这条路

- [ ] **Step 1: api.ts 加方法**

在 `packages/client/src/services/api.ts` 的题库相关分组里加：

```ts
  /** 从判分规则推导前置契约（出题页「自动推导」按钮） */
  deriveRefs: (rules: Array<{ id?: string; action: string; params?: Record<string, unknown>; score?: number }>) =>
    api.post<{ refs: SchemaRefs; unresolved: string[] }>('/questions/derive-refs', { rules }),
```

（`SchemaRefs` 类型从 `../types` 引入；若 types 里还没有，按 Task 1 的服务端形状补 `interface SchemaRefs { requires: {...}; creates: {...}; tables?: string[]; fields?: string[] }`。）

- [ ] **Step 2: 改造卡片**

把「引用声明」卡片替换为「前置契约」卡片（保留原有两个 Select 作为 fallback）：

```tsx
{/* 前置契约：抽题等值校验 + 学生提示条的唯一依据（requires 下发学生，creates 只用于归链与推断） */}
<Card
  title={<Space><span>前置契约</span><Tag color="geekblue">提示条 / 抽题校验依据</Tag></Space>}
  style={{ marginBottom: 16 }}
>
  <Alert
    type="info"
    showIcon
    style={{ marginBottom: 12 }}
    message="「需要」会渲染成学生答题页的提示条（告诉学生缺表时先建）；「涉及的表」是抽题等值校验的签名。填了它，学生才不会打开表格找不到题面说的表。"
  />
  <Space style={{ marginBottom: 12 }}>
    <Button
      size="small"
      onClick={async () => {
        try {
          const res = await questionApi.deriveRefs(rules.map(r => ({ action: r.action, params: r.params, score: r.score })));
          setSchemaRefs(res.data.refs);
          setDeriveUnresolved(res.data.unresolved);
          message.success(res.data.unresolved.length > 0
            ? `已推导，${res.data.unresolved.length} 条规则推不出来（见下方提示）`
            : '已推导，请核对后保存');
        } catch { message.error('推导失败，请稍后重试'); }
      }}
    >
      从判分规则自动推导
    </Button>
    {deriveUnresolved.length > 0 && (
      <Text type="warning">推不出的规则：{deriveUnresolved.join('、')}（需人工填写）</Text>
    )}
  </Space>

  <Row gutter={16} style={{ marginBottom: 12 }}>
    <Col span={8}>
      <div style={{ marginBottom: 4 }}>需要（表名）</div>
      <Select mode="tags" value={schemaRefs?.requires?.tables ?? schemaRefs?.tables ?? []}
        onChange={v => setSchemaRefs(s => ({ ...(s ?? { requires: { tables: [], fields: [], views: [] }, creates: { tables: [], fields: [], views: [] } }), requires: { ...(s?.requires ?? { fields: [], views: [] }), tables: v } } as any))}
        style={{ width: '100%' }} tokenSeparators={[',', '，']} placeholder="如：员工信息表" />
    </Col>
    <Col span={8}>
      <div style={{ marginBottom: 4 }}>需要（字段名）</div>
      <Select mode="tags"
        value={(schemaRefs?.requires?.fields ?? []).map(f => f.field)}
        onChange={v => setSchemaRefs(s => ({ ...(s as any), requires: { ...(s?.requires ?? { tables: [], views: [] }), fields: v.map(f => ({ table: (s?.requires?.tables ?? [''])[0] ?? '', field: f })) } }))}
        style={{ width: '100%' }} tokenSeparators={[',', '，']} placeholder="如：姓名" />
    </Col>
    <Col span={8}>
      <div style={{ marginBottom: 4 }}>涉及的表（抽题校验签名）</div>
      <Select mode="tags" value={schemaRefs?.tables ?? []}
        onChange={v => setSchemaRefs(s => ({ ...(s as any), tables: v }))}
        style={{ width: '100%' }} tokenSeparators={[',', '，']} placeholder="留空 = 不校验" />
    </Col>
  </Row>

  {/* 学生端预览：文案与考试页逐字一致（同一个 buildRequirementHint） */}
  {(() => {
    const hint = buildRequirementHint(schemaRefs?.requires);
    return hint ? (
      <Alert type="success" showIcon message="学生将看到" description={hint} />
    ) : (
      <Text type="secondary">未填写「需要」——学生答题页不会出现提示条。</Text>
    );
  })()}
</Card>
```

组件顶部补 state 与 import：

```tsx
const [deriveUnresolved, setDeriveUnresolved] = useState<string[]>([]);
// import { buildRequirementHint } from '../../utils/question-refs-hint';
```

- [ ] **Step 3: 手工验证（本地起两端）**

Run: `npm run dev`（根目录），浏览器登录教师账号 → 题库 → 打开「创建时间字段并区分与日期字段的差异」→ 点「从判分规则自动推导」
Expected: 「需要（表名）」出现 `员工信息表`；「学生将看到」预览出现与设计文档逐字一致的提示条。改动保存后刷新页面，值仍在。

（若该题目还没跑过 Task 6 的回填，先跑一次 `--apply`。）

- [ ] **Step 4: 提交**

```bash
git commit -m "feat(teacher): 出题页前置契约卡片（自动推导 + 学生端预览）" -- \
  packages/client/src/pages/teacher/QuestionEditor.tsx \
  packages/client/src/services/api.ts \
  packages/client/src/types/index.ts
```

---

## Task 11: 教师端——题库列表场景列 + 场景筛选

**Files:**
- Modify: `packages/server/src/routes/questions.ts`（`GET /` 增加 `scenario` 查询参数 + 每行附「规则是否可自动判分」）
- Modify: `packages/server/src/engine/rule-engine.ts`（导出 `getSupportedActions()`）
- Modify: `packages/client/src/pages/teacher/QuestionBank.tsx`

**Interfaces:**
- Consumes: `Question.scenario/scenarioOrder`（Task 4，列表接口已返回完整 Question 对象，无需改 select）
- Produces: `getSupportedActions(): string[]`（返回 `ruleHandlers` 的 key，Task 16 的候选池过滤复用）；题库列表每行新增计算字段 `unsupportedActions: string[]`（空 = 全部规则可判分）；「场景 / 顺序」两列与场景筛选——教师核对 Task 6 回填结果的界面

- [ ] **Step 1: 服务端加筛选参数**

`routes/questions.ts` 的 `GET /`：从 `req.query` 解构处加 `scenario`，并在 `conditions.push(...)` 区域加：

```ts
    // 场景筛选（练习成链：教师核对回填结果、按链检查顺序）
    if (scenario) conditions.push({ scenario: String(scenario) });
```

- [ ] **Step 2: 前端加列与筛选**

在 `QuestionBank.tsx` 的表格 columns 里、难度列附近加：

```tsx
{ title: '场景', dataIndex: 'scenario', width: 160, render: (v: string | null, r: any) => v ? <Tag color="geekblue">{v}{r.scenarioOrder ? ` · 第${r.scenarioOrder}步` : ''}</Tag> : <Text type="secondary">—</Text> },
```

筛选区加一个 Select（选项来自一次 `GET /api/questions/scenarios`——**新增轻量接口**，见下）：

```tsx
<Select allowClear placeholder="场景" style={{ width: 180 }} value={scenarioFilter}
  onChange={setScenarioFilter} options={scenarioOptions.map(s => ({ value: s, label: s }))} />
```

服务端同文件新增：

```ts
/** GET /api/questions/scenarios —— 场景清单（题库筛选器用；只返回名字与题数） */
questionRouter.get('/scenarios', async (_req: Request, res: Response) => {
  const rows = await prisma.question.groupBy({
    by: ['scenario'],
    where: { scenario: { not: null } },
    _count: { _all: true },
  });
  res.json(rows.filter(r => r.scenario).map(r => ({ scenario: r.scenario, count: r._count._all })));
});
```

> 路由注册顺序：`/scenarios` 必须放在 `/:id` 之前，否则会被当成题目 id。

- [ ] **Step 3: 标出「规则引擎判不了」的题**

`rule-engine.ts` 在 `ruleHandlers` 定义之后补：

```ts
/** 引擎支持的全部规则 action（出题/组卷侧判定"这题能不能自动判"） */
export function getSupportedActions(): string[] {
  return Object.keys(ruleHandlers);
}

/**
 * 这题的规则里有哪些引擎不认识的 action。
 * 空数组 = 全部可自动判（含"压根没有规则"的情况——那属于另一个问题，这里不碰）。
 */
export function unsupportedRuleActions(rules: unknown): string[] {
  if (!Array.isArray(rules)) return [];
  const supported = new Set(Object.keys(ruleHandlers));
  return [...new Set(
    rules.map(r => String((r as any)?.action ?? '')).filter(a => a && !supported.has(a)),
  )];
}
```

`routes/questions.ts` 顶部补 `import { unsupportedRuleActions } from '../engine/rule-engine';`，并在 `GET /` 的 `res.json` 前给每行附上计算字段（列表页每页只有二三十行，现算足够便宜）：

```ts
    // 哪些规则引擎不认 —— 这类题永远走 needsReview，不该出现在组卷候选池里。
    // 现算而不入库：规则实现变化时，标记自动跟着变，不会留下过期状态。
    const data = questions.map(q => ({ ...q, unsupportedActions: unsupportedRuleActions(q.answerRules) }));

    res.json({ data, total, page: Number(page), pageSize: Number(take) });
```

`QuestionBank.tsx` 的题目名称列旁加一个红 Tag（现有标题列的 render 里追加）：

```tsx
{r.unsupportedActions?.length > 0 && (
  <Tooltip title={`规则引擎未实现：${r.unsupportedActions.join('、')} —— 这题永远转人工，不能进考试抽题池`}>
    <Tag color="error" style={{ marginLeft: 4 }}>判分规则未支持</Tag>
  </Tooltip>
)}
```

- [ ] **Step 4: 手工验证**

Run: `npm run dev` → 教师 → 题库
Expected: 列表出现「场景」列，大部分实操题显示 `员工信息表 · 第N步`；用筛选器选「员工信息表」只剩这条链的题；顺序与设计文档的链条一致（建表第 1 步）；「创建仪表盘并添加柱状图」等 16 道题带红色「判分规则未支持」Tag。

- [ ] **Step 5: 提交**

```bash
git commit -m "feat(teacher): 题库场景列/场景筛选 + 标出引擎判不了的题（导出 getSupportedActions）" -- \
  packages/server/src/routes/questions.ts \
  packages/server/src/engine/rule-engine.ts \
  packages/client/src/pages/teacher/QuestionBank.tsx
```

---

## Task 12: 练习侧——场景列表接口 + 场景卡片入口

**Files:**
- Modify: `packages/server/src/routes/practice.ts`（新增 `GET /scenarios`）
- Modify: `packages/client/src/pages/student/PracticeList.tsx`
- Modify: `packages/client/src/services/api.ts`
- Test: `packages/server/src/routes/__tests__/practice-scenarios.test.ts`

**Interfaces:**
- Consumes: `Question.scenario/scenarioOrder`、`PracticeRecord`
- Produces: `GET /api/practice/scenarios` → `{ scenarios: Array<{ key: string; name: string; questionCount: number; totalScore: number; running?: { recordId: string; startedAt: string }; latest?: { recordId: string; score: number; maxScore: number; passed: boolean; submittedAt: string } }> }`——Task 13 的开练按钮依赖 `key`

- [ ] **Step 1: 写失败的服务端测试**

创建 `packages/server/src/routes/__tests__/practice-scenarios.test.ts`：

```ts
/**
 * 场景列表接口：只出题数 ≥ 2 的场景（单题场景走自由练习），
 * 并带上该生「进行中」与「最近一次完成」两种记录，供卡片显示进度。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 's-1', userId: 's-1', username: 's-1', role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

const groupBy = vi.fn().mockResolvedValue([
  { scenario: '员工信息表', _count: { _all: 19 }, _sum: { score: 190 } },
  { scenario: '孤立场景', _count: { _all: 1 }, _sum: { score: 10 } },
]);
const findMany = vi.fn().mockResolvedValue([
  {
    id: 'rec-1', status: 'in_progress', score: null, maxScore: 190, passed: null,
    startedAt: new Date('2026-10-14T01:00:00Z'), submittedAt: null,
    questions: [{ questionId: 'q1', scenarioKey: '员工信息表' }],
  },
]);

vi.mock('../../config/prisma', () => ({
  prisma: {
    question: { groupBy },
    practiceRecord: { findMany, findFirst: vi.fn().mockResolvedValue(null) },
    practiceTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'u' }) },
  },
}));

import { practiceRouter } from '../practice';

const app = express();
app.use(express.json());
app.use('/api/practice', practiceRouter);

describe('GET /api/practice/scenarios', () => {
  it('过滤掉单题场景，并带出进行中的记录', async () => {
    const res = await request(app).get('/api/practice/scenarios');
    expect(res.status).toBe(200);
    const keys = res.body.scenarios.map((s: any) => s.key);
    expect(keys).toEqual(['员工信息表']);
    const s = res.body.scenarios[0];
    expect(s.questionCount).toBe(19);
    expect(s.totalScore).toBe(190);
    expect(s.running).toEqual({ recordId: 'rec-1', startedAt: '2026-10-14T01:00:00.000Z' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/practice-scenarios.test.ts`
Expected: FAIL —— 404

- [ ] **Step 3: 实现接口**

在 `packages/server/src/routes/practice.ts` 加（放在 `POST /start` 之前）：

```ts
/**
 * GET /api/practice/scenarios —— 「场景实战」卡片列表。
 *
 * 只出题数 ≥ 2 的场景（单题场景在自由练习里抽得到，做成卡片反而奇怪）。
 * 进度取该生最近一条记录：进行中的给 running，已判分的给 latest。
 */
practiceRouter.get('/scenarios', async (req: Request, res: Response) => {
  try {
    const studentId = req.user!.userId;

    const groups = await prisma.question.groupBy({
      by: ['scenario'],
      where: { scenario: { not: null }, status: 'published', type: { in: PRACTICE_QUESTION_TYPES } },
      _count: { _all: true },
      _sum: { score: true },
    });

    const multi = groups.filter(g => g.scenario && g._count._all >= 2);

    // 该生最近 200 条练习记录里，每个场景取"最新一条"：进行中优先于已完成
    const records = await prisma.practiceRecord.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, status: true, score: true, maxScore: true, passed: true,
        startedAt: true, submittedAt: true, questions: true,
      },
    });

    const byScenario = new Map<string, typeof records[number]>();
    for (const r of records) {
      const key = (r.questions as any[])?.[0]?.scenarioKey;
      if (!key) continue;
      const cur = byScenario.get(key);
      // 进行中的记录优先展示（学生更关心"没做完的那条"）
      if (!cur || (cur.status === 'graded' && r.status === 'in_progress')) byScenario.set(key, r);
    }

    res.json({
      scenarios: multi
        .map(g => {
          const rec = byScenario.get(g.scenario!);
          return {
            key: g.scenario!,
            name: g.scenario!,
            questionCount: g._count._all,
            totalScore: g._sum.score ?? 0,
            running: rec?.status === 'in_progress'
              ? { recordId: rec.id, startedAt: rec.startedAt.toISOString() }
              : undefined,
            latest: rec?.status === 'graded'
              ? {
                  recordId: rec.id,
                  score: rec.score ?? 0,
                  maxScore: rec.maxScore,
                  passed: rec.passed ?? false,
                  submittedAt: rec.submittedAt?.toISOString() ?? rec.startedAt.toISOString(),
                }
              : undefined,
          };
        })
        .sort((a, b) => a.key.localeCompare(b.key)),
    });
  } catch (err: any) {
    console.error('Practice scenarios error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 4: 客户端 api + 卡片区**

`packages/client/src/services/api.ts` 加：

```ts
  scenarios: () => api.get('/practice/scenarios'),
```

`PracticeList.tsx`：在筛选 Card 之前插入场景卡片区（数据 `practiceApi.scenarios()`，加载失败静默不显示）：

```tsx
{scenarios.length > 0 && (
  <Card title="场景实战（按顺序做完整条任务链）" style={{ marginBottom: 16 }}>
    <Row gutter={[12, 12]}>
      {scenarios.map(s => (
        <Col key={s.key} xs={24} sm={12} lg={8}>
          <Card size="small" hoverable data-scenario={s.key}>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            <div style={{ fontSize: 12, color: '#888', margin: '4px 0 8px' }}>
              共 {s.questionCount} 步 · 满分 {s.totalScore}
            </div>
            {s.running && <Tag color="processing">进行中，可继续</Tag>}
            {!s.running && s.latest && (
              <Tag color={s.latest.passed ? 'success' : 'default'}>
                已完成 {s.latest.score}/{s.latest.maxScore}
              </Tag>
            )}
            {!s.running && !s.latest && <Tag>未开始</Tag>}
          </Card>
        </Col>
      ))}
    </Row>
  </Card>
)}
```

本任务**只交付接口与卡片渲染**，卡片上暂不挂点击（`data-scenario` 属性先埋好）——「开练」的确认框与导航在 Task 13 接上。这样每个任务结束时的产物都是完整可用的（卡片先能看数据，点击行为随开练一起来）。

- [ ] **Step 5: 跑测试 + 提交**

Run: `cd packages/server && npx vitest run src/routes/__tests__/practice-scenarios.test.ts`
Expected: PASS

```bash
git commit -m "feat(practice): 场景列表接口 + 练习页场景卡片（题数≥2 才出卡片）" -- \
  packages/server/src/routes/practice.ts \
  packages/server/src/routes/__tests__/practice-scenarios.test.ts \
  packages/client/src/pages/student/PracticeList.tsx \
  packages/client/src/services/api.ts
```

---

## Task 13: 练习侧——按链开练（scenarioKey）

**Files:**
- Modify: `packages/server/src/routes/practice.ts`（`startSchema` + `POST /start`）
- Modify: `packages/client/src/pages/student/PracticeList.tsx`（接上卡片点击）
- Test: `packages/server/src/routes/__tests__/practice-start-scenario.test.ts`

**Interfaces:**
- Consumes: `scenario`/`scenarioOrder`（Task 4）
- Produces: `POST /api/practice/start` 支持 `{ scenarioKey }`；快照元素新增 `scenarioKey` 与 `requires`/`creates`（Task 14/15 依赖）；超过 50 题返回 400

- [ ] **Step 1: 写失败的服务端测试**

创建 `packages/server/src/routes/__tests__/practice-start-scenario.test.ts`：

```ts
/**
 * 按场景开练：取整个场景、按 scenarioOrder 排序、不随机；上限 50，超过直接拒绝。
 * 同时锁定「与 questionIds / 分类参数互斥」的 400。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 's-1', userId: 's-1', username: 's-1', role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

const findMany = vi.fn();
const create = vi.fn().mockResolvedValue({ id: 'rec-1' });
vi.mock('../../config/prisma', () => ({
  prisma: {
    practiceTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'u', accessToken: 't' }) },
    question: { findMany, count: vi.fn().mockResolvedValue(0) },
    practiceRecord: { create, deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}));
vi.mock('../../services/wps-config-service', () => ({
  wpsConfigService: { getValidAccessToken: vi.fn().mockResolvedValue('token') },
}));
vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  KingsoftAdapter: class { async resetFile() { return true; } },
}));

import { practiceRouter } from '../practice';

const app = express();
app.use(express.json());
app.use('/api/practice', practiceRouter);

const q = (id: string, order: number) => ({
  id, title: `题${order}`, description: null, type: 'comprehensive', difficulty: 'medium',
  score: 10, answerRules: [], analysis: null, hints: null, scenario: '员工信息表', scenarioOrder: order,
});

describe('POST /api/practice/start 按场景开练', () => {
  beforeEach(() => { findMany.mockReset(); create.mockClear(); });

  it('按 scenarioOrder 出题，快照带 scenarioKey', async () => {
    findMany.mockResolvedValue([q('q1', 1), q('q2', 2)]);
    const res = await request(app).post('/api/practice/start').send({ scenarioKey: '员工信息表' });
    expect(res.status).toBe(200);
    expect(res.body.questions.map((x: any) => x.questionId)).toEqual(['q1', 'q2']);
    const snapshot = create.mock.calls[0][0].data.questions;
    expect(snapshot[0].scenarioKey).toBe('员工信息表');
  });

  it('场景题数超过 50 → 400 且不重置文件', async () => {
    findMany.mockResolvedValue(Array.from({ length: 51 }, (_, i) => q(`q${i}`, i + 1)));
    const res = await request(app).post('/api/practice/start').send({ scenarioKey: '员工信息表' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('50');
    expect(create).not.toHaveBeenCalled();
  });

  it('与 questionIds 同时传 → 400', async () => {
    const res = await request(app).post('/api/practice/start')
      .send({ scenarioKey: '员工信息表', questionIds: ['11111111-1111-1111-1111-111111111111'] });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/practice-start-scenario.test.ts`
Expected: FAIL —— `scenarioKey` 被忽略（走随机抽题）或参数校验放行

- [ ] **Step 3: 实现**

`practice.ts` 的 `startSchema` 改为：

```ts
export const startSchema = z
  .object({
    primaryCategoryId: z.string().uuid().optional(),
    secondaryCategoryId: z.string().uuid().optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    count: z.number().int().min(1).max(20).default(5),
    // ✅ 个人题集「再练一次 / 勾选组卷」：按指定题目开练（与分类/难度随机抽题互斥）
    questionIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    // ✅ 场景实战：按场景整链开练（与上面两种互斥）
    scenarioKey: z.string().min(1).max(128).optional(),
  })
  .refine(
    (data) => !data.questionIds || (!data.primaryCategoryId && !data.secondaryCategoryId && !data.difficulty),
    { message: 'questionIds 与 分类/难度 筛选不能同时使用', path: ['questionIds'] },
  )
  .refine(
    (data) => !data.scenarioKey || (!data.questionIds && !data.primaryCategoryId && !data.secondaryCategoryId && !data.difficulty),
    { message: 'scenarioKey 与 分类/难度/指定题目 不能同时使用', path: ['scenarioKey'] },
  );

/** 场景实战上限：超过它说明题库配置有问题（一条链不该这么长），拒绝而不是截断 */
const SCENARIO_MAX_QUESTIONS = 50;
```

`POST /start` 里，解构加 `scenarioKey`，抽题段改为：

```ts
    const { primaryCategoryId, secondaryCategoryId, difficulty, count, questionIds, scenarioKey } = startSchema.parse(req.body);
    ...
    const requestedIds = questionIds ? Array.from(new Set(questionIds)) : null;
    const where: any = { status: 'published' };
    where.type = { in: PRACTICE_QUESTION_TYPES };
    if (requestedIds) {
      where.id = { in: requestedIds };
    } else if (scenarioKey) {
      where.scenario = scenarioKey;
    } else {
      if (primaryCategoryId) where.primaryCategoryId = primaryCategoryId;
      if (secondaryCategoryId) where.secondaryCategoryId = secondaryCategoryId;
      if (difficulty) where.difficulty = difficulty;
    }

    const pool = await prisma.question.findMany({
      where,
      select: { id: true, title: true, description: true, type: true, difficulty: true, score: true, answerRules: true, analysis: true, hints: true, schemaRefs: true, scenario: true, scenarioOrder: true },
    });
```

`selected` 分支加：

```ts
    if (scenarioKey) {
      if (pool.length === 0) {
        return res.status(400).json({ message: '该场景下暂无可练习的题目' });
      }
      if (pool.length > SCENARIO_MAX_QUESTIONS) {
        return res.status(400).json({ message: `该场景题目过多（${pool.length} 题，上限 ${SCENARIO_MAX_QUESTIONS}），请联系教师拆分场景` });
      }
      // 教学顺序：严格按 scenarioOrder；没填序号的（不应出现，回填脚本保证）排最后
      selected = [...pool].sort((a, b) => (a.scenarioOrder ?? 9999) - (b.scenarioOrder ?? 9999));
    } else if (requestedIds) {
      ...
```

快照生成处改为带上场景与契约：

```ts
    const questionsSnapshot = selected.map((q, i) => ({
      questionId: q.id,
      score: q.score,
      sortOrder: i,
      // 场景链元数据：续做提示、判分归因都要用（旧记录没有这些字段，前端要容错）
      ...(scenarioKey ? { scenarioKey } : {}),
      ...(q.schemaRefs ? { requires: (q.schemaRefs as any)?.requires ?? null, creates: (q.schemaRefs as any)?.creates ?? null } : {}),
    }));
```

`res.json` 的 questions 里加 `requires`（链内练习暂不显示提示条，但快照带上便于二期逐步检查）：

```ts
      questions: selected.map((q, i) => ({
        questionId: q.id, sortOrder: i, title: q.title, description: q.description, type: q.type,
        difficulty: q.difficulty, score: q.score, hints: q.hints,
      })),
```

（`maxScore` 与后续逻辑不变。）

- [ ] **Step 4: 客户端接上点击**

`PracticeList.tsx`：实现 `handleStartScenario` 并挂到卡片上（`onClick={() => handleStartScenario(s.key)}`）：

```tsx
  const handleStartScenario = (key: string) => {
    const running = scenarios.find(s => s.key === key)?.running;            // 本场景没做完的那条
    const otherRunning = scenarios.find(s => s.key !== key && s.running);   // 别的场景在跑 → 会被中断

    if (running) {
      // 继续：走恢复路由，**不重新开练**（开练会 resetFile 清空表格、并删掉这条记录）
      Modal.confirm({
        title: '继续上次的场景实战？',
        content: '会回到你未完成的进度，表格内容保留。',
        okText: '继续', cancelText: '取消',
        onOk: () => navigate(`/student/practice/${running.recordId}`),
      });
      return;
    }

    // 同一个练习文件同一时刻只能有一条进行中的链：开新链必然清空表格
    Modal.confirm({
      title: '开始场景实战？',
      content: otherRunning
        ? `开始新的实战会清空当前表格，未完成的『${otherRunning.key}』将中断。`
        : `会清空你练习表格里的全部内容，从『${key}』第 1 步开始。`,
      okText: '开始', cancelText: '取消',
      onOk: async () => {
        const res = await practiceApi.start({ scenarioKey: key } as any);
        navigate(`/student/practice/${res.data.recordId}`, { state: res.data });
      },
    });
  };
```

（`practiceApi.start` 的类型签名若限定参数形状，补 `scenarioKey?: string`。）

- [ ] **Step 5: 跑测试 + 提交**

Run: `cd packages/server && npx vitest run src/routes/__tests__/practice-start-scenario.test.ts src/routes/__tests__/practice-scenarios.test.ts`
Expected: PASS

```bash
git commit -m "feat(practice): 按场景整链开练（scenarioKey，顺序出题，上限 50）" -- \
  packages/server/src/routes/practice.ts \
  packages/server/src/routes/__tests__/practice-start-scenario.test.ts \
  packages/client/src/pages/student/PracticeList.tsx \
  packages/client/src/services/api.ts
```

---

## Task 14: 练习侧——断点续做（记录恢复接口 + 前端）

**Files:**
- Modify: `packages/server/src/routes/practice.ts`（新增 `GET /records/:id`）
- Modify: `packages/client/src/pages/student/PracticeDoing.tsx`（恢复 + 步骤记忆）
- Test: `packages/server/src/routes/__tests__/practice-record-resume.test.ts`

**Interfaces:**
- Consumes: `PracticeRecord.questions` 快照（Task 13 已带 `scenarioKey`）
- Produces: `GET /api/practice/records/:id` → `{ recordId, questions, maxScore, shareUrl, startedAt }`；**只能取自己的记录**（403 否则）

- [ ] **Step 1: 写失败的服务端测试**

创建 `packages/server/src/routes/__tests__/practice-record-resume.test.ts`：

```ts
/**
 * 断点续做：刷新/换设备后能按 recordId 恢复题目快照。
 * 安全边界：别人的记录一律 403（快照里含题面与分值）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      const uid = (req.headers['x-test-user'] as string) || 's-1';
      req.user = { id: uid, userId: uid, username: uid, role: 'student', permissions: [], departmentId: null };
      next();
    },
  };
});

const findFirst = vi.fn();
vi.mock('../../config/prisma', () => ({
  prisma: {
    practiceRecord: { findFirst },
    practiceTableAssignment: { findUnique: vi.fn().mockResolvedValue({ fileId: 'f-1', shareUrl: 'https://share' }) },
  },
}));

import { practiceRouter } from '../practice';

const app = express();
app.use(express.json());
app.use('/api/practice', practiceRouter);

const row = {
  id: 'rec-1', studentId: 's-1', status: 'in_progress', maxScore: 20, startedAt: new Date('2026-10-14T01:00:00Z'),
  submittedAt: null, score: null, passed: null, details: null,
  questions: [
    { questionId: 'q1', title: '创建员工信息表', description: 'd1', type: 'comprehensive', difficulty: 'easy', score: 10, hints: null, sortOrder: 0, scenarioKey: '员工信息表' },
  ],
};

describe('GET /api/practice/records/:id', () => {
  beforeEach(() => findFirst.mockReset());

  it('本人的进行中记录：返回快照 + shareUrl', async () => {
    findFirst.mockResolvedValue(row);
    const res = await request(app).get('/api/practice/records/rec-1').set('x-test-user', 's-1');
    expect(res.status).toBe(200);
    expect(res.body.questions[0].questionId).toBe('q1');
    expect(res.body.shareUrl).toBe('https://share');
    // 查询必须带 studentId 条件（不是拿回来再比）
    expect(findFirst.mock.calls[0][0].where.studentId).toBe('s-1');
  });

  it('别人的记录 → 404（不泄露存在性）', async () => {
    findFirst.mockResolvedValue(null);
    const res = await request(app).get('/api/practice/records/rec-1').set('x-test-user', 's-2');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/routes/__tests__/practice-record-resume.test.ts`
Expected: FAIL —— 404（路由不存在）

- [ ] **Step 3: 实现接口**

`practice.ts` 加（放在 `/:recordId/submit` 之前，避免 `records` 被当成 recordId 匹配——两者路径不同，位置只需在其上方即可）：

```ts
/**
 * GET /api/practice/records/:id —— 断点续做。
 *
 * 题面快照此前只存在浏览器路由 state 里，刷新即丢；链式练习（十几步）没有恢复接口
 * 等于一次误刷新就全废。这里按 studentId 过滤，别人的记录直接 404（不泄露存在性）。
 */
practiceRouter.get('/records/:id', async (req: Request, res: Response) => {
  try {
    const record = await prisma.practiceRecord.findFirst({
      where: { id: req.params.id, studentId: req.user!.userId },
    });
    if (!record) return res.status(404).json({ message: '练习记录不存在' });

    const assignment = await prisma.practiceTableAssignment.findUnique({ where: { studentId: req.user!.userId } });

    res.json({
      recordId: record.id,
      status: record.status,
      questions: record.questions,
      maxScore: record.maxScore,
      startedAt: record.startedAt,
      shareUrl: assignment?.shareUrl ?? null,
      // 已判分的记录顺带把结果带回去，前端可直接进结果态
      ...(record.status === 'graded'
        ? { score: record.score, passed: record.passed, details: record.details }
        : {}),
    });
  } catch (err: any) {
    console.error('Practice record resume error:', err);
    res.status(500).json({ message: '服务器错误' });
  }
});
```

- [ ] **Step 4: 前端恢复 + 步骤记忆**

`PracticeDoing.tsx`：

1. 第 68 行的 `questions` 目前是**只读 state**（`const [questions] = useState<...>`），先补 setter：

```tsx
  const [questions, setQuestions] = useState<PracticeQuestion[]>(payload?.questions || []);
```

2. 把 132-145 行那条「刷新后题目无法恢复」的兜底 effect **整段替换**成恢复逻辑（它原本就是为此留的坑，注释里写着"questions 快照需后端补接口"——现在接口有了）：

```tsx
  // 无 state（刷新 / 换设备 / 从「继续」进来）：按 recordId 拉快照恢复。
  // 链式练习十几步，一次误刷新就全废是不可接受的。
  useEffect(() => {
    if (payload) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await practiceApi.getRecord(recordId);
        if (cancelled) return;
        if (res.data.status === 'graded') {
          setResult(res.data as unknown as GradingResult);
          return;
        }
        setQuestions(res.data.questions ?? []);
        setShareUrl(res.data.shareUrl ?? null);
        // 步骤记忆：同一台设备上回到上次作答的那一步（换设备则从头开始翻，不影响作答内容）
        const saved = Number(localStorage.getItem(`practice_step:${recordId}`) ?? '0');
        setCurrentStep(Number.isFinite(saved) && saved > 0 ? saved : 0);
      } catch {
        message.error('练习记录加载失败，请返回重新开始');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [payload, recordId]);
```

3. 切题时记忆（在 `setCurrentStep` 的所有调用点统一走一个函数）：

```tsx
  const gotoStep = (n: number) => {
    setCurrentStep(n);
    try { localStorage.setItem(`practice_step:${recordId}`, String(n)); } catch { /* 隐私模式忽略 */ }
  };
```

（把「上一题 / 下一题 / 答题卡」三处的 `setCurrentStep` 换成 `gotoStep`。）

4. `api.ts` 加：`getRecord: (recordId: string) => api.get(\`/practice/records/${recordId}\`),`

- [ ] **Step 5: 跑测试 + 手工验证 + 提交**

Run: `cd packages/server && npx vitest run src/routes/__tests__/practice-record-resume.test.ts`
Expected: PASS

手工：开一条场景练习 → 做到第 3 题 → **刷新页面** → 直接落到第 3 题且题目还在（旧行为是「刷新后题目无法恢复」）。

```bash
git commit -m "feat(practice): 断点续做（记录恢复接口 + 步骤记忆，刷新不再丢进度）" -- \
  packages/server/src/routes/practice.ts \
  packages/server/src/routes/__tests__/practice-record-resume.test.ts \
  packages/client/src/pages/student/PracticeDoing.tsx \
  packages/client/src/services/api.ts
```

---

## Task 15: 练习侧——结果页归因 + needsReview 区分

**Files:**
- Create: `packages/client/src/utils/practice-attribution.ts`
- Test: `packages/client/src/utils/__tests__/practice-attribution.test.ts`
- Modify: `packages/client/src/pages/student/PracticeDoing.tsx`（结果态渲染，171-292 行）

**Interfaces:**
- 判分明细元素（服务端 `practice-grading-service.ts:285-295` 确认）：`{ questionId, questionTitle, difficulty, type, score, maxScore, isCorrect, ruleResults: RuleResult[], analysis }`；`RuleResult.errorMessage` 里缺表是 `未找到表「X」`
- Produces: `buildChainAttribution(details): ChainFailure[]`、`hasNeedsReview(ruleResults): boolean`

- [ ] **Step 1: 写失败的测试**

创建 `packages/client/src/utils/__tests__/practice-attribution.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildChainAttribution } from '../practice-attribution';

const detail = (title: string, errorMessages: string[]) => ({
  questionTitle: title,
  isCorrect: false,
  ruleResults: errorMessages.map(m => ({ action: 'check_field', passed: false, needsReview: false, errorMessage: m })),
});

describe('buildChainAttribution', () => {
  it('多题因同一张表缺失失败 → 折叠成一条链级原因', () => {
    const out = buildChainAttribution([
      detail('创建时间字段', ['未找到表「员工信息表」']),
      detail('创建日期字段', ['未找到表「员工信息表」']),
      detail('设置筛选', ['未找到表「员工信息表」']),
    ]);
    expect(out).toEqual([
      { missingTable: '员工信息表', failedSteps: [1, 2, 3] },
    ]);
  });

  it('只有一题缺表 → 不折叠（单题原因已在题内展示）', () => {
    expect(buildChainAttribution([detail('创建时间字段', ['未找到表「员工信息表」'])])).toEqual([]);
  });

  it('不同表各缺一次 → 各自成立', () => {
    const out = buildChainAttribution([
      detail('A', ['未找到表「员工信息表」']),
      detail('B', ['未找到表「员工信息表」']),
      detail('C', ['未找到表「订单管理表」']),
    ]);
    expect(out).toEqual([{ missingTable: '员工信息表', failedSteps: [1, 2] }]);
  });

  it('无缺表信息 → 空数组（不编造原因）', () => {
    expect(buildChainAttribution([detail('A', ['字段「姓名」格式不符']), detail('B', [])])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/client && npx vitest run src/utils/__tests__/practice-attribution.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现 + 接进结果页**

创建 `packages/client/src/utils/practice-attribution.ts`：

```ts
/**
 * 链式练习的判分归因（纯函数）。
 *
 * 链里"上一步没做出来"会让后面几步集体失败 —— 学生看到 6 条红叉，但真正的原因只有一个。
 * 这里只做能站得住脚的归因：多题因**同一张表缺失**失败 → 折叠成一条；
 * 不猜"哪一步本该建它"（那需要链元数据，MVP 不引入）。
 * 缺表识别复用 rule-message.ts 的 extractMissingTable —— 正则只有那一处。
 */
import { extractMissingTable } from './rule-message';

export interface GradingDetailLike {
  questionTitle: string;
  isCorrect?: boolean;
  ruleResults?: Array<{ passed?: boolean; needsReview?: boolean; errorMessage?: string }>;
}

export interface ChainFailure {
  missingTable: string;
  /** 1-based 步骤号（与结果页的题号一致） */
  failedSteps: number[];
}

export function buildChainAttribution(details: GradingDetailLike[]): ChainFailure[] {
  const byTable = new Map<string, number[]>();
  details.forEach((d, idx) => {
    for (const r of d.ruleResults ?? []) {
      const table = extractMissingTable(r.errorMessage);
      if (!table) continue;
      if (!byTable.has(table)) byTable.set(table, []);
      const steps = byTable.get(table)!;
      if (!steps.includes(idx + 1)) steps.push(idx + 1);
    }
  });
  return [...byTable.entries()]
    .filter(([, steps]) => steps.length >= 2)
    .map(([missingTable, failedSteps]) => ({ missingTable, failedSteps: failedSteps.sort((a, b) => a - b) }))
    .sort((a, b) => a.failedSteps[0] - b.failedSteps[0]);
}

/** 该题是否有「待人工复核」的规则（现在与"做错"长得一样，要分开显示） */
export function hasNeedsReview(ruleResults?: Array<{ needsReview?: boolean }>): boolean {
  return (ruleResults ?? []).some(r => r.needsReview);
}
```

在 `PracticeDoing.tsx` 的结果态（`if (result)` 分支，171 行起）里：

1. 顶部 Result 横幅下方插入链级归因 Alert：

```tsx
{(() => {
  const chain = buildChainAttribution((result.details ?? []) as any[]);
  if (chain.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message="这些题是被同一个原因连累的"
      description={chain.map(c => (
        <div key={c.missingTable}>
          你的表格里没有「{c.missingTable}」这张表，第 {c.failedSteps.join('、')} 步都因此无法判定。先把它建出来，再重做这几步。
        </div>
      ))}
    />
  );
})()}
```

2. 逐题规则明细里，把 needsReview 从「做错」里分出来（现 258 行附近按 `r.passed` 渲染 Tag 的地方）：

```tsx
{hasNeedsReview([r]) ? (
  <Tag color="warning">待人工复核</Tag>
) : r.passed ? (
  <Tag color="success">正确</Tag>
) : (
  <Tag color="error">错误</Tag>
)}
```

- [ ] **Step 4: 跑测试 + 提交**

Run: `cd packages/client && npx vitest run src/utils/__tests__/practice-attribution.test.ts`
Expected: PASS（4 个用例全绿）

手工：故意不建表提交一次场景练习 → 结果页应出现「这些题是被同一个原因连累的」并列出表名与步号。

```bash
git commit -m "feat(practice): 结果页链级归因 + needsReview 与做错分开显示" -- \
  packages/client/src/utils/practice-attribution.ts \
  packages/client/src/utils/__tests__/practice-attribution.test.ts \
  packages/client/src/pages/student/PracticeDoing.tsx
```

---

## Task 16: 组卷候选池过滤掉「引擎判不了」的题

**Files:**
- Modify: `packages/server/src/services/paper-generator.ts`（`pickQuestionForSlot` 的候选过滤 + `previewSlotCandidates` 的候选统计）
- Test: `packages/server/src/services/__tests__/paper-generator.test.ts`（追加用例）

**Interfaces:**
- Consumes: `unsupportedRuleActions`（Task 11 已从 `rule-engine.ts` 导出）
- Produces: 抽题与预览都跳过「规则含未实现 action」的题——这类题进卷子必然转人工，等于把考试开废；宁可题位未填（现有 `unfilledSlots` 机制会报给教师）

- [ ] **Step 1: 追加失败用例**

在 `packages/server/src/services/__tests__/paper-generator.test.ts` 的 `describe('抽题题位')` 里追加：

```ts
  it('候选只有引擎判不了的题 → 跳过，题位未填（不排人工卷）', async () => {
    mockPrisma.examQuestion.findMany.mockResolvedValue([ruleSlot]);
    mockPrisma.question.findMany.mockResolvedValue([
      { ...candidate('q-bad'), answerRules: [{ action: 'verify_dashboard_chart', params: {} }] },
    ]);

    const result = await generateStudentPaper('exam-1', 'stu-1');

    expect(result.created).toBe(0);
    expect(result.unfilledSlots).toHaveLength(1);
  });
```

（现有用例的 `candidate()` 不带 `answerRules` 字段——过滤器对「没有规则信息」的题目**放行**，所以老用例行为不变。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generator.test.ts`
Expected: 新用例 FAIL —— `result.created` 为 1（坏题被抽中了）

- [ ] **Step 3: 实现过滤**

`paper-generator.ts` 顶部补 `import { unsupportedRuleActions } from '../engine/rule-engine';`（该文件已有 `schemaRefsSignature` 等本地工具；import 放引擎相关的 import 一起）。

`pickQuestionForSlot` 里两处改动：

```ts
      select: { id: true, score: true, schemaRefs: true, capabilityIds: true, difficulty: true, answerRules: true },
```

```ts
    const pool = candidates.filter(c => {
      // 分值必须一致：等值替换的前提是每人这道题占的分一样
      if ((c.score ?? 0) !== slotScore) return false;
      if (usedQuestionIds.has(c.id)) return false;
      // 规则里有引擎不认识的 action = 判分必然转人工，不能进考试抽题池
      if (unsupportedRuleActions(c.answerRules).length > 0) return false;
      // 只有第一级强制 schemaRefs 一致（严格路径）
      if (attempt.label === 'strict' && wanted) {
        return schemaRefsSignature(c.schemaRefs) === wanted;
      }
      return true;
    });
```

`previewSlotCandidates` 里同样两处（select 加 `answerRules: true`，并在取到 rows 后过滤），**注意后面所有统计都要基于过滤后的数组**：

```ts
  // 规则引擎判不了的题不算候选：预览的候选数必须与真实能抽到的数一致，
  // 否则教师看到"有 3 道候选"、开考却一道都抽不出来
  const rows = gradeable;
```
（即：`const rows = await prisma.question.findMany({...});` 之后紧接 `const gradeable = rows.filter(r => unsupportedRuleActions(r.answerRules).length === 0);`，再把后续 `scoped/byScore/homogeneous/signatures/difficultyCounts` 里引用的 `rows` 全部换成 `gradeable`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/server && npx vitest run src/services/__tests__/paper-generator.test.ts`
Expected: PASS（含新增用例，老用例全绿）

- [ ] **Step 5: 提交**

```bash
git commit -m "fix(papers): 组卷候选池跳过引擎判不了的题（宁可题位未填，不排人工卷）" -- \
  packages/server/src/services/paper-generator.ts \
  packages/server/src/services/__tests__/paper-generator.test.ts
```

---

## Task 17: 收尾——全量门禁 + 端到端验收

**Files:**
- Create: `e2e/question-refs-practice.spec.ts`（Playwright，若现有 e2e 目录结构不同则跟随现状）

**Interfaces:**
- Consumes: 前面全部任务

- [ ] **Step 1: 全量门禁**

Run: `npm run lint && npm run typecheck && npm test`
Expected: lint 0 error（warning 不阻断）；两端 tsc 通过；两端 vitest 全绿

- [ ] **Step 2: 端到端脚本**

创建 `e2e/question-refs-practice.spec.ts`（按 `e2e/` 现有用例的登录与取数方式书写；若已有 helper 复用）：

```ts
/**
 * 端到端：教师看到的场景链 → 学生开练 → 提交 → 看到归因。
 * 依赖：库里已跑过 backfill-question-refs.ts；有可用的学生练习表格（resetFile 会清空它）。
 */
import { test, expect } from '@playwright/test';

test('场景实战：开练 → 提交 → 链级归因', async ({ page }) => {
  // 1) 学生登录 → 练习页 → 场景卡片存在
  await page.goto('/student/practice');
  await expect(page.getByText('场景实战', { exact: false })).toBeVisible();
  const card = page.locator('.ant-card', { hasText: '员工信息表' }).first();
  await expect(card).toBeVisible();

  // 2) 开练（什么都不做直接提交，制造"缺表"）
  await card.click();
  await page.getByRole('button', { name: /开始|继续/ }).click();
  await page.getByRole('button', { name: /提交练习/ }).click();
  await page.getByRole('button', { name: /确认|提交/ }).last().click();

  // 3) 归因提示出现
  await expect(page.getByText('这些题是被同一个原因连累的')).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 3: 跑端到端**

Run: `npm run e2e -- e2e/question-refs-practice.spec.ts`
Expected: PASS（需前后端已在跑；`npm run dev`）

- [ ] **Step 4: 更新设计文档的验收记录 + 提交**

在设计文档末尾加一节「## 十三、实施验收记录（2026-10-14）」：写实测场景数、总用例数、端到端结果。

```bash
git commit -m "test(e2e): 场景实战端到端 + 验收记录" -- \
  e2e/question-refs-practice.spec.ts \
  docs/superpowers/specs/2026-10-14-question-prerequisites-and-scenario-chains-design.md
```

---

## 附一：任务依赖图

```
Task 1 推导器 ──┬─→ Task 3 回填构建器 ─→ Task 6 回填脚本（需要 Task 4 的列）
                │                              │
Task 2 归链 ────┘                              ↓
                                          （数据就位，下面才看得到效果）
Task 4 迁移（Question 两列）────────────────┬─→ Task 11 题库场景列/未支持标记 ─→ Task 16 候选池过滤
                                            └─→ Task 12 → Task 13 → Task 14 练习侧
Task 5 derive-refs 接口 ─→ Task 10 编辑器卡片
Task 7 提示文案 ─→ Task 8 考试侧提示条 + 缺表话术（Task 10 的预览复用 Task 7）
Task 9 组卷 schemaRefs（独立）
Task 15 归因（需要 Task 13 的快照字段）
Task 17 收尾（全部）
```

## 附二：计划与设计文档的差异（写计划时发现的，以计划为准）

1. **fixed 题位的「schemaRefs 继承」在实现层面不成立**：fixed 题位不写 `rule`，没有可承载声明的字段；而它绑定的是某一道具体的题，结构天然一致，本就不需要声明。真正要修的是 **rule 题位**——教师能声明 + 服务端原样落库（Task 9）。设计文档第七节第 2 条的第一句需要按此更正。
2. **「答题卡前置未完成灰点」降级到二期**：练习没有「每步完成状态」这个数据（作答全在 WPS 表格里，提交时才判分），判断"前置未完成"本质上就是逐步检查——与它一起放二期，不单独做半成品。
3. **归因措辞不猜"哪一步本该建它"**：设计文档写的是「第 3 步没建『员工信息表』，导致第 4–6 步连带失败」，实现为「你的表格里没有「X」这张表，第 4、5、6 步都因此无法判定」。要点名"第 3 步"需要链元数据参与判分展示，MVP 不做（错点名比不点名更糟）。
4. **题库的「状态标签」实现为计算字段**：不新增数据库状态列，列表接口现算 `unsupportedActions`——规则实现变化时标记自动跟着变，不会留下过期状态。
5. **补充了设计文档第七节第 5 条第 2 项目标（组卷时过滤）**：Task 16 是写计划时补进来的，设计文档里只写了"组卷时过滤"一句，计划把它落成了具体任务。
6. **回填脚本对「待人工确认」题的处理**：仍写入从规则推导出的 `schemaRefs` 契约，但**不写 scenario/scenarioOrder**（等教师指定）——设计文档没写这么细，计划里明确。
