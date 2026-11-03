-- 个人信息 / 自助改密：记录最近一次改密时间，供 authenticate 使更早签发的 JWT 失效
-- 只加这一列：migrate diff 同时还报出 ClassRoom_created_by_idx 漂移（线上索引未写进 schema），
-- 与本需求无关，不能顺手 DROP。
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMP(3);
