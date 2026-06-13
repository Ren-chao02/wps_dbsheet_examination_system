export interface User {
  id: string;
  username: string;
  realName: string | null;
  role: 'admin' | 'teacher' | 'student';
  email: string | null;
  avatarUrl: string | null;
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
}

export interface QuestionCategory {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
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
  categoryId: string | null;
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
  category?: { id: string; name: string } | null;
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
