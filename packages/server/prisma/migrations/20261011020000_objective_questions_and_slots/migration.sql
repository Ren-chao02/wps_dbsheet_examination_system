-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuestionType" ADD VALUE 'single_choice';
ALTER TYPE "QuestionType" ADD VALUE 'multiple_choice';
ALTER TYPE "QuestionType" ADD VALUE 'true_false';

-- DropForeignKey
ALTER TABLE "exam_questions" DROP CONSTRAINT "exam_questions_question_id_fkey";

-- DropForeignKey
ALTER TABLE "paper_questions" DROP CONSTRAINT "paper_questions_question_id_fkey";

-- AlterTable
ALTER TABLE "exam_questions" ADD COLUMN     "rule" JSONB,
ADD COLUMN     "slot_index" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "slot_type" VARCHAR(16) NOT NULL DEFAULT 'fixed',
ALTER COLUMN "question_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "paper_questions" ADD COLUMN     "rule" JSONB,
ADD COLUMN     "slot_type" VARCHAR(16) NOT NULL DEFAULT 'fixed',
ALTER COLUMN "question_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "capability_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "objective_answer" JSONB,
ADD COLUMN     "schema_refs" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "student_exam_questions" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "question_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(16) NOT NULL DEFAULT 'fixed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_exam_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_exam_questions_exam_id_student_id_idx" ON "student_exam_questions"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_exam_questions_exam_id_student_id_slot_index_key" ON "student_exam_questions"("exam_id", "student_id", "slot_index");

-- CreateIndex
CREATE INDEX "exam_questions_exam_id_slot_index_idx" ON "exam_questions"("exam_id", "slot_index");

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_questions" ADD CONSTRAINT "student_exam_questions_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_questions" ADD CONSTRAINT "student_exam_questions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_exam_questions" ADD CONSTRAINT "student_exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

