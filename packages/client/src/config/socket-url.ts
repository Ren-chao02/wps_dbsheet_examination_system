/**
 * Socket.IO 连接 URL 解析
 *
 * 始终使用 window.location.origin，配合 Vite 代理（dev）或 Nginx/Express 反代（prod），
 * 保证无论本地、内网穿透域名还是生产域名，WebSocket 都能连到正确的后端。
 */
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/auth';

export function getSocketURL(): string {
  return window.location.origin;
}

/**
 * 创建带 JWT 鉴权的 Socket.IO 连接。
 *
 * 服务端握手中间件会校验 auth.token，未携带有效令牌的连接会被拒绝
 * （防止任意客户端订阅考场监控、伪造学生心跳/交卷事件）。
 * 必须在已登录状态下调用（页面均在 PrivateRoute 之后）。
 */
export function createAuthedSocket(options: Parameters<typeof io>[1] = {}): Socket {
  const token = useAuthStore.getState().token || localStorage.getItem('token') || '';
  return io(getSocketURL(), {
    ...options,
    auth: { token },
  });
}
