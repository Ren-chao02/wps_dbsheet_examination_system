import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * 错误上报（Sentry）
 *
 * **默认关闭**：没有配 SENTRY_DSN 时什么都不做，不产生任何网络请求。
 * 校园网内网部署很可能根本连不上 sentry.io —— 那种情况下应当自建（如 GlitchTip），
 * 或者干脆只用结构化日志 + Uptime Kuma。功能开着但一直超时重试，比不装更糟。
 */

let initialized = false;

/**
 * 采集范围（默认值比想象中宽松，必须显式收紧）
 *
 * Sentry v11 的默认值是：userInfo / cookies / 请求头 / 请求体 / URL query 全开。
 * 这是给通用 Web 应用定的；而本系统里请求体装的是**学生答案与登录密码**，
 * 请求头装的是 **JWT**，URL 里可能有考试 ID 与学生 ID。
 * 这些一旦发到第三方（哪怕是自建的），都属于「不必要且不该有」的数据。
 *
 * 需要排查具体请求时再按需放开单项（比如只开 httpHeaders 的 response），
 * 但不要图省事整个打开。
 */
const RESTRICTIVE_DATA_COLLECTION = {
  userInfo: false,        // 不自动填充 user.*（学生身份）
  cookies: false,
  httpHeaders: false,     // 请求头里有 Authorization: Bearer <JWT>
  urlQueryParams: false,
  httpBodies: [] as [],   // 请求体里有答案与口令
};

/** 在 listen 成功之后调用（与定时任务同理：服务没起来就别去连外部服务） */
export function initTelemetry(): boolean {
  const dsn = (process.env.SENTRY_DSN || '').trim();
  if (!dsn) {
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: process.env.APP_RELEASE,
    // 默认不采样性能数据：考试期间请求量大，全量采集既费额度又拖慢响应。
    // 需要时用 SENTRY_TRACES_SAMPLE_RATE（0~1）显式打开。
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    dataCollection: RESTRICTIVE_DATA_COLLECTION,
  });

  initialized = true;
  logger.info(
    { environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV },
    'Sentry 错误上报已启用（已关闭用户信息/请求头/请求体等采集）',
  );
  return true;
}

/**
 * 注册 Express 错误中间件。
 * 注意 v11 的签名是 setupExpressErrorHandler(app) —— 它自己往 app 上挂，
 * 而不是返回一个中间件让你去 app.use()（旧版本是后者）。
 * 必须挂在所有路由之后、业务 errorHandler 之前。
 */
export function setupSentryErrorHandler(app: { use: (middleware: unknown) => unknown }): void {
  if (!initialized) return;
  Sentry.setupExpressErrorHandler(app);
}
