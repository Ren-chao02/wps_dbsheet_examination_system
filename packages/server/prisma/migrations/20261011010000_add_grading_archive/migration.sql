-- AlterTable
ALTER TABLE "submission_details" ADD COLUMN     "graded_with" JSONB;

-- CreateTable
CREATE TABLE "grade_review_logs" (
    "id" UUID NOT NULL,
    "submission_detail_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "reviewer_id" UUID,
    "reviewer_name" VARCHAR(64),
    "before_score" INTEGER,
    "after_score" INTEGER,
    "before_correct" BOOLEAN,
    "after_correct" BOOLEAN,
    "change_type" VARCHAR(32) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "grade_review_logs_submission_id_created_at_idx" ON "grade_review_logs"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "grade_review_logs_submission_detail_id_idx" ON "grade_review_logs"("submission_detail_id");

-- AddForeignKey
ALTER TABLE "grade_review_logs" ADD CONSTRAINT "grade_review_logs_submission_detail_id_fkey" FOREIGN KEY ("submission_detail_id") REFERENCES "submission_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

