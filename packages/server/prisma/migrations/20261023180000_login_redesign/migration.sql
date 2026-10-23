-- 登录页改版 + 学号登录 + 记住我 + 登录安全 + WPS SSO
-- 全部为新增列/索引，不需要数据回填，旧账号默认 failed_login_attempts=0。

ALTER TABLE "users"
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3),
  ADD COLUMN "wps_user_id" VARCHAR(128),
  ADD COLUMN "wps_bound_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "users_wps_user_id_key" ON "users"("wps_user_id");
