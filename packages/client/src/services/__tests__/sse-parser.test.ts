/**
 * SSE 流式解析器测试 — Phase 2 §5.3
 *
 * SSEParser 是 coachingApi 的核心：从 fetch ReadableStream 逐 chunk 喂入，
 * 解析出完整 SSE 事件（event + data）。不依赖 DOM，纯字符串处理。
 *
 * @see docs/superpowers/specs/2026-07-08-phase2-ai-coaching-design.md §5.3
 */
import { describe, it, expect } from 'vitest';
import { SSEParser } from '../sse-parser';

describe('SSEParser', () => {
  it('单个完整事件一次喂入', () => {
    const parser = new SSEParser();
    const events = parser.feed('event: delta\ndata: {"text":"你好"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('delta');
    expect(events[0].data).toBe('{"text":"你好"}');
  });

  it('事件跨 chunk 分割：先喂前半，无事件返回；再喂后半，解析出完整事件', () => {
    const parser = new SSEParser();
    const part1 = parser.feed('event: delta\ndata: {"text":"你');
    expect(part1).toHaveLength(0);

    const part2 = parser.feed('好"}\n\n');
    expect(part2).toHaveLength(1);
    expect(part2[0].event).toBe('delta');
    expect(part2[0].data).toBe('{"text":"你好"}');
  });

  it('一个 chunk 含多个完整事件', () => {
    const parser = new SSEParser();
    const chunk =
      'event: delta\ndata: {"text":"A"}\n\n' +
      'event: delta\ndata: {"text":"B"}\n\n' +
      'event: done\ndata: {"usage":{"promptTokens":10}}\n\n';
    const events = parser.feed(chunk);
    expect(events).toHaveLength(3);
    expect(events[0].event).toBe('delta');
    expect(events[0].data).toBe('{"text":"A"}');
    expect(events[1].event).toBe('delta');
    expect(events[1].data).toBe('{"text":"B"}');
    expect(events[2].event).toBe('done');
    expect(events[2].data).toBe('{"usage":{"promptTokens":10}}');
  });

  it('finish() 冲刷残余缓冲中未以 \\n\\n 结尾的事件', () => {
    const parser = new SSEParser();
    parser.feed('event: delta\ndata: {"text":"尾部"}\n\n');
    parser.feed('event: proposals\ndata: {"proposals":[]}');
    // 残余缓冲有内容但无 \n\n，feed 不返回
    const flushed = parser.finish();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].event).toBe('proposals');
    expect(flushed[0].data).toBe('{"proposals":[]}');
  });

  it('finish() 空缓冲返回空数组', () => {
    const parser = new SSEParser();
    parser.feed('event: done\ndata: {}\n\n');
    const flushed = parser.finish();
    expect(flushed).toHaveLength(0);
  });

  it('多行 data: 字段按 SSE 规范拼接为换行分隔', () => {
    const parser = new SSEParser();
    const events = parser.feed(
      'event: delta\ndata: line1\ndata: line2\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('line1\nline2');
  });

  it('无 event 字段的块被忽略（非标准 SSE 事件）', () => {
    const parser = new SSEParser();
    const events = parser.feed(': comment line\n\nevent: delta\ndata: {"text":"hi"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('delta');
  });

  it('连续多次 feed 累积直到 \\n\\n 才产出事件', () => {
    const parser = new SSEParser();
    expect(parser.feed('event: er')).toHaveLength(0);
    expect(parser.feed('ror\ndata: ')).toHaveLength(0);
    expect(parser.feed('{"message":"fail"}')).toHaveLength(0);
    const events = parser.feed('\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data).toBe('{"message":"fail"}');
  });

  it('空 chunk 不影响解析', () => {
    const parser = new SSEParser();
    expect(parser.feed('')).toHaveLength(0);
    const events = parser.feed('event: delta\ndata: {"text":"x"}\n\n');
    expect(events).toHaveLength(1);
  });
});
