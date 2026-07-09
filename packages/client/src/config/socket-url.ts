/**
 * Socket.IO 连接 URL 解析
 *
 * 开发环境：直连后端 localhost:3002，绕过 Vite WS 代理避免 EPIPE 错误
 * 生产环境：使用 window.location.origin（Nginx 统一代理）
 */
export function getSocketURL(): string {
  if (import.meta.env.DEV) {
    return 'http://localhost:3002';
  }
  return window.location.origin;
}
