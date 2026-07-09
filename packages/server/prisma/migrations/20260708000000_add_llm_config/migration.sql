-- CreateTable
CREATE TABLE "llm_config" (
    "id" TEXT NOT NULL DEFAULT 'llm_config',
    "provider" TEXT NOT NULL DEFAULT 'deepseek',
    "api_key" TEXT NOT NULL,
    "base_url" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "max_tokens" INTEGER NOT NULL DEFAULT 2048,
    "timeout_ms" INTEGER NOT NULL DEFAULT 60000,
    "rate_limit_per_min" INTEGER NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_config_pkey" PRIMARY KEY ("id")
);
