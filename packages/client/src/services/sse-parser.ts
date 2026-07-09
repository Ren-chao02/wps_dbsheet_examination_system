/**
 * SSE 流式解析器 — Phase 2 §5.3
 *
 * 从 fetch ReadableStream 逐 chunk 喂入，解析出完整 SSE 事件。
 * 不引新依赖，~40 行手写实现。
 *
 * SSE 协议：事件以空行（\n\n）分隔；事件内每行 `field: value`。
 * 多行 data: 按 SSE 规范用 \n 拼接。以 `:` 开头的行是注释，忽略。
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.3
 */

export interface SSEEvent {
  event: string;
  data: string;
}

export class SSEParser {
  private buffer = '';

  /** 喂入一个 chunk，返回此 chunk 中解析出的完整事件 */
  feed(chunk: string): SSEEvent[] {
    this.buffer += chunk;
    const events: SSEEvent[] = [];

    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const evt = this.parseBlock(block);
      if (evt) events.push(evt);
    }

    return events;
  }

  /** 流结束时冲刷残余缓冲（可能含未以 \n\n 结尾的最后一个事件） */
  finish(): SSEEvent[] {
    if (!this.buffer.trim()) {
      this.buffer = '';
      return [];
    }
    const evt = this.parseBlock(this.buffer);
    this.buffer = '';
    return evt ? [evt] : [];
  }

  /** 解析单个 SSE 块（不含尾部的 \n\n） */
  private parseBlock(block: string): SSEEvent | null {
    let event = '';
    const dataLines: string[] = [];

    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith(':')) continue; // 注释行
      if (line.startsWith('event: ')) {
        event = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      } else if (line === 'data:') {
        dataLines.push('');
      }
    }

    if (!event) return null;
    return { event, data: dataLines.join('\n') };
  }
}
