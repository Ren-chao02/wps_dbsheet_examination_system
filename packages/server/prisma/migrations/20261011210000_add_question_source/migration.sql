-- 官方/校本题库区分：official = 平台维护的官方题库（教师不可编辑/删除）；school = 教师自建（默认）
ALTER TABLE "questions" ADD COLUMN "source" VARCHAR(16) NOT NULL DEFAULT 'school';
