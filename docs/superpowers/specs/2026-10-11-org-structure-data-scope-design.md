# 组织架构与教师数据范围设计（校级 + 院系两级管理）

- 日期：2026-10-11
- 状态：**设计待评审**（未开始实施）
- 前置决策（用户已确认）：
  1. 管理模式：**校级 + 院系两级**——教务处管全局，各院系有管理员管本院系；
  2. 题库/试卷：**按院系共享**，跨院系不可见，院系管理员可上架到校级共享池；
  3. 跨院系教学（公共课）**很常见**——教学关系必须独立于院系；
  4. 技术路线：**统一数据范围层（方案 A）**，按"先止血、再补地基"的顺序落地。

---

## 1. 背景与问题

### 1.1 现状走查结论（2026-10-11 全量代码走查）

系统当前只有一条真正的教师数据边界——`TeacherClass`（教师↔班级），且**只作用于学生名册类接口**。其余领域对任何教师全局可读（写操作才做创建者隔离）：

| 数据 | 位置 | 问题 |
|---|---|---|
| 任意考试的答卷 + 考生姓名/学号 + 成绩 | [exams.ts:764-871](../../../packages/server/src/routes/exams.ts) `GET /:id/submissions`、`/:id/students`、`/:id/room-assignments` | 无归属校验 |
| 题库全部题目（含 `answerRules` 标准答案、他人草稿） | [questions.ts:44-163](../../../packages/server/src/routes/questions.ts) | 读全局 |
| 全部试卷及题目、可复制他人试卷 | [papers.ts:26-92](../../../packages/server/src/routes/papers.ts)、`:217` | 读全局 |
| 全部考试列表/详情（含他人未发布草稿） | [exams.ts:34-119](../../../packages/server/src/routes/exams.ts) | 无过滤 |
| 行为日志/分析报告 | [behaviors.ts:153-325](../../../packages/server/src/routes/behaviors.ts) | 仅角色校验 |
| 导出中心（学生/成绩/行为/审计日志全库导出） | [export.ts:97-365](../../../packages/server/src/routes/export.ts) | 最大缺口 |
| 考场增删改 | [rooms.ts:267-330](../../../packages/server/src/routes/rooms.ts) | 无归属校验 |
| WPS 表格分配读/覆盖/删 | [exam-table-assignments.ts:32-127](../../../packages/server/src/routes/exam-table-assignments.ts) | 无校验 |
| 通知：向任意班级群发、改全局模板 | [notifications.ts:327-373](../../../packages/server/src/routes/notifications.ts) | 无范围限制 |
| 全系统用户列表、审计日志 | [users.ts:27-115](../../../packages/server/src/routes/users.ts)、[audit.ts](../../../packages/server/src/routes/audit.ts)（该路由目前**完全无鉴权**） | 泄漏 |
| 邀请：为任意班级建邀请、看全部申请 | [invitations.ts:169-220](../../../packages/server/src/routes/invitations.ts)、`:324-365` | 无班级归属校验 |

其他结构性事实：

- 院系架构（`Department → Major → ClassRoom`）目前只是学生档案字段与筛选器，**不参与任何权限判定**；
- **教师账号无法设置院系**（[accounts.ts:141-254](../../../packages/server/src/routes/accounts.ts) 创建/编辑/批量导入均无组织字段）；
- 教师与班级的唯一关联维护入口是管理员端的 TeacherClassAssignment / AccountManagement 页面；
- 未分班学生（`classRoomId = null`）对所有教师放行，是 [exam-ownership.ts:59-82](../../../packages/server/src/middleware/exam-ownership.ts) 里刻意的宽松。

### 1.2 问题的本质

系统里同时存在两条互不衔接的归属轴：

- **创建者轴**：考试/批次 → `createdBy`（决定写权限）
- **组织轴**：学生 → 班级 ← TeacherClass → 教师（决定学生名册可见性）

两条轴各自为政，导致两个方向都别扭：
- 教师 A 创建了考试，即使考生全是外班学生，A 也看得到他们的答卷；
- 我班学生参加了别的老师创建的考试，我这个任课老师反而看不到自己学生的答卷。

### 1.3 同类系统调研结论（2026-10-11）

调研对象：高校教务招标技术规格、超星/泛雅、考试星、北师大安全教育考试系统、Ans（国际考试平台）、融智云创、题库系统的权限设计等。通行做法：

1. **行政班 vs 教学班分开**：院系→专业→行政班是"学生归属、统计、批量管理"维度；教学班（课程+教师+名单）才是"考试、成绩、阅卷"维度。行政班可拆分/合并成教学班。
2. **角色分级 + 数据范围**：校级管理员 → 院系管理员 → 教师 → 助教；权限 = 功能权限 + **数据范围**（本人/班级/院系/全校）。北师大是"课题组 < 院级管理员 < 校级管理员"；Ans 是学校级/院系级/课程级三段。
3. **教师-班级多对多**，未分配班级的教师登录后提示"联系管理员"，而非放行。
4. **阅卷按"阅卷人范围"分配**：授课老师批改自己班的学生；支持主考教师统筹 + 协助教师流水阅卷、任务转移（考试星、齐鲁师范学院等的做法）。
5. **题库分级共享**：个人 / 院系 / 校级池，可"上架"升级（北师大"课题组→学院题库→校级"）。

来源见附录 A。

### 1.4 目标与非目标

**目标**
- 教师数据可见范围统一收敛为「组织 + 教学关系」轴，创建者轴只决定管理权；
- 落地校级/院系两级管理：院系管理员角色 + 数据范围；
- 堵住 1.1 表中所有越权读/写缺口，且以后新接口有统一模板可循。

**非目标（YAGNI）**
- 不做可配置的"数据范围引擎"（角色固定三种，配置化换不回成本）；
- 不做"主讲/助教"细分（真需要时再加）；
- 不做多租户/跨校；
- 不改动考试与判分业务本身（[CLAUDE.md](../../../CLAUDE.md) 中的判分链路不受影响）。

---

## 2. 角色与归属模型（地基）

### 2.1 三个角色

| 角色 | 数据范围 | 定位 |
|---|---|---|
| 校级管理员（现有 `admin`） | 全校 | 院系结构、校级共享池、全局统计与运维、审计 |
| **院系管理员（新增 `department_admin`）** | 本院系 | 本院系教师账号、班级与学生、本院系题库/试卷/考试/成绩 |
| 教师（现有 `teacher`） | 我任教的班级 | 出题、组卷、考试、阅卷（范围 = 教学关系） |
| 学生（现有 `student`） | 仅本人 | 不变 |

**表达方式**：`UserRole` 枚举新增 `department_admin`，不用"admin + 有院系"的隐式写法。

理由：现有 `authorize('admin')` 的路由不会自动对新角色放行——每个口子必须**显式开、默认拒**，避免重演"某处忘了过滤"。代价是升级时要过一张明确的放行清单，而这正是想要的审计点。

**顺带修复**：`authenticate` 中间件本就实时查库（取 `accountStatus`），扩展 select 带上 `role`、`departmentId` 并覆盖 JWT 中的值——**角色/院系变更即时生效，无需重新登录**，同时为数据范围层提供权威的 `departmentId`。

### 2.2 两条轴彻底分开

- **组织轴**（院系 → 专业 → 班级）：回答「资产归谁管、学生归谁管」；
- **教学关系轴**（`TeacherClass` 任课关系）：回答「教师能看到谁的数据」。

跨院系公共课在前者下天然成立：计算机学院的老师教着经管学院的班——他的"家"在计算机学院（题库、日常管理），可见性跟着任教班级走。教学关系表已有 `@@index([teacherId])`，无需结构调整。

### 2.3 归属字段补齐

| 字段 | 现状 | 动作 |
|---|---|---|
| `User.departmentId` | 字段已有，仅学生侧写入 | 补写入路径：账号创建/编辑/批量导入、院系管理员维护 |
| `Exam.departmentId` | **不存在** | 新增（可空 + 索引）。默认取创建者院系；教师调岗/离职后考试不孤儿，由院系接管 |
| `Paper.departmentId` | **不存在** | 同上 |
| `Question.departmentId` | **不存在** | 同上 |
| `Question.sharedToSchool` / `Paper.sharedToSchool` | **不存在** | 新增布尔，默认 `false`；上架后进入校级共享池 |

**语义约定**：`departmentId` 为空 = **校级资源**。存量数据天然兼容（无需强制回填），创建者没有院系的资产保持现状可见范围。

---

## 3. 数据范围矩阵

> 下表是设计的核心规则表；服务端所有过滤器、断言与前端筛选器都以它为准。
> 「我创建/监考」= `Exam.createdBy = 我` 或我在 `ExamRoomAssignment.invigilators` 中；「我任教班级」= `TeacherClass(我) `对应的班。

### 3.1 资源 × 角色 可见范围

| 资源 | 校级管理员 | 院系管理员 | 教师 |
|---|---|---|---|
| 学生名册/档案 | 全校 | 本院系学生 | 我任教班级的学生；**未分班学生不可见**（收紧原"全放行"） |
| 学生账号管理（建/禁/重置/导入） | 全校 | 本院系师生（不可创建管理员） | 无 |
| 院系/专业/班级结构 | 全校 CRUD | 本院系读 + 本院系学生分班操作（结构 CRUD 仍校级） | 只读（筛选器用，树按角色裁剪） |
| 考试（读列表/详情） | 全校 | 本院系归属的考试 | 我创建/监考的考试（完整）；我任教班级学生参加的**他人考试**仅开放"成绩视图"，不含考试详情/题目内容（见开放问题 A） |
| 考试（管理：改题/发布/结束/删除/归档） | 全校 | 本院系归属的考试 | 我创建/监考的考试 |
| 答卷与成绩（读） | 全校 | 本院系考试 + 本院系学生 | 我创建/监考的考试（该场全部考生）；我任教班级学生（含其参加的他场考试，只读） |
| 判分/复核/改分（写） | 全校 | 本院系考试 | 我创建/监考的考试 |
| 复核留痕/批改存档 | 全校 | 本院系考试 | 我创建/监考的考试 |
| 题库/试卷（读） | 全部 + 校级池 | 本院系池 + 校级池 | 本院系池 + 校级池（可复制到本院系下） |
| 题库/试卷（改/删） | 全部 | 本院系池 | 仅自己创建的 |
| 校级池上下架 | 上/下架任意 | 上架本院系资产 | 无 |
| 行为日志/分析报告 | 全校 | 本院系学生 + 本院系考试 | 我创建/监考考试的数据 + 我任教班级学生 |
| 导出中心 | 全校（审计日志仅校级可导出） | 本院系范围 | 我任教班级 + 我创建考试的范围；审计日志不可导出 |
| 考场（ExamRoom） | 全部维护 | 只读 | 只读（在自己的考试分配中使用）（见开放问题 B） |
| 通知（发送） | 全校任意收件人 | 本院系师生 | 我任教班级学生 + 自己可见范围内的人 |
| 通知模板 | 维护（增删改） | 使用 | 使用 |
| 监考安排/考场分配 | 全校 | 本院系考试 | 我创建/监考的考试 |
| WPS 表格分配 | 全校 | 本院系考试 | 我创建/监考的考试 |
| 用户列表 / 审计日志 | 全校 / 全校 | 本院系用户列表；审计日志不可见 | **不可见**（修掉现有缺口） |
| 系统配置（WPS/LLM/角色/系统管理） | 全部 | 无 | 无 |

### 3.2 特殊规则

1. **校级共享池**：`sharedToSchool = true` 的题目/试卷全校教师可读、可复制；写权限仍归创建者 + 其院系管理员 + 校级管理员；下架由校级管理员执行。
2. **未分班学生**：教师名册里不再出现，仅管理员可见、可分配——学生 `departmentId` 已设置的，由该院系管理员管；`departmentId` 也为空的，由校级管理员管。**但不影响考试数据**——学生参加了我创建的考试，我照样能看他的答卷（两轴分离后的自然结果，原宽松策略的动机消失）。
3. **跨院系教学**：教师对任教班级学生的可见性不因其院系不同而打折；题库归属始终跟"家"（教师院系）走，与任教班级无关。
4. **抽题组卷联动**：按知识点组卷（`paper-generator.ts` / `answer-reverser` 链路）的抽题范围必须走同一 `questionWhere(ctx)`——题库按院系收敛后，抽题不得越界。
5. **教师离职/调岗**：考试等资产归属院系不跟人走；离职后由院系管理员接管（这是 `Exam.departmentId` 的核心价值）；调岗后新范围即时生效（2.1 的 authenticate 改造）。

---

## 4. 技术落点

### 4.1 数据范围模块 `services/data-scope.ts`

把矩阵固化为**唯一的规则出口**，两种形态：

```ts
export type ScopeCtx = { userId: string; role: UserRole; departmentId: string | null };
export function scopeCtxOf(req: Request): ScopeCtx;      // 从 req.user 构造

// 形态一：列表/统计/导出 —— 产出 Prisma where 片段，与业务筛选 AND 合并
studentWhere(ctx, filters?): Prisma.UserWhereInput
examWhere(ctx, filters?): Prisma.ExamWhereInput
questionWhere(ctx): Prisma.QuestionWhereInput        // 院系池 + 校级池（+ 自己创建的）
paperWhere(ctx): Prisma.PaperWhereInput
behaviorWhere(ctx), submissionWhere(ctx), exportScope(ctx, entityType)

// 形态二：单资源读写校验 —— 吸收现有 exam-ownership.ts
assertStudentAccess(ctx, studentId, mode: 'read' | 'write'): AccessVerdict
assertExamAccess(ctx, examId, mode): AccessVerdict
assertQuestionAccess(ctx, questionId, mode): AccessVerdict
assertRoomAccess / assertBatchAccess / assertSubmissionAccess / …
```

- `exam-ownership.ts` 现有函数迁移进本模块（保持 `ok | forbidden | not-found` 三态与 `denyAccess` 文案兼容），调用点全量替换；
- 模块**不依赖 HTTP**，输入 `ScopeCtx` 输出 where/判定，可用纯单测覆盖矩阵；
- 「我任教班级」查询集中在模块内部，并做**请求级缓存**（同一请求内多处调用只查一次 `teacherClass`）。

### 4.2 路由改造模式

- **读路径**：`where: { ...businessFilter, ...studentWhere(ctx) }`——不写裸查询；
- **写路径**：`assertXxx(ctx, id, 'write')` 先校验再执行；
- 对每个路由建立"路由 × 规则"改造清单（以 1.1 表为底账），逐条勾销；
- `authorize('teacher','admin')` 类调用按矩阵补 `'department_admin'`（显式放行清单）。

### 4.3 数据迁移与回填

1. Prisma migration：`UserRole` 加 `department_admin`；`Exam/Paper/Question` 加 `departmentId`（可空+索引）与 `sharedToSchool`（默认 false）；
2. 回填脚本：`Exam/Paper/Question.departmentId ← 创建者.departmentId`；创建者无院系则留 `NULL`（= 校级，保持现状可见性，不制造回归）；
3. 院系管理员任命：校级管理员在账号管理里设 `role + departmentId`；院系管理员再维护本院系教师/学生的院系归属；
4. 兼容性：回填前后语义一致（NULL=校级），可灰度上线。

### 4.4 前端

- `App.tsx` 角色布局：`department_admin` **复用 admin 布局 + 菜单按角色收窄**（`moduleNavigation.tsx` 已有按角色显隐机制），不做第三套布局；
- 院系管理员工作台 = 现有 admin 页面在"本院系"范围下的复用（教师管理、班级学生、题库、考试、统计）；
- 教师端/院系端筛选器（院系树、班级下拉）由 `/departments` 树接口按角色裁剪后下发；
- 403 文案按场景细分（如"该学生不在你任教的班级"），替代统一文案。

### 4.5 测试策略

- 新建 `data-scope.test.ts`：**矩阵驱动**——角色（4）× 资源（10+）× 场景（读/写/跨院系/未分班/校级池）的表驱动单测；
- 每个改造的路由补至少一条越权用例（403/404）与一条正常用例，风格参考 `routes/__tests__/exam-security.test.ts`（`vi.mock` 掉 `middleware/auth` 与 `config/prisma`）；
- 回归门槛：现有服务端测试全绿 + 新增矩阵测试全绿。

### 4.6 分期实施（先止血，再补地基，最后两级角色）

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **P1 止血** | 建 `data-scope.ts` 骨架（教师按 TeacherClass + 创建者/监考，不依赖新字段）；按 1.1 表逐条收口：导出中心、答卷/考生查询、题库/试卷读、考场写、行为日志、WPS 表格分配、audit.ts 补鉴权、通知群发、用户/审计列表、邀请 | 1.1 表全部勾销；越权用例全绿 |
| **P2 地基** | 字段迁移 + 回填；`authenticate` 读 role/departmentId；accounts 组织字段写入路径 | 教师可设院系；存量数据归属正确 |
| **P3 两级角色** | `department_admin` 枚举 + 路由放行清单 + 前端布局菜单 + 院系管理员工作台 | 院系管理员可独立完成本院系日常管理 |
| **P4 收尾** | 统计口径（totalTeachers 等全局数按角色收窄）、通知模板权限、校级池治理界面、文档与培训 | 矩阵全量对齐 |

---

## 5. 开放问题（实施前需确认）

| # | 问题 | 建议默认 |
|---|---|---|
| A | 教师能否看到**我任教班级学生**在**他人创建的考试**中的成绩（只读）？ | **默认开启**（成绩反馈是教学刚需）；如担心统考成绩敏感可关闭，仅保留"我创建/监考的考试"读权 |
| B | 考场（ExamRoom）是否加院系归属？ | 默认**不加**（机房是全校公共资源，校级维护、院系/教师只读），未来有院系自管机房再加 |
| C | 院系管理员能否删除本院系考试/题目？ | 可以，但保留"有答卷不可删""已发布不可删"等业务保护 |
| D | 校级池下架权限 | 仅校级管理员；院系管理员只能上架本院系资产、下架本院系上架的 |

---

## 6. 与既有工作的衔接

- **按知识点组卷/客观题**（`paper-generator.ts`、`objective-grader.ts`，见 2026-10-11 另一份设计）：抽题范围必须走 `questionWhere(ctx)`；每生卷快照（`StudentExamQuestion`）不受影响；
- **批改存档**（`GradeReviewLog` 等，commit a75763b）：可见范围跟随考试范围（矩阵第 3.1 节"复核留痕"行）；
- **WPS 集成**：`createAdapterFromSpaceId` 的 token 取用顺序不受影响；表格分配归属按矩阵收口。

---

## 附录 A：调研来源

- 高校教务招标技术规格（院系/教学班/排考/阅卷权限）：[山东大学采购要求](http://www.cgw.sdu.edu.cn/zb/cms/contentwh/download.htm?attachmentid=b45bf99c8dbb43208d35a859ce6265c7)、[河北政采（数据范围权限）](http://www.ccgp-hebei.gov.cn/BidWinAnncFiles/3096bd50-8a59-6161-7dbb-48da9cc8517c.pdf)、[内蒙古政采（行政班拆分/教学班）](https://www.ccgp-neimenggu.gov.cn/gpx-bid-file/150601/gpx-tender/2022/12/1/402881dd849ff0d20184ccc4b3cc6e50.pdf)、[长沙师范学院编班管理办法（行政班定义）](http://jwc.cssf.cn/gzzd/jwyhyzhgl/content_22282)
- 超星/泛雅：[沈阳师范大学管理员操作手册（院系管理员权限）](https://jwc.synu.edu.cn/_upload/article/files/53/cc/927a2ae34e1b83ec539f61070274/9f28fe7b-7849-42f7-8808-291dbf00eeae.pdf)、[江苏大学教师使用指南](https://jwc.ujs.edu.cn/system/_content/download.jsp?urltype=news.DownloadAttachUrl&owner=1347513739&wbfileid=8FDEB08F5B8A440CA9F2E45BC0CD4DAA)
- 阅卷范围与协同：[考试星·流水阅卷（阅卷人范围/分配学员）](https://www.kaoshixing.com/help-document/d113)、[齐鲁师范学院主考/协助教师规定](https://jwc.qfnu.edu.cn/info/1070/5456.htm)
- 分级数据范围与题库：[北师大安全教育考试系统（课题组<院级<校级）](https://ssc.bnu.edu.cn/docs/2022-09/20220909174245223392.docx)、[融智云创考务系统（院校/学部/学院/系级数据权限）](https://www.cctrcloud.com/kwxxglxt)、[题库系统权限与角色（学科范围隔离）](https://gygy-open.github.io/question-bank/admin/permissions)、[Ans roles and permissions（学校/院系/课程三级）](https://support.ans.app/hc/en-us/articles/360015947097-Roles-and-permissions-in-Ans)
- 教师仅见自己班级的商用实现：[羽薇教育系统员工权限](https://m.yw-jz.com/h-nd-3838.html)、[四川电大形成性考核系统 FAQ（评阅班级分配）](http://xk.scrtvu.net/fes3/Help/FAQ.htm)

## 附录 B：本设计涉及的关键代码位置

- 归属校验现状：[middleware/exam-ownership.ts](../../../packages/server/src/middleware/exam-ownership.ts)、[routes/students.ts:163-181](../../../packages/server/src/routes/students.ts)
- 鉴权：[middleware/auth.ts](../../../packages/server/src/middleware/auth.ts)（`authorize` 按 JWT role、`authorizePermission` 按模块权限）
- 组织模型：[prisma/schema.prisma](../../../packages/server/prisma/schema.prisma)（User:125、Department:627、Major:641、ClassRoom:658、TeacherClass:1130）
- 账号管理：[routes/accounts.ts](../../../packages/server/src/routes/accounts.ts)、[admin/TeacherClassAssignment.tsx](../../../packages/client/src/pages/admin/TeacherClassAssignment.tsx)
