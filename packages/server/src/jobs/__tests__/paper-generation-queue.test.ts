/**
 * 组卷预生成队列的 fail-safe 契约（Task 4 审查补强）：
 * 任何调度异常/超时都必须返回 `{ queued: false }`，绝不能让发布接口 500 或挂住——
 * 发布那一刻考试状态已经改成 published，调度失败只能是"发布成功 + 组卷欠账"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfigState, mockQueueAdd, mockQueueRemove } = vi.hoisted(() => ({
  mockConfigState: { redisUrl: 'redis://127.0.0.1:6379' },
  mockQueueAdd: vi.fn(),
  mockQueueRemove: vi.fn(),
}));

// config 的 redis.url 每个用例可切换（非法 URL → 不创建队列）；logger 替换掉避免 pino 副作用
vi.mock('../../config', () => ({
  config: {
    get redis() {
      return { url: mockConfigState.redisUrl };
    },
  },
}));
vi.mock('../../utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('bullmq', () => ({
  Queue: class {
    add = mockQueueAdd;
    remove = mockQueueRemove;
  },
  Worker: class {},
}));

/** 模块内的队列是单例，resetModules 后重新 import 才能让两种 URL 场景互不串味 */
async function loadQueue(redisUrl: string) {
  mockConfigState.redisUrl = redisUrl;
  vi.resetModules();
  return import('../paper-generation-queue');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enqueuePaperGeneration 降级契约', () => {
  it('Redis URL 不可解析 → queued:false（不建队列、不抛错）', async () => {
    const { enqueuePaperGeneration } = await loadQueue('not-a-url');
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: false });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('queue.add 抛错（Redis 宕机等）→ queued:false，而不是把异常抛给发布路由', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    mockQueueAdd.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: false });
  });

  it('queue.add 永不 settle（Redis 假死）→ 3s 超时后 queued:false', async () => {
    vi.useFakeTimers();
    try {
      const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
      mockQueueAdd.mockReturnValue(new Promise(() => {})); // 模拟 ioredis 无限重连、add 挂住
      const pending = enqueuePaperGeneration('e-1');
      await vi.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toEqual({ queued: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('正常入队 → queued:true，且带同考试去重的 jobId', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    mockQueueRemove.mockResolvedValue(1);   // 1 = 旧 job 已移除，可复用原 jobId
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: true });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'generate',
      { examId: 'e-1' },
      expect.objectContaining({ jobId: 'paper-generation-e-1' }),
    );
  });

  it('重复入队先移除旧 jobId，避免 BullMQ 静默去重（"返回成功但没有任务在跑"）', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    mockQueueRemove.mockResolvedValue(1);
    mockQueueAdd.mockResolvedValue({ id: 'job-2' });
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: true });
    expect(mockQueueRemove).toHaveBeenCalledWith('paper-generation-e-1');
    expect(mockQueueRemove.mock.invocationCallOrder[0])
      .toBeLessThan(mockQueueAdd.mock.invocationCallOrder[0]);
  });

  it('旧 job 正在运行（remove 返回 0）→ 用带 UUID 的后继 jobId', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    // BullMQ 5.x 真实契约：removeJob 发现 job 被 locked 时返回 0，不抛错
    mockQueueRemove.mockResolvedValue(0);
    mockQueueAdd.mockResolvedValue({ id: 'job-3' });
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: true });
    const jobId = mockQueueAdd.mock.calls[0][2].jobId as string;
    expect(jobId).toMatch(/^paper-generation-e-1-[0-9a-f-]{36}$/);
  });

  it('remove 抛错（Redis/客户端异常）→ 同样用后继 jobId，避免撞上残留 job', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    mockQueueRemove.mockRejectedValue(new Error('redis down'));
    mockQueueAdd.mockResolvedValue({ id: 'job-4' });
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: true });
    const jobId = mockQueueAdd.mock.calls[0][2].jobId as string;
    expect(jobId.startsWith('paper-generation-e-1-')).toBe(true);
  });

  it('remove 未 settle 前不会 add（防止 fire-and-forget 去重竞态）', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    let resolveRemove!: (v: unknown) => void;
    mockQueueRemove.mockReturnValue(new Promise((resolve) => { resolveRemove = resolve; }));
    mockQueueAdd.mockResolvedValue({ id: 'job-4' });
    const pending = enqueuePaperGeneration('e-1');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockQueueAdd).not.toHaveBeenCalled();
    resolveRemove(1);
    await expect(pending).resolves.toEqual({ queued: true });
    expect(mockQueueAdd).toHaveBeenCalled();
  });

  it('remove 永不 settle（Redis 假死）→ 同样受 3s 超时保护', async () => {
    vi.useFakeTimers();
    try {
      const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
      mockQueueRemove.mockReturnValue(new Promise(() => {}));
      const pending = enqueuePaperGeneration('e-1');
      await vi.advanceTimersByTimeAsync(3000);
      await expect(pending).resolves.toEqual({ queued: false });
      expect(mockQueueAdd).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
