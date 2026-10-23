import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vitest 4 的默认 exclude 只剩 node_modules/.git：`npm run build` 留下的大量
    // dist/**/__tests__/*.test.js 会被当成测试收集，以 CJS 方式 require('vitest')
    // 必然报错，让本机 `npm test -w packages/server` 常年 44 个文件通红。
    // 测试只应跑 src 下的源码（tsconfig 的 rootDir 也是 src）。
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
