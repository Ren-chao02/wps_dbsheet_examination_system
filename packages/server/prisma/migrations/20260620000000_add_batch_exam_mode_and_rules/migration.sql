-- AlterTable
ALTER TABLE "exam_batches" ADD COLUMN     "end_time" TIMESTAMP(3),
ADD COLUMN     "exam_mode" VARCHAR(32) NOT NULL DEFAULT 'unified',
ADD COLUMN     "exit_max_count" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "exit_max_minutes" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "exit_policy" VARCHAR(32) NOT NULL DEFAULT 'finite',
ADD COLUMN     "freeze_minutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "ip_limit_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rules_content" TEXT,
ADD COLUMN     "rules_read_seconds" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "start_time" TIMESTAMP(3);

