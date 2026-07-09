import { useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/auth';
import api from '../../services/api';

const CHECK_INTERVAL_MS = 30_000; // 每 30 秒检查一次
const REFRESH_THRESHOLD_SEC = 5 * 60; // 剩余不足 5 分钟时触发刷新
let refreshPromise: Promise<void> | null = null; // 防止并发刷新

export function WpsTokenAutoRefresher() {
  const { wpsToken, setWpsToken, clearWpsToken } = useAuthStore();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const checkAndRefresh = async () => {
      // 先检查最新的 store 状态（使用 getState 避免闭包过期）
      const token = useAuthStore.getState().wpsToken;
      if (!token?.refreshToken || !token?.expiresAt) return;

      const remainingSec = Math.floor((token.expiresAt - Date.now()) / 1000);
      if (remainingSec > REFRESH_THRESHOLD_SEC) return;

      // 防止并发刷新
      if (refreshPromise) {
        await refreshPromise;
        return;
      }

      refreshPromise = (async () => {
        try {
          const res = await api.post('/wps-token/refresh', { refreshToken: token.refreshToken });
          const expiresAt = Date.now() + res.data.expiresIn * 1000;
          const newToken = {
            accessToken: res.data.accessToken,
            refreshToken: res.data.refreshToken || token.refreshToken,
            expiresAt,
            refreshExpiresAt: res.data.refreshExpiresIn
              ? Date.now() + res.data.refreshExpiresIn * 1000
              : token.refreshExpiresAt,
          };
          useAuthStore.getState().setWpsToken(newToken);
          console.log('[WpsToken] access_token 已自动刷新', new Date().toLocaleTimeString());
        } catch (err: any) {
          const detail = err?.response?.data?.message || err.message || '';
          // refresh_token 也过期了，清空让教师重新手动填写
          if (detail.includes('refresh_token') || detail.includes('invalid_grant')) {
            console.warn('[WpsToken] refresh_token 已过期，请手动重新获取');
            useAuthStore.getState().clearWpsToken();
          } else {
            console.warn('[WpsToken] 自动刷新失败:', detail);
          }
        } finally {
          refreshPromise = null;
        }
      })();

      await refreshPromise;
    };

    // 首次立即检查
    checkAndRefresh();

    // 定时检查
    timerRef.current = setInterval(checkAndRefresh, CHECK_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 不可见组件
  return null;
}
