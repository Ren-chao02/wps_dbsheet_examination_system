-- DropForeignKey
ALTER TABLE "exam_questions" DROP CONSTRAINT "exam_questions_question_id_fkey";

-- DropForeignKey
ALTER TABLE "paper_questions" DROP CONSTRAINT "paper_questions_question_id_fkey";

-- AddForeignKey
ALTER TABLE "paper_questions" ADD CONSTRAINT "paper_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

