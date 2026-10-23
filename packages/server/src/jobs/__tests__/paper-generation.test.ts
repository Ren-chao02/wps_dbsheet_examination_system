/**
 * 预生成任务：幂等、分页、取消、汇总。
 * 用依赖注入替代真实队列/DB（processPaperGeneration 接受可选的 deps）。
 */
import { describe, it, expect, vi } from 'vitest';
import { processPaperGeneration } from '../paper-generation-queue';

const students = Array.from({ length: 5 }, (_, i) => ({ studentId: `s-${i}` }));

describe('processPaperGeneration', () => {
  it('为名单内每个学生生成，缺卷者计入 missing', async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce({ created: 3, total: 3, unfilledSlots: [] })
      .mockResolvedValueOnce({ created: 0, total: 3, unfilledSlots: [] })
      .mockResolvedValueOnce({ created: 3, total: 3, unfilledSlots: [] })
      .mockResolvedValueOnce({ created: 0, total: 0, unfilledSlots: [{ slotIndex: 2, reason: '候选池为空' }] })
      .mockResolvedValueOnce({ created: 3, total: 3, unfilledSlots: [] });
    const deps = {
      listStudents: vi.fn().mockResolvedValue(students),
      generate,
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
    };
    const out = await processPaperGeneration('e-1', deps as any);
    expect(generate).toHaveBeenCalledTimes(5);
    expect(out.generated).toBe(4);   // total>0 视为有卷
    expect(out.missing).toBe(1);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({ status: 'done' }));
  });

  it('考试在生成中被取消 → 停止并标 failed', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-0' }, { studentId: 's-1' }]),
      generate: vi.fn().mockResolvedValue({ created: 1, total: 1, unfilledSlots: [] }),
      getExamStatus: vi.fn().mockResolvedValue('cancelled'),
      markStatus: vi.fn().mockResolvedValue(undefined),
    };
    const out = await processPaperGeneration('e-1', deps as any);
    expect(out.generated).toBe(0);
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({ status: 'failed' }));
  });

  it('生成抛错 → 状态写回 failed，并把异常抛给 BullMQ 重试', async () => {
    const deps = {
      listStudents: vi.fn().mockResolvedValue([{ studentId: 's-0' }]),
      generate: vi.fn().mockRejectedValue(new Error('DB timeout')),
      getExamStatus: vi.fn().mockResolvedValue('published'),
      markStatus: vi.fn().mockResolvedValue(undefined),
    };
    await expect(processPaperGeneration('e-1', deps as any)).rejects.toThrow('DB timeout');
    expect(deps.markStatus).toHaveBeenLastCalledWith('e-1', expect.objectContaining({
      status: 'failed', error: 'DB timeout',
    }));
  });
});
