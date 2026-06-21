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

-- CreateIndex
CREATE INDEX "exam_table_assignments_exam_id_idx" ON "exam_table_assignments"("exam_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_table_assignments_exam_id_student_id_key" ON "exam_table_assignments"("exam_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_table_assignments_exam_id_file_id_key" ON "exam_table_assignments"("exam_id", "file_id");

-- AddForeignKey
ALTER TABLE "exam_table_assignments" ADD CONSTRAINT "exam_table_assignments_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_table_assignments" ADD CONSTRAINT "exam_table_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_table_assignments" ADD CONSTRAINT "exam_table_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
