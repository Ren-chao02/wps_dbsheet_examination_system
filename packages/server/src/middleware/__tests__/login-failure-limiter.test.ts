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
