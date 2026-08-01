/**
 * Socket.IO 连接 URL 解析
 *
 * 始终使用 window.location.origin，配合 Vite 代理（dev）或 Nginx/Express 反代（prod），
 * 保证无论本地、内网穿透域名还是生产域名，WebSocket 都能连到正确的后端。
 */
export function getSocketURL(): string {
  return window.location.origin;
}
