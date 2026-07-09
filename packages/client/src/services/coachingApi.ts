/**
 * AI 对话式教练流式客户端 — Phase 2 §5.3
 *
 * axios 不适合 SSE，用原生 fetch + ReadableStream + 手写 SSEParser。
 * JWT 仍从 localStorage 取（与 axios interceptor 一致）。
 *
 * 事件类型：delta（文字增量）/ proposals（建议卡）/ done / error
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.3
 */
import { SSEParser } from './sse-parser';
import type { CoachingChatParams, Proposal } from '../types';

export interface CoachingHandlers {
  /** 文字增量（已剥离 proposals 块） */
  onDelta: (text: string) => void;
  /** 建议卡（已校验 + 已 ground） */
  onProposals?: (proposals: Proposal[], notes: string[]) => void;
  /** 对话结束（含 token 用量） */
  onDone?: (usage: { promptTokens: number; completionTokens: number }) => void;
  /** 错误事件 */
  onError?: (message: string) => void;
  /** 中断信号（用户点【停止】） */
  signal?: AbortSignal;
}

export interface CoachingResult {
  proposals: Proposal[];
  notes: string[];
}

export const coachingApi = {
  /**
   * 发起一轮 AI 教练对话（SSE 流式）。
   * @returns 所有 proposals 和 notes 的汇总（流结束后）
   * @throws 网络错误、非 2xx HTTP 错误、AbortError
   */
  chat: async (
    params: CoachingChatParams,
    handlers: CoachingHandlers,
  ): Promise<CoachingResult> => {
    const res = await fetch('/api/coaching/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
      },
      body: JSON.stringify(params),
      signal: handlers.signal,
    });

    // 非 SSE 响应（401/403/400/503 等）→ 解析 JSON 错误
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `请求失败 (${res.status})`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const parser = new SSEParser();
    const allProposals: Proposal[] = [];
    const allNotes: string[] = [];

    const handleEvent = (evt: { event: string; data: string }) => {
      let data: any = {};
      try {
        data = evt.data ? JSON.parse(evt.data) : {};
      } catch {
        return; // JSON 损坏，跳过
      }
      switch (evt.event) {
        case 'delta':
          if (data.text) handlers.onDelta(data.text);
          break;
        case 'proposals':
          allProposals.push(...(data.proposals || []));
          allNotes.push(...(data.notes || []));
          handlers.onProposals?.(data.proposals || [], data.notes || []);
          break;
        case 'done':
          handlers.onDone?.(data.usage || { promptTokens: 0, completionTokens: 0 });
          break;
        case 'error':
          handlers.onError?.(data.message || '未知错误');
          break;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const evt of parser.feed(chunk)) {
          handleEvent(evt);
        }
      }
      // 冲刷残余缓冲
      for (const evt of parser.finish()) {
        handleEvent(evt);
      }
    } finally {
      reader.releaseLock();
    }

    return { proposals: allProposals, notes: allNotes };
  },
};
