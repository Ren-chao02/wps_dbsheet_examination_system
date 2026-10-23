/**
 * 组卷预生成队列的 fail-safe 契约（Task 4 审查补强）：
 * 任何调度异常/超时都必须返回 `{ queued: false }`，绝不能让发布接口 500 或挂住——
 * 发布那一刻考试状态已经改成 published，调度失败只能是"发布成功 + 组卷欠账"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConfigState, mockQueueAdd } = vi.hoisted(() => ({
  mockConfigState: { redisUrl: 'redis://127.0.0.1:6379' },
  mockQueueAdd: vi.fn(),
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
  },
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

  it('正常入队 → queued:true，且带同考试去重的 jobId', async () => {
    const { enqueuePaperGeneration } = await loadQueue('redis://127.0.0.1:6379');
    mockQueueAdd.mockResolvedValue({ id: 'job-1' });
    await expect(enqueuePaperGeneration('e-1')).resolves.toEqual({ queued: true });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'generate',
      { examId: 'e-1' },
      expect.objectContaining({ jobId: 'paper-generation-e-1' }),
    );
  });
});
