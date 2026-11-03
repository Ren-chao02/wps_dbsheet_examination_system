import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readDraft,
  writeDraft,
  clearDraft,
  EXAM_CONFIG_WIZARD_DRAFT_KEY,
  examTableLinksDraftKey,
} from '../wizard-draft';

// vitest 跑在 node 环境，没有 window.localStorage，用一个最小内存实现顶上
function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  } as Storage;
}

describe('wizard-draft', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('写入后能原样读回', () => {
    writeDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY, { examId: 'e-1', title: '10.14的测试', step: 4 });
    expect(readDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY)).toEqual({ examId: 'e-1', title: '10.14的测试', step: 4 });
  });

  it('没有草稿时返回 null', () => {
    expect(readDraft('not-exist')).toBeNull();
  });

  it('超过 24 小时的草稿视为过期，返回 null 并清掉', () => {
    const key = EXAM_CONFIG_WIZARD_DRAFT_KEY;
    localStorage.setItem(
      key,
      JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, data: { examId: 'old' } }),
    );
    expect(readDraft(key)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('损坏的 JSON / 异常形状返回 null 且不抛异常', () => {
    localStorage.setItem(EXAM_CONFIG_WIZARD_DRAFT_KEY, '{broken');
    expect(readDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY)).toBeNull();
    localStorage.setItem(EXAM_CONFIG_WIZARD_DRAFT_KEY, JSON.stringify({ data: { x: 1 } })); // 缺 savedAt
    expect(readDraft(EXAM_CONFIG_WIZARD_DRAFT_KEY)).toBeNull();
  });

  it('clearDraft 后读不到', () => {
    writeDraft('k', { a: 1 });
    clearDraft('k');
    expect(readDraft('k')).toBeNull();
  });

  it('链接草稿按考试隔离', () => {
    writeDraft(examTableLinksDraftKey('exam-A'), { 'stu-1': 'https://www.kdocs.cn/l/a' });
    writeDraft(examTableLinksDraftKey('exam-B'), { 'stu-2': 'https://www.kdocs.cn/l/b' });
    expect(readDraft(examTableLinksDraftKey('exam-A'))).toEqual({ 'stu-1': 'https://www.kdocs.cn/l/a' });
    expect(readDraft(examTableLinksDraftKey('exam-B'))).toEqual({ 'stu-2': 'https://www.kdocs.cn/l/b' });
  });

  it('localStorage 不可用（隐私模式）时静默降级', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => writeDraft('k', { a: 1 })).not.toThrow();
    expect(readDraft('k')).toBeNull();
    expect(() => clearDraft('k')).not.toThrow();
  });
});
