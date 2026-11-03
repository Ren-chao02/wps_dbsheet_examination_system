/**
 * 「创建考试」弹窗向导的本地草稿（localStorage）。
 *
 * 为什么需要：向导的进度（当前步骤、第 1 步创建的考试 ID、第 5 步粘贴的表格链接）
 * 只活在 React 内存里——dev 环境里 Vite 会因代码改动整页重载，老师中途切去 WPS
 * 复制链接时页面一旦被刷新，回到「最后一步」就没有任何出路。落一份最小进度供恢复。
 *
 * 过期口径与 ExamWizard 的草稿一致：24 小时。
 */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** 「创建考试」弹窗向导：已创建但未配置完的那场考试 */
export const EXAM_CONFIG_WIZARD_DRAFT_KEY = 'exam-config-wizard-draft';

/** 「WPS 表格分配」步骤：已粘贴但尚未保存成功的分享链接（按考试隔离） */
export const examTableLinksDraftKey = (examId: string) => `exam-table-links-draft:${examId}`;

interface DraftEnvelope<T> {
  savedAt: number;
  data: T;
}

function storage(): Storage | null {
  try {
    // 隐私模式 / node（vitest 跑在 node 环境）下可能不存在
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 读取未过期的草稿；不存在、损坏、过期一律返回 null（过期项顺手清掉） */
export function readDraft<T>(key: string): T | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'number' || parsed.data === undefined) {
      return null;
    }
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      store.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, data: T): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // 配额满 / 隐私模式：草稿是尽力而为，失败不影响主流程
  }
}

export function clearDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    // 同上：失败不影响主流程
  }
}
