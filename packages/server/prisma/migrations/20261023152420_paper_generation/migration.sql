-- CreateTable
CREATE TABLE "exam_paper_generations" (
    "id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "total_students" INTEGER NOT NULL DEFAULT 0,
    "unfilled_slots" JSONB,
    "summary" JSONB,
    "error" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "exam_paper_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_paper_generations_exam_id_key" ON "exam_paper_generations"("exam_id");

-- AddForeignKey
ALTER TABLE "exam_paper_generations" ADD CONSTRAINT "exam_paper_generations_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
