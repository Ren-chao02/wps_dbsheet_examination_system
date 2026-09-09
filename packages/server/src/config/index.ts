import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret';

// ✅ 生产环境强制强密钥：默认值/占位符可被攻击者离线伪造任意角色（含 admin）的 JWT，
// 造成全系统接管。此处 fail-fast 拒绝启动，避免带病上线。
if (nodeEnv === 'production') {
  const isWeak =
    !process.env.JWT_SECRET ||
    jwtSecret.length < 16 ||
    /^(dev-secret|please-change)/i.test(jwtSecret);
  if (isWeak) {
    throw new Error(
      '[config] 生产环境必须配置强 JWT_SECRET（≥16 位随机字符，不得使用默认值或占位符），已拒绝启动'
    );
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv,
  jwt: {
    secret: jwtSecret,
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
