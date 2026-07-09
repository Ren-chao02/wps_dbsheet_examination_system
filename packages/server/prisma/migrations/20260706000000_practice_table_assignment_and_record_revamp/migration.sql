-- CreateEnum
CREATE TYPE "PracticeStatus" AS ENUM ('in_progress', 'graded');

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

-- CreateIndex
CREATE UNIQUE INDEX "practice_table_assignments_student_id_key" ON "practice_table_assignments"("student_id");

-- AddForeignKey
ALTER TABLE "practice_table_assignments" ADD CONSTRAINT "practice_table_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: questions 新增 analysis
ALTER TABLE "questions" ADD COLUMN "analysis" TEXT;

-- AlterTable: practice_records 改造
ALTER TABLE "practice_records" ALTER COLUMN "paper_id" DROP NOT NULL;
ALTER TABLE "practice_records" ADD COLUMN "questions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "practice_records" ADD COLUMN "table_space_id" TEXT;
ALTER TABLE "practice_records" ADD COLUMN "status" "PracticeStatus" NOT NULL DEFAULT 'in_progress';

-- AddForeignKey: practice_records.paper_id 改为可选（onDelete Cascade 保持）
-- 原有外键约束在 DROP NOT NULL 时不需要重建
