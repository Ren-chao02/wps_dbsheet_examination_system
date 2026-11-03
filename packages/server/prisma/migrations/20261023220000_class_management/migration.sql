-- 班级管理：班级成为主实体，院系/专业退为可选元数据
-- 纯新增/放宽约束，不删除列、不改存量值。

CREATE TYPE "ClassRoomSource" AS ENUM ('MANUAL', 'SYSTEM');

ALTER TABLE "ClassRoom" ALTER COLUMN "departmentId" DROP NOT NULL;
ALTER TABLE "ClassRoom" ALTER COLUMN "majorId" DROP NOT NULL;

-- 删院系/专业时不再连带删班或阻止删除：班级保留，归属置空
ALTER TABLE "ClassRoom" DROP CONSTRAINT "ClassRoom_departmentId_fkey";
ALTER TABLE "ClassRoom" DROP CONSTRAINT "ClassRoom_majorId_fkey";
ALTER TABLE "ClassRoom"
  ADD CONSTRAINT "ClassRoom_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClassRoom"
  ADD CONSTRAINT "ClassRoom_majorId_fkey"
  FOREIGN KEY ("majorId") REFERENCES "Major"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClassRoom" ADD COLUMN "created_by" UUID;
ALTER TABLE "ClassRoom" ADD COLUMN "source" "ClassRoomSource" NOT NULL DEFAULT 'SYSTEM';

ALTER TABLE "ClassRoom"
  ADD CONSTRAINT "ClassRoom_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ClassRoom_created_by_idx" ON "ClassRoom"("created_by");
