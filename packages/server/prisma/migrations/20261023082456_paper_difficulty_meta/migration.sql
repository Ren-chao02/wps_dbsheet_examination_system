-- AlterTable
ALTER TABLE "papers" ADD COLUMN "difficulty_target" JSONB;

-- AlterTable
ALTER TABLE "exams" ADD COLUMN "difficulty_target" JSONB;

-- AlterTable
ALTER TABLE "student_exam_questions" ADD COLUMN "pick_meta" JSONB;
