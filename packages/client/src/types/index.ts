import type { StudentRequires } from '../utils/question-refs-hint';

export interface User {
  id: string;
  username: string;
  realName: string | null;
  role: 'admin' | 'teacher' | 'student';
  email: string | null;
  avatarUrl: string | null;
  systemRoleId?: string | null;
  systemRole?: { roleCode: string; roleName: string } | null;
  permissions?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  permissions?: string[];
}

export interface WpsTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // access_token 过期时间戳（毫秒）
  refreshExpiresAt?: number; // refresh_token 过期时间戳（毫秒）
}

export interface QuestionCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  level: number;
  createdAt: string;
  children?: QuestionCategory[];
  statistics?: { totalQuestions: number; publishedQuestions?: number };
  _childrenCount?: number;
}

export type QuestionType = 'create_table' | 'add_field' | 'config_view' | 'create_form' | 'comprehensive' | 'single_choice' | 'multiple_choice' | 'true_false';
/** 客观题题型（单选/多选/判断）：配 objectiveAnswer，不走判分规则编辑器 */
export type ObjectiveQuestionType = 'single_choice' | 'multiple_choice' | 'true_false';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'draft' | 'published' | 'archived';

export interface AnswerRule {
  id: string;
  action: string;
  params: Record<string, any>;
  score: number;
}

// ========== 客观题与抽题组卷类型 ==========

/** 客观题选项（key 自动分配 A/B/C…，与服务端一致最多 26 个） */
export interface ObjectiveOption {
  key: string;
  text: string;
}

/** 客观题答案（POST/PUT /api/questions 的 objectiveAnswer 字段；实操题为 null） */
export interface ObjectiveAnswer {
  options: ObjectiveOption[];
  /** 正确选项 key：单选/判断恰好 1 个，多选 ≥1 */
  correct: string[];
}

/** 前置契约里的一条字段引用：字段必有宿主表（学生提示条按表分组渲染，不允许挂在空表名下） */
export interface SchemaFieldRef { table: string; field: string }
/** 前置契约里的一条视图引用：视图必有宿主表 */
export interface SchemaViewRef { table: string; view: string }

/** 一组结构引用：requires = 作答前必须已存在；creates = 本题会产出 */
export interface SchemaRefGroup {
  tables?: string[];
  fields?: SchemaFieldRef[];
  views?: SchemaViewRef[];
}

/**
 * 实操题的「前置契约」/ 引用声明（推导产物与教师手改都落在这里）。
 *
 * - requires/creates：服务端推导器（engine/prerequisite-deriver）的输出。
 *   学生提示条只读 requires（考试侧由 toStudentQuestion 单独下发，见 utils/question-refs-hint）；
 *   creates 不下发学生，供场景归链与推断用。
 * - tables/fields：顶层字符串数组，抽题等值签名（paper-generator.schemaRefsSignature）只认这两个，
 *   形状必须保持 string[] —— 改成对象数组会让签名里全是 "[object Object]"，等值校验静默失效。
 * 全部可选：库里客观题的 schema_refs 是 NULL，旧题可能只有顶层 tables/fields；缺新字段不能炸。
 */
export interface SchemaRefs {
  requires?: SchemaRefGroup;
  creates?: SchemaRefGroup;
  tables?: string[];
  fields?: string[];
}

/** 试卷题位类型：fixed = 固定题；rule = 按知识点抽题 */
export type SlotType = 'fixed' | 'rule';

/** 抽题题位条件（PUT /api/papers/:id/questions 的 rule 字段，与 server slotRuleSchema 对齐） */
export interface SlotRule {
  /** 知识点（能力点 id）：候选池 = 同时命中这些知识点的已发布题目 */
  capabilityIds?: string[];
  difficulty?: Difficulty;
  type?: QuestionType;
  schemaRefs?: SchemaRefs;
}

/** POST /api/papers/slot-preview 响应：抽题题位候选池预览 */
export interface SlotPreviewResult {
  /** 真正可用于抽题的候选数（同题位候选要求分值一致、引用声明一致） */
  candidateCount: number;
  /** 因分值不匹配被排除的数量（教师常见配置错误） */
  excludedByScore: number;
  /** 候选池内引用声明不一致：混抽会导致部分学生做不了题 */
  schemaRefsConflict: boolean;
  /** 各难度可用题数（分值一致口径，不带难度过滤）：组卷规则行数量框显示 /N */
  difficultyCounts: Record<string, number>;
  /** 最多 20 条候选题 */
  candidates: Array<{ id: string; title: string; type: string; difficulty: string; score: number }>;
  /** 0 道候选 = 开考抽不出题；1 道 = 全员同题 */
  warning: string | null;
}

export interface Question {
  id: string;

  // ✅ 新增字段：两级分类体系
  primaryCategoryId: string | null;
  secondaryCategoryId: string | null;

  // ✅ 新增字段：元数据信息
  teacherName: string | null;
  updatedBy: string | null;

  // 保留现有字段
  title: string;
  description: string | null;
  type: QuestionType;
  difficulty: Difficulty;
  score: number;
  answerRules: AnswerRule[];
  /** 知识点打标（能力点 id）：抽题组卷按它做同知识点等值替换，不打标无法被抽中 */
  capabilityIds?: string[];
  /** 客观题答案（仅客观题有值，实操题为 null） */
  objectiveAnswer?: ObjectiveAnswer | null;
  /** 实操题引用的表/字段声明（抽题等值校验依据，选填） */
  schemaRefs?: SchemaRefs | null;
  /** 场景链：同一场景的题按 scenarioOrder 在练习「场景实战」里成链出给学生；null = 不属于任何场景 */
  scenario?: string | null;
  scenarioOrder?: number | null;
  hints: string | null;
  /** 解析（官方题库导入的题目自带；教师出题时可选填） */
  analysis?: string | null;
  tags: string[];
  status: QuestionStatus;
  /** 来源：official = 官方题库（平台统一维护，教师不可编辑）；school = 校本（教师自建，默认） */
  source?: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;

  // ✅ 更新关联关系：两级分类
  primaryCategory?: { id: string; name: string } | null;
  secondaryCategory?: { id: string; name: string } | null;

  // ❌ 删除原有关联
  // category?: { id: string; name: string } | null;

  // 保留现有关联
  creator?: { id: string; realName: string } | null;
}

// ========== 客观题学生端类型（教师端出题类型见上方「客观题与抽题组卷类型」） ==========

/** 客观题作答值：单选/判断为选项 key 字符串，多选为 key 数组；null 表示未作答/取消作答 */
export type ObjectiveAnswerValue = string | string[] | null;

/** 学生端下发的题目（GET /api/my-exams/:id）：服务端已剥离 answerRules 等判分敏感字段 */
export interface StudentExamQuestion {
  id: string;
  title: string;
  description: string | null;
  type: QuestionType;
  difficulty: Difficulty;
  score: number;
  hints: string | null;
  tags: string[];
  primaryCategoryId: string | null;
  secondaryCategoryId: string | null;
  options?: ObjectiveOption[]; // 仅客观题下发，不含正确答案（见 server toStudentQuestion）
  // 前置契约：本题要求哪些表/字段/视图先存在（服务端只下发 requires，
  // creates 是预期产物、属于答案，绝不下发）。空要求时服务端不发该字段。
  requires?: StudentRequires;
  scoreOverride: number | null;
  sortOrder: number;
}

/** 保存客观题作答请求体（PUT /api/my-exams/:id/answers，自动保存可反复调用） */
export interface SaveObjectiveAnswersRequest {
  answers: Array<{ questionId: string; answer: ObjectiveAnswerValue }>;
}

export type ExamMode = 'practice' | 'quiz' | 'exam';
export type ExamStatus = 'draft' | 'published' | 'in_progress' | 'ended' | 'archived';
export type SubmissionStatus = 'pending' | 'in_progress' | 'submitted' | 'grading' | 'graded';

export interface Paper {
  id: string;
  name: string;
  description: string | null;
  source: string;
  difficulty: string | null;
  passScore: number | null;
  totalScore: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; realName: string } | null;
  paperQuestions?: PaperQuestion[];
  _count?: { paperQuestions: number; exams: number };
  /** 组卷方式统计（列表接口附带）：固定题位/抽题题位各几个 */
  slotStats?: { fixed: number; rule: number };
}

export interface PaperQuestion {
  id: string;
  paperId: string;
  /** fixed 题位必填；rule 题位为 null（候选池在开考时决定） */
  questionId: string | null;
  sortOrder: number;
  score: number;
  /** fixed = 固定题；rule = 按知识点抽题 */
  slotType: SlotType;
  /** rule 题位的抽取条件（fixed 题位无） */
  rule?: SlotRule | null;
  /** rule 题位没有固定关联题目 */
  question: Question | null;
}

export interface Exam {
  id: string;
  title: string;
  description: string | null;
  mode: ExamMode;
  durationMinutes: number | null;
  startTime: string | null;
  endTime: string | null;
  totalScore: number;
  passScore: number | null;
  status: ExamStatus;
  settings: Record<string, any>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; realName: string } | null;
  paperId?: string | null;
  paper?: { id: string; name: string; totalScore: number; passScore: number | null; _count?: { paperQuestions: number } } | null;
  batchId?: string | null;
  batch?: {
    id?: string;
    name: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    examMode?: string;
    examDuration?: number;
    waitingTime?: number;
    lateTolerance?: number;
    ipLimitEnabled?: boolean;
    freezeMinutes?: number;
    exitPolicy?: string;
    exitMaxCount?: number;
    exitMaxMinutes?: number;
    rulesContent?: string;
    rulesReadSeconds?: number;
  } | null;
  assignments?: {
    id: string;
    roomId: string;
    status: string;
    room: { id: string; code: string; name: string };
    _count?: { students: number };
  }[];
  examQuestions?: ExamQuestion[];
  _count?: { examQuestions: number; submissions: number };
}

export interface ExamQuestion {
  id: string;
  examId: string;
  questionId: string;
  sortOrder: number;
  scoreOverride: number | null;
  question: Question;
}

export interface StudentSubmission {
  id: string;
  examId: string;
  studentId: string;
  tableSpaceId: string | null;
  status: SubmissionStatus;
  startedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  totalScore: number | null;
  graderComment: string | null;
  gradedBy: string | null;
  createdAt: string;
  student?: { id: string; username: string; realName: string };
  exam?: { title: string; totalScore: number; passScore: number | null };
  details?: SubmissionDetail[];
  verificationResults?: VerificationResult[];
  _count?: { details: number };
}

export interface SubmissionDetail {
  id: string;
  submissionId: string;
  questionId: string;
  answerJson: Record<string, any>;
  score: number | null;
  isCorrect: boolean | null;
  question?: { id: string; title: string; type: string; score: number; answerRules?: AnswerRule[] };
  verificationResults?: VerificationResult[];
}

export interface VerificationResult {
  id: string;
  submissionDetailId: string;
  submissionId: string;
  ruleId: string;
  action: string;
  expected: any;
  actual: any;
  passed: boolean;
  score: number;
  errorMessage: string | null;
  needsReview: boolean;
  verifiedAt: string;
}

/** 规则判分结果（来自规则引擎，与 server RuleResult 一致） */
export interface RuleResult {
  ruleId: string;
  action: string;
  passed: boolean;
  score: number;
  maxScore: number;
  expected: any;
  actual: any;
  errorMessage?: string;
  needsReview: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExamStatistics {
  examId: string;
  examTitle: string;
  totalScore: number;
  passScore: number | null;
  submissionCount: number;
  /** 缺考人数（应参考名单中没有任何提交记录的学生） */
  absentCount: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  passRate: number | null;
  distribution: Record<string, number>;
  questionStats: QuestionStat[];
  submissions: StudentScoreItem[];
}

export interface QuestionStat {
  questionId: string;
  title: string;
  type: string;
  maxScore: number;
  answerCount: number;
  correctCount: number;
  correctRate: number;
  avgScore: number;
}

export interface StudentScoreItem {
  id: string;
  studentId: string;
  studentName: string;
  /** absent = 应参考但无提交记录（缺考）；其余为提交状态机上的状态 */
  status: string;
  score: number | null;
  /** 是否及格；未判分/缺考为 null（不能替教师下结论） */
  passed: boolean | null;
  submittedAt: string | null;
  roomName: string | null;
  /** 该场考试触发的高危行为（HIGH/CRITICAL）次数，仅作复核线索 */
  riskCount: number;
}

export interface StudentStat {
  student: { id: string; username: string; realName: string | null };
  totalExams: number;
  avgScore: number;
  passedExams: number;
  passRate: number;
  submissions: {
    examTitle: string;
    mode: string;
    score: number | null;
    passScore: number | null;
    passed: boolean | null;
    submittedAt: string | null;
  }[];
}

export interface OverviewStats {
  totalStudents: number;
  totalTeachers: number;
  totalQuestions: number;
  totalExams: number;
  totalSubmissions: number;
  gradedSubmissions: number;
  gradingRate: number;
  recentExams: Exam[];
}

// ========== 学生信息管理模块类型 ==========

// 组织架构类型
export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  sortOrder?: number;
  majors?: Major[];
  createdAt?: string;
}

export interface Major {
  id: string;
  name: string;
  code: string;
  departmentId: string;
  description?: string;
  sortOrder?: number;
  department?: Department;
  classRooms?: ClassRoom[];
  createdAt?: string;
}

export interface ClassRoom {
  id: string;
  name: string;
  code: string;
  academicYear: string;
  gradeLevel: number;
  majorId: string;
  departmentId: string;
  major?: Major;
  department?: Department;
  studentCount?: number;
  createdAt?: string;
}

// 邀请与审批类型
export interface Invitation {
  id: string;
  code: string;
  classRoomId: string;
  classRoom?: ClassRoom;
  createdBy: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  status: 'ACTIVE' | 'EXPIRED' | 'DISABLED';
  createdAt: string;
}

export interface StudentApplication {
  id: string;
  invitationId: string;
  realName: string;
  studentId: string;
  phoneNumber?: string;
  gender?: 'MALE' | 'FEMALE';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  invitation?: Invitation;
}

// 导入导出任务类型
export interface ImportTask {
  id: string;
  type: string;
  fileName: string;
  taskName?: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: 'PENDING' | 'PROCESSING' | 'FINISHED' | 'FAILED';
  errorFile?: string;
  downloadUrl?: string;
  createdBy: string;
  creator?: { realName?: string; username: string };
  createdAt: string;
  completedAt?: string;
}

// 扩展 User 类型（如果现有 User 接口需要扩展字段）
export interface StudentInfo {
  id: string;
  username: string;
  realName?: string;
  studentId?: string;
  employeeId?: string;
  gender?: 'MALE' | 'FEMALE';
  phoneNumber?: string;
  email?: string;
  accountStatus: 'ENABLED' | 'DISABLED';
  departmentId?: string;
  majorId?: string;
  classRoomId?: string;
  department?: Department;
  major?: Major;
  classRoom?: ClassRoom;
  lastLoginAt?: string;
  createdAt: string;
  /** 练习表格配置摘要（学生列表接口附带；供"已配置/未配置"展示） */
  practiceTableAssignment?: {
    id: string;
    fileId: string;
    shareUrl: string | null;
    updatedAt: string;
  } | null;
}

// ========== 缓存管理模块类型 ==========

export interface CacheEntry {
  key: string;
  createdAt: string;
  age: number;
  size: number;
}

export interface CacheInfo {
  totalEntries: number;
  entries: CacheEntry[];
}

// ========== 系统管理模块类型 ==========

export interface SystemRole {
  id: string;
  roleCode: string;
  roleName: string;
  roleType: 'preset' | 'custom';
  description?: string;
  status: 'ACTIVE' | 'DISABLED';
  permissions: string[];
  userCount?: number;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemModule {
  code: string;
  name: string;
  description?: string;
}

// 扩展 Account 类型（用于账户管理页面）
export interface Account {
  id: string;
  username: string;
  realName?: string;
  email?: string;
  role: 'admin' | 'teacher' | 'student';
  gender?: 'MALE' | 'FEMALE' | 'UNSET';
  remark?: string;
  employeeId?: string;
  systemRoleId?: string;
  systemRole?: { roleCode: string; roleName: string };
  accountStatus: 'ENABLED' | 'DISABLED';
  lastLoginAt?: string;
  createdAt: string;
}

// ========== 出题辅助模块类型 ==========
// @see docs/superpowers/specs/2026-07-07-exam-authoring-assist.md
// 与 server 端 capability-graph.ts / answer-reverser.ts / skeleton-generator.ts 对齐

export type CapabilityDomain = 'tables' | 'fields' | 'field_props' | 'views' | 'forms' | 'records';
export type Scorable = 'auto' | 'manual' | 'needsReview';

export interface ParamResolver {
  param: string;
  from?: string;       // 从 Match 取值的字段名
  value?: any;         // 固定值
}

export interface RuleTemplate {
  action: string;
  paramResolvers: ParamResolver[];
}

export interface ExamPattern {
  title: string;
  description: string;
  suggestedScore: number;
  ruleTemplate: RuleTemplate | null;  // null 表示人工评分
}

export interface Capability {
  id: string;
  domain: CapabilityDomain;
  name: string;
  description: string;
  wpsConcept: string;
  scorable: Scorable;
  ruleActions: string[];
  examPatterns: ExamPattern[];
  prerequisites?: string[];
  defaultDifficulty: 'easy' | 'medium' | 'hard';
  apiSupport?: {
    schema?: boolean;
    endpoint?: string;
    limitations?: string;
  };
  promptHints?: string;
}

export interface CapabilityDomainInfo {
  id: CapabilityDomain;
  label: string;
  count: number;
}

export interface CapabilityGraphResponse {
  data: {
    domains: CapabilityDomainInfo[];
    capabilities: Capability[];
  };
  total: number;
}

/** 题目骨架（POST /api/questions/skeleton 响应） */
export interface QuestionSkeleton {
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard';
  suggestedScore: number;
  ruleTemplates: RuleTemplate[];
  selectedCapabilities: Array<{
    id: string;
    name: string;
    domain: CapabilityDomain;
    scorable: Scorable;
  }>;
  warnings: string[];
}

/** 反向生成的规则建议 */
export interface RuleSuggestion {
  rule: AnswerRule;
  source: {
    sheetName: string;
    sheetId: number;
    fieldName?: string;
    capabilityId: string;
  };
  editable: boolean;       // 缺参数的规则为 true
  selected: boolean;       // 默认是否勾选
  missingParams: string[]; // 缺失的参数名
}

export interface SchemaSummary {
  sheets: { name: string; fieldCount: number; viewCount: number }[];
  forms: { name: string; fieldCount: number }[];
}

/** POST /api/questions/reverse-rules 响应 */
export interface ReverseOutput {
  suggestions: RuleSuggestion[];
  schemaSummary: SchemaSummary;
  notes: string[];
}

// ============================================================
// Phase 2：AI 对话式教练
// ============================================================

/** AI 建议卡（与服务端 proposals.ts 对齐，6 种类型） */
export type Proposal =
  | { type: 'add_capability'; capabilityId: string; reason: string }
  | { type: 'rewrite_description'; newDescription: string; reason: string }
  | { type: 'adjust_score'; ruleId: string; newScore: number; reason: string }
  | { type: 'remove_rule'; ruleId: string; reason: string }
  | { type: 'add_hint'; hint: string; reason: string }
  | {
      type: 'add_rule';
      action: string;
      tableName: string;
      fieldName?: string;
      reason: string;
      /** 服务端 ground 后回填；LLM 不产出 */
      groundedRule?: AnswerRule;
    };

/** 对话历史（仅文字，proposals 是 UI 临时态不回传） */
export interface CoachingMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 题目状态（每轮发送前从表单现场拼装，让 AI 看到最新状态） */
export interface QuestionState {
  title: string;
  description: string;
  type: string;
  difficulty: string;
  score: number;
  selectedCapabilityIds: string[];
  currentRules: Array<{
    id: string;
    action: string;
    tableName?: string;
    fieldName?: string;
    score: number;
  }>;
  hints?: string;
}

/** POST /api/coaching/chat 请求体 */
export interface CoachingChatParams {
  questionState: QuestionState;
  history: CoachingMessage[];
  fileId?: string;
  accessToken?: string;
  apiSecret?: string;
}

// ============================================================
// 个人题集（收藏 + 错题本）
// ============================================================

/** 题集列表中的题目摘要（GET /api/practice/favorite、/api/practice/wrong） */
export interface QuestionBrief {
  id: string;
  title: string;
  type: QuestionType;
  difficulty: Difficulty;
  score: number;
  status: QuestionStatus;
  description: string | null;
  analysis: string | null;
  hints: string | null;
  primaryCategory?: { id: string; name: string } | null;
  secondaryCategory?: { id: string; name: string } | null;
}

/** 收藏条目 */
export interface FavoriteItem {
  id: string;
  createdAt: string;
  question: QuestionBrief;
}

/** 错题条目 */
export interface WrongItem {
  id: string;
  wrongCount: number;
  lastWrongAt: string;
  question: QuestionBrief;
}

/** POST /api/practice/start 响应（开练结果，随路由 state 传给作答页） */
export interface StartResponse {
  recordId: string;
  questions: Array<{
    questionId: string;
    sortOrder: number;
    title: string;
    description: string | null;
    type: string;
    difficulty: string;
    score: number;
    hints: string | null;
  }>;
  maxScore: number;
  shareUrl: string | null;
}
