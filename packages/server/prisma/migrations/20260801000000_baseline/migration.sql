-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('create_table', 'add_field', 'config_view', 'create_form', 'comprehensive');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "PracticeStatus" AS ENUM ('in_progress', 'graded');

-- CreateEnum
CREATE TYPE "ExamMode" AS ENUM ('practice', 'quiz', 'exam');

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('draft', 'published', 'scheduled', 'in_progress', 'ended', 'cancelled', 'archived');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('draft', 'active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "BatchExamMode" AS ENUM ('unified', 'flexible');

-- CreateEnum
CREATE TYPE "ExamRoomStatus" AS ENUM ('available', 'maintenance');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('scheduled', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('pending', 'in_progress', 'submitted', 'grading', 'graded');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNSET');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'FINISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BehaviorType" AS ENUM ('TAB_SWITCH', 'COPY_PASTE', 'WINDOW_BLUR', 'FULLSCREEN_EXIT', 'KEYBOARD_SHORTCUT', 'MOUSE_SUSPICIOUS', 'QUESTION_NAVIGATE', 'ANSWER_SUBMIT', 'EXAM_START', 'EXAM_END');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT', 'REVIEW');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'EXAM', 'GRADE', 'ALERT', 'AUDIT');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "real_name" VARCHAR(128),
    "role" "UserRole" NOT NULL,
    "email" VARCHAR(255),
    "avatar_url" VARCHAR(512),
    "student_id" VARCHAR(64),
    "employee_id" VARCHAR(64),
    "gender" "Gender",
    "phone_number" VARCHAR(32),
    "account_status" "AccountStatus" NOT NULL DEFAULT 'ENABLED',
    "remark" VARCHAR(512),
    "system_role_id" UUID,
    "last_login_at" TIMESTAMP(3),
    "department_id" TEXT,
    "major_id" TEXT,
    "class_room_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" VARCHAR(512),
    "icon" VARCHAR(64),
    "status" "CategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "level" INTEGER NOT NULL DEFAULT 1,
    "path" VARCHAR(1024),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "primary_category_id" UUID,
    "secondary_category_id" UUID,
    "teacher_name" VARCHAR(64),
    "updated_by" VARCHAR(64),
    "title" VARCHAR(512) NOT NULL,
    "description" TEXT,
    "type" "QuestionType" NOT NULL DEFAULT 'comprehensive',
    "difficulty" "Difficulty" NOT NULL DEFAULT 'medium',
    "score" INTEGER NOT NULL DEFAULT 10,
    "answer_rules" JSONB NOT NULL DEFAULT '[]',
    "hints" TEXT,
    "analysis" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "QuestionStatus" NOT NULL DEFAULT 'published',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "papers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "source" VARCHAR(32) NOT NULL DEFAULT 'local',
    "difficulty" VARCHAR(32),
    "pass_score" INTEGER,
    "total_score" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "papers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_questions" (
    "id" UUID NOT NULL,
    "paper_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "paper_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "mode" "ExamMode" NOT NULL DEFAULT 'practice',
    "duration_minutes" INTEGER,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "total_score" INTEGER NOT NULL DEFAULT 100,
    "pass_score" INTEGER,
    "status" "ExamStatus" NOT NULL DEFAULT 'draft',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paper_id" UUID,
    "batch_id" UUID,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_batches" (
    "id" UUID NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "exam_mode" "BatchExamMode" NOT NULL DEFAULT 'unified',
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "exam_duration" INTEGER NOT NULL,
    "waiting_time" INTEGER NOT NULL,
    "late_tolerance" INTEGER NOT NULL,
    "ip_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowed_ips" JSONB NOT NULL DEFAULT '[]',
    "freeze_minutes" INTEGER NOT NULL DEFAULT 30,
    "exit_policy" VARCHAR(32) NOT NULL DEFAULT 'finite',
    "exit_max_count" INTEGER NOT NULL DEFAULT 10,
    "exit_max_minutes" INTEGER NOT NULL DEFAULT 20,
    "rules_content" TEXT,
    "rules_read_seconds" INTEGER NOT NULL DEFAULT 15,
    "status" "BatchStatus" NOT NULL DEFAULT 'draft',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_rooms" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "location" VARCHAR(256),
    "equipment" JSONB NOT NULL DEFAULT '[]',
    "status" "ExamRoomStatus" NOT NULL DEFAULT 'available',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_room_assignments" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_room_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_room_students" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "seat_number" INTEGER NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_room_students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_questions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "score_override" INTEGER,

    CONSTRAINT "exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_submissions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "table_space_id" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'pending',
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "graded_at" TIMESTAMP(3),
    "total_score" INTEGER,
    "grader_comment" TEXT,
    "graded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_details" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "answer_json" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "is_correct" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_results" (
    "id" UUID NOT NULL,
    "submission_detail_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "rule_id" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "expected" JSONB,
    "actual" JSONB,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_sessions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "ws_connected" BOOLEAN NOT NULL DEFAULT false,
    "last_heartbeat" TIMESTAMP(3),
    "ip_address" INET,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Major" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Major_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassRoom" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "gradeLevel" INTEGER NOT NULL DEFAULT 1,
    "departmentId" TEXT NOT NULL,
    "majorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wps_config" (
    "id" TEXT NOT NULL DEFAULT 'wps_config',
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "refresh_expires_at" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wps_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_config" (
    "id" TEXT NOT NULL DEFAULT 'llm_config',
    "provider" TEXT NOT NULL DEFAULT 'deepseek',
    "api_key" TEXT NOT NULL,
    "base_url" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "max_tokens" INTEGER NOT NULL DEFAULT 2048,
    "timeout_ms" INTEGER NOT NULL DEFAULT 60000,
    "rate_limit_per_min" INTEGER NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "llm_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "InvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentApplication" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "realName" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "gender" "Gender",
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportTask" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "task_name" VARCHAR(256),
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "errorFile" TEXT,
    "download_url" VARCHAR(512),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_roles" (
    "id" UUID NOT NULL,
    "role_code" VARCHAR(64) NOT NULL,
    "role_name" VARCHAR(128) NOT NULL,
    "role_type" VARCHAR(16) NOT NULL DEFAULT 'custom',
    "description" VARCHAR(512),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "module_code" VARCHAR(64) NOT NULL,

    CONSTRAINT "system_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_behavior_logs" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "submission_id" UUID,
    "behavior_type" "BehaviorType" NOT NULL,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_behavior_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavior_analysis_reports" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "total_behaviors" INTEGER NOT NULL,
    "tab_switch_count" INTEGER NOT NULL DEFAULT 0,
    "copy_paste_count" INTEGER NOT NULL DEFAULT 0,
    "blur_count" INTEGER NOT NULL DEFAULT 0,
    "high_risk_count" INTEGER NOT NULL DEFAULT 0,
    "critical_count" INTEGER NOT NULL DEFAULT 0,
    "suspicious_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conclusion" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavior_analysis_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity_type" VARCHAR(128) NOT NULL,
    "entity_id" UUID,
    "old_data" JSONB,
    "new_data" JSONB,
    "changed_fields" TEXT,
    "user_id" UUID,
    "username" VARCHAR(64),
    "user_role" VARCHAR(32),
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "request_url" VARCHAR(512),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" VARCHAR(256) NOT NULL,
    "content" TEXT,
    "user_id" UUID NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "sender_id" UUID,
    "entity_type" VARCHAR(128),
    "entity_id" UUID,
    "action_url" VARCHAR(512),
    "sent_via_web" BOOLEAN NOT NULL DEFAULT false,
    "sent_via_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "enable_web_push" BOOLEAN NOT NULL DEFAULT true,
    "enable_email" BOOLEAN NOT NULL DEFAULT false,
    "enable_system" BOOLEAN NOT NULL DEFAULT true,
    "enable_exam" BOOLEAN NOT NULL DEFAULT true,
    "enable_grade" BOOLEAN NOT NULL DEFAULT true,
    "enable_alert" BOOLEAN NOT NULL DEFAULT true,
    "enable_audit" BOOLEAN NOT NULL DEFAULT true,
    "email_frequency" VARCHAR(32) NOT NULL DEFAULT 'realtime',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "content" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_records" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "paper_id" UUID,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "table_space_id" TEXT,
    "status" "PracticeStatus" NOT NULL DEFAULT 'in_progress',
    "score" INTEGER,
    "max_score" INTEGER NOT NULL,
    "passed" BOOLEAN,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "details" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wrong_questions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "wrong_count" INTEGER NOT NULL DEFAULT 1,
    "last_wrong_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wrong_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_questions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_feedback" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "feedback_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_table_assignments" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "file_id" TEXT NOT NULL,
    "share_url" TEXT,
    "access_token" TEXT,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_table_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_table_assignments" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "file_id" TEXT NOT NULL,
    "share_url" TEXT,
    "access_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "practice_table_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_classes" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "class_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RoomInvigilators" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- CreateTable
CREATE TABLE "_AssignmentInvigilators" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_student_id_key" ON "users"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE INDEX "question_categories_parent_id_idx" ON "question_categories"("parent_id");

-- CreateIndex
CREATE INDEX "question_categories_status_idx" ON "question_categories"("status");

-- CreateIndex
CREATE INDEX "question_categories_level_idx" ON "question_categories"("level");

-- CreateIndex
CREATE UNIQUE INDEX "paper_questions_paper_id_question_id_key" ON "paper_questions"("paper_id", "question_id");

-- CreateIndex
CREATE INDEX "exams_batch_id_idx" ON "exams"("batch_id");

-- CreateIndex
CREATE INDEX "exam_batches_status_created_at_idx" ON "exam_batches"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_rooms_code_key" ON "exam_rooms"("code");

-- CreateIndex
CREATE INDEX "exam_rooms_status_idx" ON "exam_rooms"("status");

-- CreateIndex
CREATE INDEX "exam_room_assignments_room_id_status_idx" ON "exam_room_assignments"("room_id", "status");

-- CreateIndex
CREATE INDEX "exam_room_assignments_exam_id_status_idx" ON "exam_room_assignments"("exam_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "exam_room_assignments_exam_id_room_id_key" ON "exam_room_assignments"("exam_id", "room_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_room_students_assignment_id_student_id_key" ON "exam_room_students"("assignment_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_room_students_assignment_id_seat_number_key" ON "exam_room_students"("assignment_id", "seat_number");

-- CreateIndex
CREATE UNIQUE INDEX "exam_questions_exam_id_question_id_key" ON "exam_questions"("exam_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_submissions_exam_id_student_id_key" ON "student_submissions"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_details_submission_id_question_id_key" ON "submission_details"("submission_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sessions_submission_id_key" ON "exam_sessions"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Major_departmentId_code_key" ON "Major"("departmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ClassRoom_code_key" ON "ClassRoom"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "system_roles_role_code_key" ON "system_roles"("role_code");

-- CreateIndex
CREATE UNIQUE INDEX "system_role_permissions_role_id_module_code_key" ON "system_role_permissions"("role_id", "module_code");

-- CreateIndex
CREATE INDEX "student_behavior_logs_student_id_exam_id_behavior_type_idx" ON "student_behavior_logs"("student_id", "exam_id", "behavior_type");

-- CreateIndex
CREATE INDEX "student_behavior_logs_exam_id_risk_level_idx" ON "student_behavior_logs"("exam_id", "risk_level");

-- CreateIndex
CREATE INDEX "student_behavior_logs_occurred_at_idx" ON "student_behavior_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "behavior_analysis_reports_exam_id_suspicious_score_idx" ON "behavior_analysis_reports"("exam_id", "suspicious_score");

-- CreateIndex
CREATE UNIQUE INDEX "behavior_analysis_reports_exam_id_student_id_key" ON "behavior_analysis_reports"("exam_id", "student_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_entity_type_entity_id_idx" ON "audit_logs"("action", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_occurred_at_idx" ON "audit_logs"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "notifications"("user_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_type_created_at_idx" ON "notifications"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE INDEX "practice_records_student_id_created_at_idx" ON "practice_records"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "practice_records_paper_id_idx" ON "practice_records"("paper_id");

-- CreateIndex
CREATE INDEX "wrong_questions_student_id_last_wrong_at_idx" ON "wrong_questions"("student_id", "last_wrong_at");

-- CreateIndex
CREATE UNIQUE INDEX "wrong_questions_student_id_question_id_key" ON "wrong_questions"("student_id", "question_id");

-- CreateIndex
CREATE INDEX "favorite_questions_student_id_created_at_idx" ON "favorite_questions"("student_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_questions_student_id_question_id_key" ON "favorite_questions"("student_id", "question_id");

-- CreateIndex
CREATE INDEX "question_feedback_student_id_created_at_idx" ON "question_feedback"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "question_feedback_question_id_idx" ON "question_feedback"("question_id");

-- CreateIndex
CREATE INDEX "exam_table_assignments_exam_id_idx" ON "exam_table_assignments"("exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_table_assignments_exam_id_student_id_key" ON "exam_table_assignments"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_table_assignments_exam_id_file_id_key" ON "exam_table_assignments"("exam_id", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_table_assignments_student_id_key" ON "practice_table_assignments"("student_id");

-- CreateIndex
CREATE INDEX "teacher_classes_teacher_id_idx" ON "teacher_classes"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_classes_teacher_id_class_id_key" ON "teacher_classes"("teacher_id", "class_id");

-- CreateIndex
CREATE UNIQUE INDEX "_RoomInvigilators_AB_unique" ON "_RoomInvigilators"("A", "B");

-- CreateIndex
CREATE INDEX "_RoomInvigilators_B_index" ON "_RoomInvigilators"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_AssignmentInvigilators_AB_unique" ON "_AssignmentInvigilators"("A", "B");

-- CreateIndex
CREATE INDEX "_AssignmentInvigilators_B_index" ON "_AssignmentInvigilators"("B");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_major_id_fkey" FOREIGN KEY ("major_id") REFERENCES "Major"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_class_room_id_fkey" FOREIGN KEY ("class_room_id") REFERENCES "ClassRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_system_role_id_fkey" FOREIGN KEY ("system_role_id") REFERENCES "system_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_categories" ADD CONSTRAINT "question_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "question_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_primary_category_id_fkey" FOREIGN KEY ("primary_category_id") REFERENCES "question_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_secondary_category_id_fkey" FOREIGN KEY ("secondary_category_id") REFERENCES "question_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "exam_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_batches" ADD CONSTRAINT "exam_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_room_assignments" ADD CONSTRAINT "exam_room_assignments_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "exam_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_room_students" ADD CONSTRAINT "exam_room_students_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "exam_room_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_room_students" ADD CONSTRAINT "exam_room_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_submissions" ADD CONSTRAINT "student_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_details" ADD CONSTRAINT "submission_details_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "student_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_details" ADD CONSTRAINT "submission_details_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_submission_detail_id_fkey" FOREIGN KEY ("submission_detail_id") REFERENCES "submission_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "student_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "student_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Major" ADD CONSTRAINT "Major_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRoom" ADD CONSTRAINT "ClassRoom_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassRoom" ADD CONSTRAINT "ClassRoom_majorId_fkey" FOREIGN KEY ("majorId") REFERENCES "Major"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentApplication" ADD CONSTRAINT "StudentApplication_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTask" ADD CONSTRAINT "ImportTask_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_role_permissions" ADD CONSTRAINT "system_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "system_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior_logs" ADD CONSTRAINT "student_behavior_logs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior_logs" ADD CONSTRAINT "student_behavior_logs_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_behavior_logs" ADD CONSTRAINT "student_behavior_logs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "student_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_analysis_reports" ADD CONSTRAINT "behavior_analysis_reports_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "behavior_analysis_reports" ADD CONSTRAINT "behavior_analysis_reports_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_records" ADD CONSTRAINT "practice_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_records" ADD CONSTRAINT "practice_records_paper_id_fkey" FOREIGN KEY ("paper_id") REFERENCES "papers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wrong_questions" ADD CONSTRAINT "wrong_questions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wrong_questions" ADD CONSTRAINT "wrong_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_questions" ADD CONSTRAINT "favorite_questions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_questions" ADD CONSTRAINT "favorite_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_feedback" ADD CONSTRAINT "question_feedback_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_table_assignments" ADD CONSTRAINT "exam_table_assignments_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_table_assignments" ADD CONSTRAINT "exam_table_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_table_assignments" ADD CONSTRAINT "exam_table_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_table_assignments" ADD CONSTRAINT "practice_table_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_classes" ADD CONSTRAINT "teacher_classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_classes" ADD CONSTRAINT "teacher_classes_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "ClassRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoomInvigilators" ADD CONSTRAINT "_RoomInvigilators_A_fkey" FOREIGN KEY ("A") REFERENCES "exam_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoomInvigilators" ADD CONSTRAINT "_RoomInvigilators_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssignmentInvigilators" ADD CONSTRAINT "_AssignmentInvigilators_A_fkey" FOREIGN KEY ("A") REFERENCES "exam_room_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssignmentInvigilators" ADD CONSTRAINT "_AssignmentInvigilators_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

