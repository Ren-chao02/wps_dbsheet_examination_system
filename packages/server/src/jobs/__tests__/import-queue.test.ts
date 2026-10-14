/**
 * import-queue fail-closed 回归测试（P2 Task 11）：
 * 任务行缺失 / 创建者取不到时，绝不再用空 userId 继续调 processImport ——
 * processImport 里 `if (userId)` 会静默跳过教师范围校验（导入行可落到任意班级）。
 * 期望行为：任务行存在则标记 FAILED 并结束，行不存在则记日志结束。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, mockProcessImport, mockConfigState, mockQueueAdd, captured } = vi.hoisted(() => ({
  mockPrisma: {
    importTask: { findUnique: vi.fn(), update: vi.fn() },
  } as any,
  mockProcessImport: vi.fn(),
  mockConfigState: { redisUrl: 'redis://127.0.0.1:6379' },
  mockQueueAdd: vi.fn(),
  captured: { processors: [] as Array<(job: { data: any }) => Promise<any>> },
}));

vi.mock('../../config/prisma', () => ({ prisma: mockPrisma }));
// students.ts 依赖 multer/exceljs 等重模块；本测试只关心 processImport 是否被调用
vi.mock('../../routes/students', () => ({ processImport: mockProcessImport }));
vi.mock('../../config', () => ({
  config: {
    get redis() {
      return { url: mockConfigState.redisUrl };
    },
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    add = mockQueueAdd;
  },
  Worker: class {
    constructor(_name: string, processor: (job: { data: any }) => Promise<any>) {
      captured.processors.push(processor);
    }
    on() {
      return this;
    }
  },
  Job: class {},
}));

/**
 * 每个用例重新加载模块：模块内的队列是单例，且同步/队列模式取决于 config.redis.url，
 * resetModules 后重新 import 才能让两种模式互不串味。
 */
async function loadImportQueue(redisUrl: string) {
  mockConfigState.redisUrl = redisUrl;
  vi.resetModules();
  return import('../import-queue');
}

const FILE_PATH = '/tmp/not-exist-import.xlsx';

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.importTask.update.mockResolvedValue({});
  mockQueueAdd.mockResolvedValue({ id: 'job-1' });
});

describe('enqueueImport fail-closed', () => {
  it('同步模式：任务行不存在 → 不调 processImport（不再传空 userId）', async () => {
    const { enqueueImport } = await loadImportQueue('not-a-url'); // URL 解析失败 → 同步降级
    mockPrisma.importTask.findUnique.mockResolvedValue(null);

    const result = await enqueueImport('t-missing', FILE_PATH);

    expect(mockProcessImport).not.toHaveBeenCalled();
    expect(result).toEqual({ syncResult: { totalRows: 0, successRows: 0, failedRows: 0, errorFile: null } });
  });

  it('队列模式：任务行不存在 → 拒绝入队（不把空 userId 塞进 job）', async () => {
    const { enqueueImport } = await loadImportQueue('redis://127.0.0.1:6379');
    mockPrisma.importTask.findUnique.mockResolvedValue(null);

    await expect(enqueueImport('t-missing', FILE_PATH)).rejects.toThrow(/导入任务不存在/);

    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('队列模式：创建者取不到 → 任务标记 FAILED 且不入队', async () => {
    const { enqueueImport } = await loadImportQueue('redis://127.0.0.1:6379');
    mockPrisma.importTask.findUnique.mockResolvedValue({ id: 't-1', createdBy: '' });

    await expect(enqueueImport('t-1', FILE_PATH)).rejects.toThrow();

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockPrisma.importTask.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('队列模式：正常任务照常入队（userId 来自任务创建者）', async () => {
    const { enqueueImport } = await loadImportQueue('redis://127.0.0.1:6379');
    mockPrisma.importTask.findUnique.mockResolvedValue({ id: 't-1', createdBy: 'teacher-1' });

    const result = await enqueueImport('t-1', FILE_PATH);

    expect(result).toEqual({ jobId: 'job-1' });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'import',
      { taskId: 't-1', filePath: FILE_PATH, userId: 'teacher-1' },
      expect.any(Object),
    );
  });
});

describe('Worker fail-closed', () => {
  it('job 里 userId 为空 → 任务标记 FAILED、不调 processImport，且该 job 以失败结束', async () => {
    const { startImportWorkers } = await loadImportQueue('redis://127.0.0.1:6379');
    startImportWorkers();
    const processor = captured.processors[captured.processors.length - 1];

    await expect(
      processor({ data: { taskId: 't-1', filePath: FILE_PATH, userId: '' } }),
    ).rejects.toThrow();

    expect(mockProcessImport).not.toHaveBeenCalled();
    expect(mockPrisma.importTask.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
  });

  it('job 里 userId 正常 → 照常调用 processImport', async () => {
    const { startImportWorkers } = await loadImportQueue('redis://127.0.0.1:6379');
    startImportWorkers();
    mockProcessImport.mockResolvedValue({ totalRows: 1, successRows: 1, failedRows: 0, errorFile: null });
    const processor = captured.processors[captured.processors.length - 1];

    const result = await processor({ data: { taskId: 't-1', filePath: FILE_PATH, userId: 'teacher-1' } });

    expect(mockProcessImport).toHaveBeenCalledWith('t-1', FILE_PATH, 'teacher-1');
    expect(result.successRows).toBe(1);
  });
});
