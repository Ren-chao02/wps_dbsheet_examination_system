import { describe, it, expect } from 'vitest';
import { isLoopback } from '../ip-utils';

describe('isLoopback', () => {
  it('识别 IPv4 / IPv6 / IPv4-mapped 回环', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });

  it('其余地址与空值都不是回环', () => {
    expect(isLoopback('10.0.0.1')).toBe(false);
    expect(isLoopback('8.8.8.8')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});
