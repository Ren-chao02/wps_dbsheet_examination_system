import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  kingsoft: {
    apiBaseUrl: process.env.KINGSOFT_API_BASE_URL || '',
    apiKey: process.env.KINGSOFT_API_KEY || '',
    apiSecret: process.env.KINGSOFT_API_SECRET || '',
  },
  // Phase 2：AI 对话式教练（多 provider，env 切换）
  llm: {
    provider: process.env.LLM_PROVIDER || 'deepseek',
    apiKey: process.env.LLM_API_KEY || '',
    baseURL: process.env.LLM_BASE_URL || '',     // 空=用 provider 默认端点
    model: process.env.LLM_MODEL || 'deepseek-chat',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.4'),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048', 10),
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
    rateLimitPerMin: parseInt(process.env.LLM_RATE_LIMIT_PER_MIN || '20', 10),
  },
};
