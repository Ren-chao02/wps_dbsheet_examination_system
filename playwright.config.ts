import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置
 *
 * 覆盖的是「改完不敢确定有没有改坏」的那条主干：登录 → 入场 → 作答 → 交卷 → 成绩。
 * 单元测试（vitest）覆盖纯逻辑，这里只放**必须真的点一遍**才能确认的东西。
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // 考试流程是有状态的一条线（开考→作答→交卷），并行跑会互相踩；
  // 而且同一个人不能同时开两场考。串行是这里唯一正确的选择。
  fullyParallel: false,
  workers: 1,

  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // 只在失败时留证据：录像/trace 本身有开销，考试页尤其吃性能
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 没有配 webServer：开发时前后端通常已经在跑（npm run dev）。
  // CI 里若需要自动拉起，加 webServer 配置即可。
});
