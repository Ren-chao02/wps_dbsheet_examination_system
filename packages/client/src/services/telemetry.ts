import * as Sentry from '@sentry/react';

/**
 * 前端错误上报
 *
 * **默认关闭**：没有配 VITE_SENTRY_DSN 时完全不初始化，不产生任何网络请求、
 * 也不增加运行时开销。校园网内网部署大概率连不上 sentry.io，那种情况下应自建
 * （如 GlitchTip）或只用后端日志 + Uptime Kuma。
 *
 * 为什么前端也需要：学生端出问题（"表格打不开""交卷按钮没反应"）时，
 * 服务端日志里往往什么都没有 —— 错误根本没发出去。这类问题目前只能靠学生描述，
 * 有了上报才能知道到底报了什么错、在哪个页面、影响了多少人。
 */

export function initClientTelemetry(): boolean {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_APP_RELEASE,
    // 默认不采样性能数据：考试期间请求量大，全量采集既费额度也可能拖慢页面。
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || 0),
    // 采集范围显式收紧：Sentry v11 默认会把用户信息/cookie/请求头/请求体/URL query
    // 全带上，而本系统里那些分别是学生身份、JWT、答案与口令。
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      urlQueryParams: false,
      httpBodies: [],
    },
    // 会话回放默认关闭：它会录制 DOM，而考试页面上有题目内容与学生答案，
    // 开启前必须确认合规性（VITE_SENTRY_REPLAY=1 显式打开）。
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });

  return true;
}
