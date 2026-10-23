import { describe, it, expect, vi } from 'vitest';
import { createLoginFailureLimiter } from '../login-failure-limiter';

function fakeRes(statusCode: number) {
  const handlers: Array<() => void> = [];
  const res: any = {
    statusCode,
    on: (ev: string, cb: () => void) => { if (ev === 'finish') handlers.push(cb); },
    status: vi.fn((code: number) => { res.statusCode = code; return res; }),
    json: vi.fn(() => res),
    finish: () => handlers.forEach(h => h()),
  };
  return res;
}

describe('createLoginFailureLimiter', () => {
  it('成功请求不占额度；失败达到阈值后 429', () => {
    const limiter = createLoginFailureLimiter(2, 60_000);
    const req: any = { ip: '1.2.3.4' };
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const res = fakeRes(200);
      limiter(req, res, next);
      res.finish();
    }
    expect(next).toHaveBeenCalledTimes(3);

    for (let i = 0; i < 2; i++) {
      const res = fakeRes(401);
      limiter(req, res, next);
      res.finish();
    }
    expect(next).toHaveBeenCalledTimes(5);

    const blocked = fakeRes(200);
    limiter(req, blocked, next);
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(5);
  });

  it('不同 IP 的失败计数互不影响', () => {
    const limiter = createLoginFailureLimiter(1, 60_000);
    const a: any = { ip: '1.1.1.1' };
    const b: any = { ip: '2.2.2.2' };
    const next = vi.fn();

    const r1 = fakeRes(401); limiter(a, r1, next); r1.finish();
    const r2 = fakeRes(401); limiter(b, r2, next); r2.finish();
    expect(next).toHaveBeenCalledTimes(2);

    const blocked = fakeRes(200); limiter(a, blocked, next);
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('createLoginFailureLimiter 的并发闸门', () => {
  it('在途请求达到上限后拒绝新请求（防止并发失败绕过失败计数）', () => {
    const limiter = createLoginFailureLimiter(2, 60_000, 3);
    const req: any = { ip: '9.9.9.9' };
    const next = vi.fn();

    // 3 个请求同时进入（都还没 finish）→ 允许；第 4 个被在途上限挡住
    const inflight = [fakeRes(200), fakeRes(200), fakeRes(200)];
    for (const res of inflight) limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(3);

    const blocked = fakeRes(200);
    limiter(req, blocked, next);
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(next).toHaveBeenCalledTimes(3);

    // 全部以 401 结束后：失败预算（2）已超，后续请求继续被拒
    for (const res of inflight) { res.statusCode = 401; res.finish(); }
    const after = fakeRes(200);
    limiter(req, after, next);
    expect(after.status).toHaveBeenCalledWith(429);
  });

  it('在途上限不影响成功并发：上限内的成功请求全部放行', () => {
    const limiter = createLoginFailureLimiter(1, 60_000, 5);
    const req: any = { ip: '8.8.4.4' };
    const next = vi.fn();
    const inflight = Array.from({ length: 5 }, () => fakeRes(200));
    for (const res of inflight) limiter(req, res, next);
    expect(next).toHaveBeenCalledTimes(5);
    for (const res of inflight) res.finish();
    // 成功不占失败预算
    const more = fakeRes(200);
    limiter(req, more, next);
    expect(next).toHaveBeenCalledTimes(6);
  });
});
