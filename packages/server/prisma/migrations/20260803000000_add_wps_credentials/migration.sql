-- 新增 WPS 应用凭据字段（前端 WPS Token 页可配置，持久化到 DB）
ALTER TABLE "wps_config" ADD COLUMN "client_id" TEXT;
ALTER TABLE "wps_config" ADD COLUMN "client_secret" TEXT;
