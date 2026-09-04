/**
 * WPS 多维表格 iframe 嵌入辅助 hook（练习页 / 考试页共用）
 *
 * 解决的问题：
 * 1. 加载遮罩 / 超时兜底 / 加载失败提示的状态管理；
 * 2. 「重新加载表格」：登录态需要 iframe 重新加载才会生效；
 * 3. 学生点「在新标签页打开」去 WPS 登录（或直接操作）后切回本页时，
 *    自动刷新一次 iframe —— WPS 登录成功写的是 kdocs 域 Cookie，
 *    已打开的 iframe 不会自动感知，刷新后即可读取登录态。
 *
 * 注意：若浏览器启用了第三方 Cookie 拦截，内嵌 iframe 仍可能一直提示登录，
 * 此时应引导学生在「新标签页」顶层打开操作（本 hook 不负责判分，判分读取的是
 * 表格数据本身，与学生在哪个页面操作无关）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useWpsEmbed(url: string | null, timeoutMs = 12000) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const openedAtRef = useRef(0);

  // url 变化 / 手动刷新 → 重置状态并重新起超时计时
  useEffect(() => {
    setLoaded(false);
    setError(false);
    setTimedOut(false);
    if (!url) return;
    const t = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(t);
  }, [url, timeoutMs, reloadKey]);

  /** 手动/自动刷新：通过 key 强制 iframe 重新挂载 */
  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  /** 在新标签页打开（WPS 登录 / 直接操作），并记录时间用于返回时自动刷新 */
  const openInNewTab = useCallback(() => {
    if (!url) return;
    window.open(url, '_blank');
    openedAtRef.current = Date.now();
  }, [url]);

  // 切回本页自动刷新一次：仅当最近(2分钟内)确实通过 openInNewTab 打开过 WPS 才触发
  useEffect(() => {
    const onFocus = () => {
      const gap = Date.now() - openedAtRef.current;
      if (openedAtRef.current !== 0 && gap > 800 && gap < 120000) {
        openedAtRef.current = 0;
        reload();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const showSpinner = !!url && !loaded && !error && !timedOut;
  // 超时或加载失败且仍未成功加载：展示逃生提示
  const showFallback = (timedOut || error) && !loaded;

  return {
    reloadKey,
    iframeLoaded: loaded,
    iframeError: error,
    iframeTimeout: timedOut,
    showSpinner,
    showFallback,
    reload,
    openInNewTab,
    handleIframeLoad: () => setLoaded(true),
    handleIframeError: () => setError(true),
  };
}
