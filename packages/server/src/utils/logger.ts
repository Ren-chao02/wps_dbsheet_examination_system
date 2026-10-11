import pino from 'pino';
import { config } from '../config';

/**
 * 结构化日志
 *
 * 为什么需要它：现在全库是 console.log，生产上出了事（学生说"表格打不开"、
 * 教师说"监考页看不到人"）只能靠翻容器 stdout 里混在一起的中文文本，既没法按
 * 请求串起来，也没法按级别过滤。
 *
 * 开发环境走 pino-pretty 上色（一行 JSON 没法读），生产环境输出单行 JSON：
 * 可以直接 grep、可以交给任何日志采集，`docker logs` 也是这个形态。
 */

// 用 config.nodeEnv 而不是直接读 process.env：config 模块内部会执行
// dotenv.config()，而 import 的求值顺序保证了它先跑。直接读 process.env 的话，
// NODE_ENV 是否已经加载取决于**谁先 import**，会出现"换一个 import 顺序，
// 日志格式就悄悄变了"这种极难排查的差异。
const isProduction = config.nodeEnv === 'production';

/**
 * 绝不写进日志的字段。
 *
 * 这在本项目不是假想风险：多维表格的 tableSpaceId 形如 `fileId:accessToken`，
 * 而调试脚本已经真的把一整条可用 token 打印到过终端。所以这里把凭据类字段
 * 一律脱敏——宁可少记信息，也不能让日志变成泄漏源。
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'oldPassword',
  '*.oldPassword',
  'newPassword',
  '*.newPassword',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'apiSecret',
  '*.apiSecret',
  'captchaText',
  '*.captchaText',
  // `fileId:accessToken` 那种拼接形态，整串都不能留
  'tableSpaceId',
  '*.tableSpaceId',
  'token',
  '*.token',
];

/** pino-pretty 只装在 devDependencies：生产镜像里没有，装不到就退回 JSON，不能因此起不来 */
function prettyTransport() {
  if (isProduction) return undefined;
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,service',
        singleLine: false,
      },
    };
  } catch {
    return undefined;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  base: { service: 'exam-server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  // 输出 "level":"info" 而不是数字 30，方便人肉 grep
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT_PATHS, censor: '[已脱敏]' },
  ...(prettyTransport() ? { transport: prettyTransport()! } : {}),
});

/** 请求日志用的精简序列化：只留方法/路径/状态码 */
export const httpSerializers = {
  // 不记 headers 与 query string：前者含凭据，后者可能带 token，且两者对排障
  // 几乎没有增量信息——真正要看的是"哪个接口、多慢、返回什么状态"。
  req: (req: { method: string; url?: string }) => ({
    method: req.method,
    path: (req.url || '').split('?')[0],
  }),
  res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
};
