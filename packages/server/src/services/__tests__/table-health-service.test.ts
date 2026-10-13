/**
 * 表格可用性检查的测试
 *
 * 这个服务存在的理由很具体：分配表格时不校验链接，会让老师看到「保存成功」、
 * 学生看到「文档已删除」，并且把答卷卡在「已交卷」判不出分。
 * 所以这里重点测"读不到时必须明确报出来、且说清是什么原因"。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateAdapter, mockGetValidAccessToken } = vi.hoisted(() => ({
  mockCreateAdapter: vi.fn(),
  mockGetValidAccessToken: vi.fn(),
}));

vi.mock('../../engine/adapters/kingsoft-adapter', () => ({
  createAdapterFromSpaceId: mockCreateAdapter,
}));
vi.mock('../wps-config-service', () => ({
  wpsConfigService: { getValidAccessToken: mockGetValidAccessToken },
}));

import { checkTablesReadable } from '../table-health-service';

/** 造一个 adapter：getSchema 按传入行为返回/抛错 */
function adapterReturning(getSchema: () => Promise<any>) {
  return { getSchema } as any;
}

const okSchema = { result: 0, detail: { sheets: [{ id: 1, name: '员工信息表' }] } };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetValidAccessToken.mockResolvedValue('live-token');
  mockCreateAdapter.mockReturnValue(adapterReturning(async () => okSchema));
});

describe('checkTablesReadable', () => {
  it('全部可读 → 列进 ok，没有 failed', async () => {
    const r = await checkTablesReadable([{ fileId: 'aaa' }, { fileId: 'bbb' }]);
    expect(r.ok.sort()).toEqual(['aaa', 'bbb']);
    expect(r.failed).toEqual([]);
    expect(r.unchecked).toEqual([]);
  });

  it('403（文档已删除/无权限）→ failed 里给出可读的原因', async () => {
    mockCreateAdapter.mockReturnValue(
      adapterReturning(async () => { throw new Error('API 请求失败 [/schema/query]: 403 Forbidden'); }),
    );
    const r = await checkTablesReadable([{ fileId: 'dead' }]);
    expect(r.ok).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].fileId).toBe('dead');
    expect(r.failed[0].reason).toContain('文档已被删除');
  });

  it('404 → 说明是链接失效', async () => {
    mockCreateAdapter.mockReturnValue(
      adapterReturning(async () => { throw new Error('404 Not Found'); }),
    );
    const r = await checkTablesReadable([{ fileId: 'gone' }]);
    expect(r.failed[0].reason).toContain('不存在');
  });

  it('凭据失效（401）→ 提示去管理页重新配置，而不是含糊的报错', async () => {
    mockCreateAdapter.mockReturnValue(
      adapterReturning(async () => { throw new Error('401000001 invalid_token'); }),
    );
    const r = await checkTablesReadable([{ fileId: 'x' }]);
    expect(r.failed[0].reason).toContain('凭据失效');
  });

  it('构造不出适配器（没有任何凭据）→ 也归入 failed，不能静默放行', async () => {
    mockCreateAdapter.mockReturnValue(null);
    const r = await checkTablesReadable([{ fileId: 'x' }]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].reason).toContain('凭据');
  });

  it('同一个 fileId 只检查一次（批量分配时学生常共用少量文件）', async () => {
    const spy = vi.fn(async () => okSchema);
    mockCreateAdapter.mockReturnValue(adapterReturning(spy));
    await checkTablesReadable([{ fileId: 'same' }, { fileId: 'same' }, { fileId: 'same' }]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('优先用 WpsConfig 的实时 token，子项自带的快照 token 只作兜底', async () => {
    // 快照 token 24 小时就失效，拿它去查会把正常表格误判成"已删除"。
    await checkTablesReadable([{ fileId: 'a', accessToken: 'stale-snapshot' }, { fileId: 'b' }]);
    const used = mockCreateAdapter.mock.calls.map(c => c[0]);
    expect(used).toEqual(['a:live-token', 'b:live-token']);
  });

  it('拿不到实时 token 时才回退到子项自带的快照 token', async () => {
    mockGetValidAccessToken.mockResolvedValue(null);
    await checkTablesReadable([{ fileId: 'a', accessToken: 'snapshot' }, { fileId: 'b' }]);
    const used = mockCreateAdapter.mock.calls.map(c => c[0]);
    expect(used).toEqual(['a:snapshot', 'b']);
  });

  it('时间预算用尽 → 剩余标为 unchecked（放行但要能提示），而不是当成通过', async () => {
    // 单线程 + 每个查 50ms + 预算 20ms：第一个查完就超预算，第二个没来得及查
    mockCreateAdapter.mockReturnValue(adapterReturning(async () => {
      await new Promise(r => setTimeout(r, 50));
      return okSchema;
    }));
    const r = await checkTablesReadable([{ fileId: 'a' }, { fileId: 'b' }], {
      budgetMs: 20, concurrency: 1,
    });
    expect(r.ok).toEqual(['a']);
    expect(r.failed).toEqual([]);
    expect(r.unchecked).toEqual(['b']);
  });

  it('并发上限生效（不会一次把所有请求打出去）', async () => {
    let inFlight = 0;
    let peak = 0;
    mockCreateAdapter.mockReturnValue(adapterReturning(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return okSchema;
    }));
    await checkTablesReadable(
      Array.from({ length: 20 }, (_, i) => ({ fileId: `f${i}` })),
      { concurrency: 4 },
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('接口返回的形状不对（不是多维表格）→ 也算不可用', async () => {
    mockCreateAdapter.mockReturnValue(adapterReturning(async () => ({ result: 0 } as any)));
    const r = await checkTablesReadable([{ fileId: 'notdbsheet' }]);
    expect(r.failed[0].reason).toContain('不是多维表格');
  });
});
