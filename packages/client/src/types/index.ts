export interface User {
  id: string;
  username: string;
  realName: string | null;
  role: 'admin' | 'teacher' | 'student';
  email: string | null;
  avatarUrl: string | null;
  wpsId?: string | null;
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

export interface QuestionCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  level: number;
  createdAt: string;
  children?: QuestionCategory[];
}

export type QuestionType = 'create_table' | 'add_field' | 'config_view' | 'create_form' | 'comprehensive';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'draft' | 'published' | 'archived';

export interface AnswerRule {
  id: string;
  action: string;
  params: Record<string, any>;
  score: number;
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
  hints: string | null;
  tags: string[];
  status: QuestionStatus;
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

export type ExamMode = 'practice' | 'quiz' | 'exam';
export type ExamStatus = 'draft' | 'published' | 'in_progress' | 'ended' | 'archived';
export type SubmissionStatus = 'pending' | 'in_progress' | 'submitted' | 'grading' | 'graded';

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
  studentName: string;
  score: number | null;
  submittedAt: string | null;
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
