-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "department_id" TEXT;

-- AlterTable
ALTER TABLE "papers" ADD COLUMN     "department_id" TEXT,
ADD COLUMN     "shared_to_school" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "department_id" TEXT,
ADD COLUMN     "shared_to_school" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "exams_department_id_idx" ON "exams"("department_id");

-- CreateIndex
CREATE INDEX "papers_department_id_idx" ON "papers"("department_id");

-- CreateIndex
CREATE INDEX "questions_department_id_idx" ON "questions"("department_id");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "papers" ADD CONSTRAINT "papers_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 回填（数据范围 P2）：资产归属 = 创建者当前的院系；创建者无院系或已删除 → 保持 NULL（= 校级资源）。
-- 放在同一迁移里而不是单独脚本：全新部署时表为空、语句自然空跑；存量库则一次性回填，不给部署留"忘记跑脚本"的口子。
UPDATE "exams" e SET "department_id" = u."department_id" FROM "users" u
  WHERE e."created_by" = u."id" AND u."department_id" IS NOT NULL AND e."department_id" IS NULL;
UPDATE "papers" p SET "department_id" = u."department_id" FROM "users" u
  WHERE p."created_by" = u."id" AND u."department_id" IS NOT NULL AND p."department_id" IS NULL;
UPDATE "questions" q SET "department_id" = u."department_id" FROM "users" u
  WHERE q."created_by" = u."id" AND u."department_id" IS NOT NULL AND q."department_id" IS NULL;
