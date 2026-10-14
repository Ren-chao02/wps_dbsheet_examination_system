/**
 * PracticeDoing 断点续做的初始步（F5 场景的最小回归网）。
 *
 * 背景（复审实测）：F5 时 React Router 会从 window.history.state.usr 还原 location.state，
 * 所以 payload 非空、恢复 effect 被 `if (payload) return` 挡住——步骤恢复必须在 useState
 * 初始化里完成。谁把它挪回守卫内，这三条立刻红。
 *
 * 仓库没有 jsdom / @testing-library/react（组件测试基建缺失），这里用 react-dom/server
 * 渲染静态标记：useState 初始化发生在 render 阶段，足以断言「payload + 步骤记忆 → 初始第几题」。
 * useEffect 不执行，因此不会发任何网络请求（node 环境没有 localStorage，测试里显式打桩）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PracticeDoing, clampSavedStep } from '../PracticeDoing';

const recordId = 'rec-1';
const payload = {
  recordId,
  maxScore: 50,
  shareUrl: null,
  questions: Array.from({ length: 5 }, (_, i) => ({
    questionId: `q${i}`,
    sortOrder: i,
    title: `题 ${i + 1}`,
    description: '',
    type: 'comprehensive',
    difficulty: 'easy',
    score: 10,
    hints: null,
  })),
};

/** node 环境没有 localStorage：给一个 Map 版（第 3 条用抛错版模拟隐私模式） */
function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

function renderStepLine() {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={[{ pathname: `/student/practice/${recordId}`, state: payload }]}>
      <Routes>
        <Route path="/student/practice/:recordId" element={<PracticeDoing />} />
      </Routes>
    </MemoryRouter>,
  );
  // React 会在相邻文本节点间插 <!-- --> 分隔注释，去掉后才能对完整「第 3/5 题」做断言
  return html.replace(/<!--.*?-->/g, '');
}

describe('PracticeDoing 初始步（F5：payload 仍在 + 步骤记忆）', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('步骤记忆=2（第 3 题）→ 刷新后直接落在第 3 题', () => {
    localStorage.setItem(`practice_step:${recordId}`, '2');
    expect(renderStepLine()).toContain('第 3/5 题');
  });

  it('步骤记忆越界（99）→ 夹到最后一题', () => {
    localStorage.setItem(`practice_step:${recordId}`, '99');
    expect(renderStepLine()).toContain('第 5/5 题');
  });

  it('localStorage 抛错（隐私模式）→ 回落第 1 题，不炸渲染', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    });
    expect(renderStepLine()).toContain('第 1/5 题');
  });

  // 上面三条走组件级接线；这条直接钉导出函数的边界——题数为 0（题目未加载）时不得产生负下标
  it('clampSavedStep：题数为 0 → 0', () => {
    localStorage.setItem(`practice_step:${recordId}`, '3');
    expect(clampSavedStep(recordId, 0)).toBe(0);
  });
});
