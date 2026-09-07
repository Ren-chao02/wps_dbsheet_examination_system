-- ✅ 统一导出中心任务（持久化）
CREATE TABLE "export_tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" VARCHAR(32) NOT NULL,
    "entity_id" UUID,
    "format" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'processing',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "file_name" VARCHAR(255),
    "file_size" INTEGER,
    "record_count" INTEGER,
    "download_url" VARCHAR(512),
    "file_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "export_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "export_tasks_user_id_created_at_idx" ON "export_tasks"("user_id", "created_at");

ALTER TABLE "export_tasks"
    ADD CONSTRAINT "export_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
