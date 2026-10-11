// @ts-check
/**
 * ESLint 扁平配置（monorepo 一份，覆盖前后端）
 *
 * 设计取舍：**只管正确性，不管格式**。
 * - 没有引入 Prettier：本仓库注释密集、有大量手工对齐，Prettier 一跑就是几千行
 *   无意义 diff，且会打散有意的排版。格式维持现状，lint 只负责抓 bug。
 * - error 与 warn 的分界：error 只放「几乎一定是 bug」的规则，见下方注释。
 *   一个写了两年的库一次性引入 lint，第一天就报几百条 error 的话，CI 会常年
 *   红灯，最后没人看——先把 error 清零，warn 慢慢还债。
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.tsbuild/**',
      'packages/client/public/**',
      'packages/server/exports/**',
      'e2e/**',
    ],
  },

  // ─────────────── 两端共用的基线 ───────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // 这个库在 WPS 开放平台的边界上有意大量使用 any（第三方返回结构不稳定、
      // 且不同版本字段会变）。禁掉它只会逼出一堆没有信息量的类型体操，
      // 真正的类型错误交给 tsc（`npm run build` 已经在把关）。
      '@typescript-eslint/no-explicit-any': 'off',

      // 未使用的变量/导入：**warn 而非 error**。
      // 它是整洁度问题，不是正确性问题——判断为"这个删了行为不变"需要人看一眼，
      // 不适合让 CI 拦。`_` 前缀表示有意保留（接口占位、解构丢弃）。
      // 用 unused-imports 插件而非内置规则，是因为它能把未使用的 import
      // 自动删掉（内置规则做不到，当初有 84 处得手改）。
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',        // catch (e) {} 里没用到的 e 不算问题
        ignoreRestSiblings: true,    // const { password, ...rest } = user
      }],

      // case 块里直接声明 const/let 会让变量泄漏到同一 switch 的其他 case。
      // 降为 warn：是真问题，但实际后果通常是"多一个变量"而非算错分，
      // 不值得为它把 CI 卡红（新写的代码仍应加花括号）。
      'no-case-declarations': 'warn',

      // 后端是 CommonJS，且临时脚本要用绝对路径 require，不禁
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // 允许 `declare namespace Express { interface Request {...} }` 这种全局类型
      // 增强——这是 Express 扩展 req.user 的标准写法，不是"该用模块"的场景
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],

      // 空 catch 是有意为之（探测类代码常这么写），但空 if/for 是写错了
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-useless-escape': 'warn',
      'no-control-regex': 'warn',

      // TypeScript 自己会查未定义标识符，ESLint 再查一遍会因为缺少全局声明误报
      'no-undef': 'off',
    },
  },

  // ─────────────── 后端：类型感知规则 ───────────────
  // 为什么值得为它开类型信息：这几个规则抓的是"接口返回 200 但数据没写进去"
  // 这一类静默事故——正是这个项目最怕的（学生答案丢了、判分记录没落库）。
  {
    files: ['packages/server/src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 漏 await：事务没提交、答案没落库、token 没刷新就往下走
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // 向需要 void 的地方传 async 函数会吃掉错误；arguments 关掉是因为
      // Express 路由 `router.get('/', async (req,res)=>{})` 全是这个形态，
      // 属于框架惯例而非 bug。条件判断/赋值里的误用仍然拦截。
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { arguments: false },
      }],
      '@typescript-eslint/return-await': ['warn', 'in-try-catch'],
    },
  },

  // 后端非 src 目录（种子数据、运维脚本）：没有 tsconfig 覆盖，不做类型感知
  {
    files: ['packages/server/prisma/**/*.ts', 'packages/server/scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // ─────────────── 前端：React ───────────────
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // hooks 必须在顶层调用——违反会直接让组件状态错乱，是 error
      'react-hooks/rules-of-hooks': 'error',
      // 依赖漏写导致闭包读到过期值：本项目的考试会话/自动保存大量依赖它，
      // 设为 warn 而非 error 是因为存在"故意不写依赖"的合法场景，
      // 需要人判断，不适合让 CI 直接拦。
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ─────────────── 测试与前端构建配置 ───────────────
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/vite.config.ts', '**/vitest.config.ts', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
);
