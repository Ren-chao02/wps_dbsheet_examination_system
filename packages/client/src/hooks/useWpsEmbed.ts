/**
 * WPS 多维表格嵌入辅助 hook（练习页 / 考试页共用）
 *
 * 解决的问题：
 * 1. 加载遮罩 / 超时兜底 / 加载失败提示的状态管理；
 * 2. 「重新加载表格」：登录态需要 iframe 重新加载才会生效；
 * 3. 学生去 WPS 登录（或直接操作）后切回本页时，自动刷新一次 iframe ——
 *    WPS 登录成功写的是 kdocs 域 Cookie，已打开的 iframe 不会自动感知。
 *
 * ⚠️ 为什么还需要「工作台模式」：
 *    实测同一批分配表里，有的匿名就能在 iframe 里渲染，有的直接跳 WPS 登录页
 *    （取决于该文档的分享权限）；且 iframe 属第三方上下文，即使学生已登录 WPS，
 *    登录态能否带进框内还取决于浏览器三方 Cookie 策略。内嵌因此天然可能失败，
 *    表现为框内显示 WPS 登录页或「文档已删除」。所以提供第二种展示方式：
 *    用命名窗口在顶层打开表格（window.open，第一方上下文），登录与操作全部正常，
 *    并把学生的选择记忆到 localStorage，下次进场不再重复踩坑。
 *
 * 注意：本 hook 不负责判分 —— 判分读取的是表格数据本身，与学生在哪个页面操作无关。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type WpsPanelMode = 'embed' | 'workbench';

interface UseWpsEmbedOptions {
  timeoutMs?: number;
  /** 记忆键（一般传 exam id / 'practice'）：用于持久化展示方式偏好与命名窗口 */
  storageKey?: string;
  /**
   * 工作台豁免状态回调：调用方据此豁免切屏计数、挂起全屏守护。
   * 注意语义已收紧：不是「窗口开着就回调 true」，而是「学生确实正在表格窗口里
   * （窗口存活 + 本页失焦 + 本页不可见）才回调 true」，条件不满足立即回调 false
   * （含学生切回本页、窗口被最小化后焦点交还本页等），详见下方轮询 effect 注释。
   */
  onWorkbenchChange?: (exempt: boolean) => void;
}

const modeStorageKey = (key: string) => `wps_panel_mode:${key}`;

function readStoredMode(key: string): WpsPanelMode {
  try {
    return localStorage.getItem(modeStorageKey(key)) === 'workbench' ? 'workbench' : 'embed';
  } catch {
    return 'embed';
  }
}

export function useWpsEmbed(url: string | null, options: UseWpsEmbedOptions = {}) {
  const { timeoutMs = 12000, storageKey = 'default', onWorkbenchChange } = options;

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const openedAtRef = useRef(0);

  // ── 展示方式（嵌入 / 独立窗口工作台）──
  const [mode, setModeState] = useState<WpsPanelMode>(() => readStoredMode(storageKey));
  const setMode = useCallback(
    (next: WpsPanelMode) => {
      setModeState(next);
      try {
        localStorage.setItem(modeStorageKey(storageKey), next);
      } catch {
        /* 隐私模式下写入失败：仅本次会话生效 */
      }
    },
    [storageKey],
  );

  // storageKey 变化（切换考试）时重新读取偏好
  useEffect(() => {
    setModeState(readStoredMode(storageKey));
  }, [storageKey]);

  // ── 工作台窗口 ──
  const windowRef = useRef<Window | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  // 回调放进 ref：打开窗口时需同步通知外部（切屏豁免必须在页面失焦前生效）
  const onWorkbenchChangeRef = useRef(onWorkbenchChange);
  useEffect(() => {
    onWorkbenchChangeRef.current = onWorkbenchChange;
  }, [onWorkbenchChange]);

  const windowName = `wps-table-${storageKey}`;

  const openWorkbench = useCallback(() => {
    if (!url) return;
    // 先同步放行切屏判定，再打开窗口（新窗口抢焦点会立刻触发 visibilitychange，
    // 豁免必须在 window.open 之前生效）。这里的放行是「预授权」：窗口真正拿到
    // 焦点后，下方的轮询会按豁免充要条件复核；若窗口没打开（被拦截）或一直
    // 没拿到焦点，1 秒内会被撤销。
    onWorkbenchChangeRef.current?.(true);
    const win = window.open(url, windowName, 'popup=yes,width=1440,height=900');
    if (!win) {
      // 弹窗被拦截：撤销放行，交由 UI 提示学生允许弹窗后重试
      setPopupBlocked(true);
      onWorkbenchChangeRef.current?.(false);
      return;
    }
    setPopupBlocked(false);
    windowRef.current = win;
    try {
      win.opener = null; // 防止被打开页面通过 opener 反向导航本页
    } catch {
      /* 跨域下个别浏览器不允许赋值，忽略 */
    }
    setWorkbenchOpen(true);
    openedAtRef.current = Date.now(); // 返回本页时自动刷新一次内嵌表格
  }, [url, windowName]);

  /** 把已打开的表格窗口切到前台（窗口被最小化/被其它窗口挡住时用） */
  const focusWorkbench = useCallback(() => {
    const win = windowRef.current;
    if (win && !win.closed) {
      // 与打开同理：先预授权再聚焦 —— 本页即将失焦/隐藏，必须赶在
      // visibilitychange 之前把豁免置回 true，否则这次合法切换会被计一次违规
      onWorkbenchChangeRef.current?.(true);
      win.focus();
      return;
    }
    openWorkbench();
  }, [openWorkbench]);

  // ── 工作台豁免的充要条件（防作弊收紧）────────────────────────
  // 背景：此前「窗口开着即豁免」有洞 —— 学生把表格窗口最小化挂着，就能一边
  // 豁免切屏计数、一边豁免全屏守护，全程切出去查资料。
  // 因此豁免只在「学生确实正在表格窗口里」时成立，每秒轮询复核，任一条件
  // 不满足立刻撤销（宁可少豁免，不可放大洞）：
  //
  //   豁免成立 ⟺ ① 表格窗口存在且未关闭
  //             ② 本页未持有焦点（document.hasFocus() === false → 学生在别的窗口）
  //             ③ 本页不可见（document.hidden === true → 学生没有在看本页）
  //
  // 判断依据：
  //   - 学生切回本页 → hasFocus() 变 true / hidden 变 false，监听 focus 与
  //     visibilitychange 即时撤销豁免（不等轮询），全屏守护与切屏计数随即恢复；
  //   - 学生把表格窗口最小化 → 多数系统会把焦点交还考试页（本页重新获得焦点），
  //     豁免随之撤销，之后切去其它应用就会被正常计数；
  // 残余风险（浏览器 API 无法消除，已取保守侧）：
  //   - 个别桌面环境最小化窗口后焦点不归还任何窗口：此时本页 hidden + 无焦点 +
  //     窗口存在，与「学生正在表格窗口」无法区分，仍会被豁免 —— 只能靠服务端
  //     行为留痕与监考人工兜底；
  //   - 双显示器：本页在另一块屏上始终可见（hidden === false），豁免不成立，
  //     使用工作台会触发全屏提示（可用「无法全屏，继续考试（会记录）」继续）。
  useEffect(() => {
    if (!workbenchOpen) return;
    const evaluateExemption = () => {
      const win = windowRef.current;
      const winOpen = !!win && !win.closed;
      if (!winOpen) {
        // 窗口被学生关闭：结束工作台态并撤销豁免
        setWorkbenchOpen(false);
        onWorkbenchChangeRef.current?.(false);
        return;
      }
      const exempt = !document.hasFocus() && document.hidden;
      onWorkbenchChangeRef.current?.(exempt);
    };
    const timer = setInterval(evaluateExemption, 1000);
    // 学生切回本页的两种信号：焦点回到本页 / 本页重新可见 —— 立刻撤销豁免，
    // 不等 1 秒轮询，避免这一秒内的切屏漏计
    const revoke = () => onWorkbenchChangeRef.current?.(false);
    const onVisibility = () => {
      if (!document.hidden) revoke();
    };
    window.addEventListener('focus', revoke);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', revoke);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [workbenchOpen]);

  // 卸载时只停止跟踪，不关闭窗口：学生可能仍在表格里作答
  useEffect(() => () => { windowRef.current = null; }, []);

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

  // 切回本页自动刷新一次：仅当最近(2分钟内)确实打开过 WPS 才触发
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
    handleIframeLoad: () => setLoaded(true),
    handleIframeError: () => setError(true),
    // 展示方式与工作台窗口
    mode,
    setMode,
    openWorkbench,
    focusWorkbench,
    workbenchOpen,
    popupBlocked,
  };
}
