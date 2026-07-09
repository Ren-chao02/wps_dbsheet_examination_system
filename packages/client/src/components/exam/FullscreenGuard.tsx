import { useEffect, useState, useCallback, useRef } from 'react';
import { Modal, Button } from 'antd';

interface FullscreenGuardProps {
  active: boolean;
  children?: React.ReactNode;
  onExit?: () => void;
}

/**
 * 全屏守护组件 — 考试全程持续检测全屏状态。
 *
 * 检测机制（双保险）：
 *   1. fullscreenchange 事件：退出/进入全屏时立即触发，响应快
 *   2. 轮询（每 1.5s）：兜底「requestFullscreen 静默失败」与「事件丢失」的情况
 *      —— 浏览器在 ESC 退出全屏后，若重新请求全屏被拒（如非用户手势、冷却期），
 *         fullscreenchange 不会触发，只有轮询能发现「仍未全屏」并重新弹窗。
 *
 * onExit 语义：每次「从全屏 → 非全屏」只触发一次（由 exitReportedRef 守护），
 * 重新进入全屏后守卫重置，下次退出再触发。用于上报违规。
 */
export function FullscreenGuard({ active, children, onExit }: FullscreenGuardProps) {
  const [visible, setVisible] = useState(false);
  const exitReportedRef = useRef(false);
  // 保持 onExit 最新引用，避免因回调身份变化导致 effect 反复重注册（也避免闭包陈旧）
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  const isFullscreen = useCallback(() => {
    const doc: any = document;
    return !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (!active) return;
    if (isFullscreen()) return;
    const el: any = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
      else if (el.msRequestFullscreen) await el.msRequestFullscreen();
    } catch {
      // 某些浏览器可能限制自动全屏（静默失败由轮询兜底）
    }
  }, [active, isFullscreen]);

  /**
   * 全屏状态复核 —— 事件监听器与轮询共用同一逻辑，保证判定一致。
   * - 非全屏：弹窗 + 首次退出时触发 onExit（守卫防止轮询重复上报）
   * - 已全屏：关弹窗 + 重置守卫（允许下次退出再次上报）
   */
  const checkFullscreen = useCallback(() => {
    if (!isFullscreen()) {
      setVisible(true);
      if (!exitReportedRef.current && onExitRef.current) {
        exitReportedRef.current = true;
        onExitRef.current();
      }
    } else {
      setVisible(false);
      exitReportedRef.current = false;
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (!active) return;
    enterFullscreen();
    exitReportedRef.current = false;

    // 事件：即时响应全屏切换
    document.addEventListener('fullscreenchange', checkFullscreen);
    document.addEventListener('webkitfullscreenchange', checkFullscreen);
    document.addEventListener('mozfullscreenchange', checkFullscreen);
    document.addEventListener('MSFullscreenChange', checkFullscreen);

    // 屏蔽 F11 / ESC 默认行为（ESC 无法真正阻止浏览器退出全屏，靠后续检测兜底）
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11' || e.key === 'Escape') {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // 轮询兜底：requestFullscreen 静默失败时事件不触发，
    // 用定时器周期性复核，确保考试全程持续检测全屏状态
    const pollTimer = setInterval(checkFullscreen, 1500);

    return () => {
      document.removeEventListener('fullscreenchange', checkFullscreen);
      document.removeEventListener('webkitfullscreenchange', checkFullscreen);
      document.removeEventListener('mozfullscreenchange', checkFullscreen);
      document.removeEventListener('MSFullscreenChange', checkFullscreen);
      document.removeEventListener('keydown', handleKeyDown);
      clearInterval(pollTimer);
    };
  }, [active, enterFullscreen, checkFullscreen]);

  /**
   * 重新进入全屏：不立即关闭弹窗。
   * 由 checkFullscreen 在确认真正进入全屏后（事件或轮询）关闭弹窗；
   * 若 requestFullscreen 失败，弹窗保持开启，学生仍在受保护状态，可再次点击。
   */
  const handleReenter = () => {
    enterFullscreen();
    // 短延时后立即复核一次，成功则尽快关弹窗，不必干等下一个轮询周期
    setTimeout(checkFullscreen, 300);
  };

  return (
    <>
      {children}
      <Modal
        open={visible}
        title="考试需在全屏模式下进行"
        closable={false}
        footer={null}
        centered
        maskClosable={false}
      >
        <p>检测到您已退出全屏。请点击下方按钮重新进入全屏，否则无法继续考试。</p>
        <div style={{ textAlign: 'center' }}>
          <Button type="primary" size="large" onClick={handleReenter}>
            重新进入全屏
          </Button>
        </div>
      </Modal>
    </>
  );
}

export async function enterFullscreen() {
  const el: any = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
    else if (el.msRequestFullscreen) await el.msRequestFullscreen();
  } catch {
    // ignore
  }
}

export function exitFullscreen() {
  const doc: any = document;
  try {
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
    else if (doc.msExitFullscreen) doc.msExitFullscreen();
  } catch {
    // ignore
  }
}
