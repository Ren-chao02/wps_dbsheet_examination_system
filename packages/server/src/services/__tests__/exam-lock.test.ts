/**
 * 考试级 advisory lock helper：开考事务与重新组卷共用同一把锁的底座。
 *
 * 只钉住「在事务客户端上按 examId 发一条 pg_advisory_xact_lock」这一契约：
 * 锁的作用域/释放由 PostgreSQL 事务保证，单测无法复现并发窗口，
 * 路由侧「事务内取锁 + 守卫删除」由 exam-paper-generation-api.test.ts 覆盖。
 */
import { describe, it, expect, vi } from 'vitest';
import { lockExam } from '../exam-lock';

describe('lockExam', () => {
  it('在事务内按 examId 取 PostgreSQL advisory lock', async () => {
    // $executeRaw 不读结果列（pg_advisory_xact_lock 返回 void，$queryRaw 会反序列化失败）
    const executeRaw = vi.fn().mockResolvedValue(1);
    await lockExam({ $executeRaw: executeRaw } as any, 'e-1');
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = executeRaw.mock.calls[0];
    const sql = strings.join('?');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('hashtextextended');
    expect(values).toContain('e-1');
  });
});
