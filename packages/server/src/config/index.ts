import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
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
    apiBaseUrl: process.env.KINGSOFT_API_BASE_URL || 'https://openapi.wps.cn/v7/coop/dbsheet',
    apiVersion: (process.env.KINGSOFT_API_VERSION || 'v7') as 'v3' | 'v7',
    apiKey: process.env.KINGSOFT_API_KEY || '',
    apiSecret: process.env.KINGSOFT_API_SECRET || '',
  },
};
