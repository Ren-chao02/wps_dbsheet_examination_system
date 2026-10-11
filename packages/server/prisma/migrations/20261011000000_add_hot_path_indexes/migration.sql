-- CreateIndex
CREATE INDEX "exam_sessions_student_id_exam_id_idx" ON "exam_sessions"("student_id", "exam_id");

-- CreateIndex
CREATE INDEX "exam_sessions_exam_id_last_heartbeat_idx" ON "exam_sessions"("exam_id", "last_heartbeat");

-- CreateIndex
CREATE INDEX "exams_status_end_time_idx" ON "exams"("status", "end_time");

-- CreateIndex
CREATE INDEX "exams_status_start_time_idx" ON "exams"("status", "start_time");

-- CreateIndex
CREATE INDEX "questions_status_primary_category_id_idx" ON "questions"("status", "primary_category_id");

-- CreateIndex
CREATE INDEX "questions_status_secondary_category_id_idx" ON "questions"("status", "secondary_category_id");

-- CreateIndex
CREATE INDEX "questions_status_difficulty_idx" ON "questions"("status", "difficulty");

-- CreateIndex
CREATE INDEX "student_submissions_student_id_status_idx" ON "student_submissions"("student_id", "status");

-- CreateIndex
CREATE INDEX "student_submissions_exam_id_status_idx" ON "student_submissions"("exam_id", "status");

-- CreateIndex
CREATE INDEX "users_role_class_room_id_idx" ON "users"("role", "class_room_id");

-- CreateIndex
CREATE INDEX "users_role_department_id_idx" ON "users"("role", "department_id");

-- CreateIndex
CREATE INDEX "verification_results_submission_id_idx" ON "verification_results"("submission_id");

-- CreateIndex
CREATE INDEX "verification_results_submission_detail_id_idx" ON "verification_results"("submission_detail_id");
