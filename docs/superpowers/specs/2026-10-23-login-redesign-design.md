# 登录页改版与登录能力升级（陕西师范大学）

> 日期：2026-10-23
> 状态：已实现（WPS SSO 默认关闭，待外部配置后启用）
> 范围：登录页视觉、学号/工号登录、记住我、登录安全、邀请链接入口、WPS 账号 SSO

---

## 一、背景与目标

原登录页是居中的白卡片，只支持 `username + password + 验证码`，与学校品牌无关，也没有失败锁定、学号登录、WPS 登录等能力。

本次目标：

1. 用陕西师范大学校徽与标准色重做登录页，桌面端左右分栏、移动端折叠；
2. 支持 **学号 / 工号 / 用户名** 三种登录标识；
3. 「记住账号」+ 可选「7 天内免登录」；
4. 登录安全：账号 10 次失败锁 15 分钟、IP 失败限流、验证码一次性、登录审计；
5. 登录页提供班级邀请链接/邀请码入口；
6. WPS 账号 SSO：首次登录验证本地密码完成绑定，之后一键登录；
7. 管理端可解绑 WPS、手动解除登录锁定。

### 非目标

- 不改造考试、判分、组卷链路；
- 不做自助找回密码（系统没有可用的邮箱/短信通道）；
- 不把全局主题改成校色（只作用于登录/绑定页，避免影响考试页与危险按钮语义）；
- 不引入 refresh token / 服务端会话表；「7 天免登录」是 7 天 JWT。

---

## 二、视觉与前端

### 2.1 品牌资产

| 项 | 值 |
| --- | --- |
| 校名 | 陕西师范大学 / SHAANXI NORMAL UNIVERSITY |
| 校徽 | `packages/client/src/assets/snnu-emblem-white.png`（反白）、`snnu-emblem-red.png` |
| 主色 | `#B50007`（校徽实测主色；学校 VI 标准色为中国红 M100 Y100 K30） |
| 辅助深色 | `#8E0005` |
| 品牌区背景 | `linear-gradient(158deg, #240305 0%, #4B0004 38%, #8E0005 72%, #B50007 100%)` |
| 校训 | 厚德 · 积学 · 励志 · 敦行 |

### 2.2 页面结构

- 新增 `AuthShell`（`packages/client/src/pages/auth/AuthShell.tsx` + `auth.css`）：
  - 桌面端：左侧品牌区 44% + 右侧表单区 56%，卡片最大 1120px、圆角 18px；
  - ≤1023px：品牌区折叠为顶部校名条；
  - ≤640px：单列全宽，可滚动；
  - 品牌区包含校徽、校名、系统名、三条能力点、校训。
- `AuthShell` 内嵌 `ConfigProvider`，把 `colorPrimary` / `colorLink` 设为校色；同时通过 CSS 变量覆盖全局 `--apple-accent`，让 antd 输入框焦点、主按钮在登录页呈现校色。
- 弹窗通过 `rootClassName="auth-modal"` 继承同一套变量（弹窗挂载在 `body`，不在 `.auth-shell` 内）。

### 2.3 登录表单

文件：`packages/client/src/pages/auth/LoginPage.tsx`

- 字段：学号/用户名、密码、验证码；
- 「记住账号」默认勾选，只把上次账号写入 `localStorage.login_last_identifier`；
- 「7 天内免登录」独立勾选，默认关闭，旁注公用电脑提示；
- 「登录遇到问题？」弹窗：忘记密码、账号锁定、没有账号三类处置说明；
- 「有班级邀请链接？」弹窗：支持粘贴完整链接、`/join/<code>` 或 8 位邀请码，前端用 `extractInvitationCode` 提取后先调 `GET /api/invitations/:code/info` 校验，再跳 `/join/:code`；
- 「WPS 账号登录」仅在 `GET /api/auth/config` 返回 `wpsSsoEnabled=true` 时显示；
- DEV 环境保留测试账号提示，生产构建不显示；
- 已登录用户访问 `/login` 自动回角色首页；会话过期场景仍优先回 `sessionStorage.login_return_url`。

### 2.4 状态与错误

- 验证码错误：顶部 Alert + 自动刷新验证码 + 清空验证码输入；
- 密码错误：统一文案「账号或密码错误」，清空密码；
- 账号锁定：`423` + `lockedUntil`，显示 `mm:ss` 倒计时，期间禁用提交；
- 限流：`429`，提示稍后再试；
- 账号禁用：`403 ACCOUNT_DISABLED`；
- 服务异常：通用「登录失败，请稍后重试」；
- 每次登录失败后前端主动刷新验证码（服务端在验证码校验后即消费 token）。

### 2.5 可访问性

- 表单使用 antd `Form` 标签关联、`role=alert` 错误提示；
- 验证码刷新是真正的 `<button type="button">`，可键盘触发；
- 焦点环 3px `rgba(181,0,7,.18)`；
- 红底白字 / 白底红字对比度约 7.4:1；次要文字使用 `#6B6464` 级别而非浅灰；
- 全局 `prefers-reduced-motion` 规则继续生效。

### 2.6 SSO 辅助页面

- `WpsBindingPage`：首次 SSO 绑定，展示 WPS 姓名/头像，验证本地学号/工号/用户名 + 密码；票据过期时给出「重新使用 WPS 登录」；
- `WpsCallbackPage`：读取 URL fragment 中的本地 JWT，立即 `history.replaceState` 清掉，再调 `/auth/me` 补齐用户信息并按角色跳转；
- `RegisterPage` 改用 `AuthShell`，保持风格一致。

---

## 三、后端数据与接口

### 3.1 数据模型

`packages/server/prisma/schema.prisma` 的 `User` 新增：

```prisma
failedLoginAttempts Int       @default(0) @map("failed_login_attempts")
lockedUntil         DateTime? @map("locked_until")
wpsUserId           String?   @unique @map("wps_user_id") @db.VarChar(128)
wpsBoundAt          DateTime? @map("wps_bound_at")
```

迁移：`packages/server/prisma/migrations/20261023180000_login_redesign/migration.sql`（纯新增列 + 唯一索引，无回填）。

### 3.2 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/captcha` | 返回 `{ svg, captchaToken, debugAnswer? }`；答案存服务端，一次性 |
| GET | `/api/auth/config` | `{ wpsSsoEnabled }`，公开 |
| POST | `/api/auth/login` | `{ identifier?, username?, password, captchaToken, captchaText, rememberMe? }` |
| GET | `/api/auth/wps/authorize` | 设置 state Cookie，302 到 WPS 授权页 |
| GET | `/api/auth/wps/callback` | 校验 state、换 token、读 WPS 用户；已绑定直接登录，未绑定跳绑定页 |
| GET | `/api/auth/wps/pending` | 读 HttpOnly 绑定票据，返回 WPS 姓名/头像 |
| POST | `/api/auth/wps/bind` | `{ identifier, password }`，验证本地密码后写入 `wpsUserId` |
| DELETE | `/api/users/:id/wps-binding` | 管理员解绑 |
| DELETE | `/api/users/:id/login-lock` | 管理员解除登录锁定 |

`POST /api/auth/login` 查找顺序：`username → studentId → employeeId`；仍然兼容旧的 `username` 字段。

### 3.3 登录流程

1. 校验验证码（一次性，失败不消耗账号失败次数）；
2. 查找用户；找不到也执行一次 bcrypt 假比较，降低时间侧信道；
3. 密码错误：若账号未锁定则自增失败次数；第 10 次写入 `lockedUntil = now + 15min` 并返回 423；
4. 密码正确后才检查锁定与禁用（避免不知道密码也能探测账号状态）；
5. 成功：清零失败计数、写 `lastLoginAt`、签发 JWT（默认 24h，`rememberMe=true` 为 7d）、返回 `{ token, expiresIn, user, permissions }`；
6. 成功/失败/锁定/禁用均写 `AuditLog`（`action=LOGIN`，`entityType=Auth`），不含密码/验证码。

### 3.4 安全策略

| 项 | 实现 |
| --- | --- |
| 账号锁定 | `LOGIN_MAX_FAILED=10`、`LOGIN_LOCK_MINUTES=15`；锁过期自动清零 |
| IP 限流 | `LOGIN_IP_LIMIT=100` / `LOGIN_IP_WINDOW_MINUTES=15`，仅失败请求计数；按 `ipKeyGenerator` 处理 IPv6 |
| 验证码 | 服务端 Map 存储、5 分钟 TTL、一次性消费；生产不返回答案；验证码接口另有 1000 次/15 分钟 IP 限流（整班 NAT 友好） |
| 验证码测试 | 非生产默认返回 `debugAnswer`；生产仅在 `E2E_CAPTCHA_DEBUG=true` 且请求来自回环地址时返回 |
| 审计 | `AuditLog` 记录成功/失败原因、IP、UA、登录方式；审计失败不影响登录 |
| 账号枚举 | 账号不存在与密码错误统一 401 文案；密码正确后才提示锁定/禁用 |
| 绑定暴力破解 | `/wps/bind` 复用账号失败计数 + IP 限流 |

> 验证码存储是进程内 Map：当前单实例部署够用；若横向扩容，需要换成 Redis 共享存储。

### 3.5 WPS SSO

```
登录页 → GET /api/auth/wps/authorize
      → WPS https://openapi.wps.cn/oauth2/auth
      → GET /api/auth/wps/callback?code&state
          ├─ 已绑定：302 /auth/wps/callback#token=<本地 JWT>
          └─ 未绑定：设置 HttpOnly wps_bind_ticket，302 /auth/wps/bind
      → POST /api/auth/wps/bind（验证本地密码）→ 写入 wpsUserId → 登录
```

实现要点：

- state：32 字节随机串存 HttpOnly Cookie（`path=/api/auth/wps`，10 分钟），回调常量时间比较；
- 换 token：`POST https://openapi.wps.cn/oauth2/token`（`authorization_code`）；
- 读用户：`GET https://openapi.wps.cn/v7/users/current`，需要 **KSO-1 签名** + `Authorization: Bearer <用户 token>`；
- KSO-1：`services/wps-kso-sign.ts`，stringToSign 为 `"KSO-1" + METHOD + RequestURI + ContentType + X-Kso-Date + sha256(body)`，**无换行**；GET 空 body 的哈希段为空字符串；HMAC-SHA256 小写十六进制；请求头 `X-Kso-Date` + `X-Kso-Authorization: KSO-1 <APPID>:<signature>`；
- 绑定票据：10 分钟 JWT（`typ=wps_bind`），HttpOnly Cookie；前端只能拿到姓名/头像；
- **绝不**把用户 access_token 写入 `WpsConfig`；该表只存多维表格 API 的全局 token；
- 已绑定账号在 SSO 登录时跳过密码失败锁定（锁定只针对密码登录）；账号禁用仍然拒绝；
- 同一本地账号 / 同一 WPS 身份只能绑定一次，冲突返回 409；
- 管理员可在「账户管理」「学生管理」解绑 WPS、手动解锁。

### 3.6 外部前置条件（启用 SSO 前必须完成）

1. 在 WPS 开放平台应用后台开通用户授权权限 `kso.user_base.read`（user 类型，不是 app 类型）；
2. 回调地址填 `${PUBLIC_BASE_URL}/api/auth/wps/callback`，与 `PUBLIC_BASE_URL` 完全一致（协议/域名/端口/路径）；
3. 开启 **KSO-1 接口签名**；
4. 配置：
   ```bash
   WPS_SSO_ENABLED=true
   PUBLIC_BASE_URL=https://exam.example.edu.cn
   # 同源部署可留空 CLIENT_BASE_URL；前后端分离时填前端地址
   CLIENT_BASE_URL=
   # 可留空，回退到 WPS 多维表格已配置的 APPID / APPKEY
   WPS_SSO_CLIENT_ID=
   WPS_SSO_CLIENT_SECRET=
   WPS_SSO_SCOPE=kso.user_base.read
   ```
5. 用真实 WPS 账号走一次授权：
   - 登录页出现「WPS 账号登录」；
   - 首次跳绑定页，验证本地密码后成功；
   - 退出后再点 WPS 登录直接进入；
   - 若 403：优先检查 scope 是否开通、KSO-1 是否开启、回调地址是否完全一致。

> SSO 默认关闭；未配置时登录页隐藏入口，密码登录与其余功能不受影响。

### 3.7 登录标识派生与全局唯一（2026-10-23 补充）

目标模型：**每个账号只有一个唯一登录键 `username`**，取值按角色派生：

| 角色 | 登录键 | 说明 |
| --- | --- | --- |
| 学生 | `username = studentId` | 创建/导入/邀请审批都自动派生，不再填独立用户名 |
| 教师 | `username = employeeId` | 创建/导入必须填工号，登录名自动等于工号 |
| 管理员系统账号 | 独立系统登录名 | 没有学号/工号，保留 `username` |

配套约束：

- **全局标识守卫** `services/user-identifiers.ts`：创建/修改任一标识时，检查它是否已被其他账号的 `username`/`studentId`/`employeeId` 占用；登录按 `username → studentId → employeeId` 解析，跨列重复会让 B 的学号被 A 的登录名遮住。
- 学生 `studentId` 变更时同步 `username`；教师 `employeeId` 变更时同步 `username`。学号/工号不再允许与登录名分叉。
- 账户导入模板新增第 7 列「工号(教师必填)」；教师行以工号为登录名，管理员行仍用第 1 列登录名。
- 邀请审批建号也走同一守卫（学号=登录名）。
- 兼容旧客户端：学生创建仍接受 `username` 字段但会忽略，统一使用学号。

> 当前仍保留多标识查找作为兼容层；数据统一后可以收敛为只查 `username` 的单键登录。

---

## 四、配置项

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `JWT_REMEMBER_EXPIRES_IN` | `7d` | 勾选「7 天内免登录」时的有效期 |
| `LOGIN_MAX_FAILED` | `10` | 账号失败锁定阈值 |
| `LOGIN_LOCK_MINUTES` | `15` | 锁定时长 |
| `LOGIN_IP_LIMIT` | `100` | IP 失败请求上限 |
| `LOGIN_IP_WINDOW_MINUTES` | `15` | IP 限流窗口 |
| `E2E_CAPTCHA_DEBUG` | `false` | 仅本地 E2E；回环地址才返回验证码答案 |
| `WPS_SSO_ENABLED` | `false` | SSO 总开关 |
| `WPS_SSO_CLIENT_ID/SECRET` | 空 | 留空回退 `WpsConfig` / `KINGSOFT_API_*` |
| `WPS_SSO_SCOPE` | `kso.user_base.read` | 用户授权 scope |
| `PUBLIC_BASE_URL` | 空 | 服务端公网地址，用于回调 |
| `CLIENT_BASE_URL` | 空 | 前端公网地址，同源时留空 |
| `WPS_SSO_REDIRECT_URI` | 空 | 一般由 `PUBLIC_BASE_URL` 拼接 |

`.env.example` 已同步。

---

## 五、测试与验证

### 5.1 自动化

新增/更新：

- `packages/server/src/utils/__tests__/captcha.test.ts`：一次性、过期、答案错误；
- `packages/server/src/services/__tests__/login-security.test.ts`：查找优先级、10 次锁定、锁过期清零、rememberMe TTL；
- `packages/server/src/services/__tests__/wps-kso-sign.test.ts`：KSO-1 字符串拼接、无换行、HMAC 结果；
- `packages/server/src/routes/__tests__/auth-login.test.ts`：学号登录、旧 `username` 兼容、验证码错误、失败计数、423、禁用、rememberMe、审计不含密码；
- `packages/server/src/routes/__tests__/wps-sso.test.ts`：授权跳转、state 校验、已绑定/未绑定回调、绑定票据、绑定成功/密码错误/重复绑定/票据过期；
- `packages/client/src/utils/__tests__/invitation-code.test.ts`：邀请链接/路径/纯码解析；
- `e2e/smoke.spec.ts`、`e2e/helpers/auth.ts`：适配新表单与 `debugAnswer`。

验证结果（2026-10-23）：

- `npm run lint`：0 error / 37 warning（存量 warning）
- `npm run typecheck`：两端通过
- `npm test -w packages/server`：85 files / 738 passed / 9 todo
- `npm test -w packages/client`：14 files / 115 passed
- `npm run build`：两端通过
- `npx playwright test e2e/smoke.spec.ts`：2 passed / 2 skipped
- 真实后端：验证码登录（teacher1）成功；`rememberMe` 返回 `expiresIn=7d`、TTL 168h；验证码二次使用返回 400
- 浏览器：桌面 1440×900、移动 390×844 截图通过；邀请码弹窗；验证码错误提示与自动刷新；实际登录跳转 `/teacher/dashboard`

### 5.2 手工验收清单（SSO 启用后）

- [ ] 登录页出现 WPS 登录入口
- [ ] 首次 WPS 登录跳绑定页，显示 WPS 姓名/头像
- [ ] 错误本地密码提示「账号或密码错误」，不整页跳登录
- [ ] 正确密码绑定成功后进入角色首页
- [ ] 退出后用同一 WPS 账号一键登录
- [ ] 另一 WPS 账号尝试绑定同一本地账号 → 409
- [ ] 管理员解绑后再次 SSO → 重新绑定
- [ ] 账号禁用时 SSO → 登录页提示「账号已被禁用」
- [ ] 取消授权 → 登录页提示「已取消 WPS 授权登录」

---

## 六、上线与回滚

- 迁移为纯新增列，`prisma migrate deploy` 即可；回滚可保留列（不影响旧代码）。
- WPS SSO 使用 `WPS_SSO_ENABLED` 开关，未配置时完全隐藏；KSO-1/scope 未就绪不阻塞密码登录上线。
- 验证码改为服务端存储后，旧客户端/旧脚本若把 `captchaToken` 当 JWT 解码会失效；本仓库 E2E 已同步。
- 若需要回滚验证码实现：恢复 `utils/captcha.ts` 的 JWT 版本即可，路由接口形状不变（token 仍是字符串）。

### 6.1 本地数据重置（2026-10-23）

为验证新登录模型，已清空旧教师/学生与考试数据，保留题库、试卷、组织架构与 admin：

- 备份：`backups/pre-login-reset-2026-10-23.dump`（`pg_dump -Fc`，已加入 `.gitignore`）
- 保留：254 道题、3 份试卷（创建人转给 admin）、院系/专业/班级、审计日志
- 删除：4 位旧教师、2 位旧学生、10 场考试、8 个批次、10 份答卷、14 条学生卷子快照，以及考场/表格分配、行为日志/报告、练习记录
- 新建：
  - 教师 `T2026001` 张老师、`T2026002` 李老师（登录名=工号）
  - 学生 `20260001` 学生A、`20260002` 学生B、`20260003` 学生C、`20260004` 学生D（登录名=学号）
- 已重新导出 `prisma/seed-data/dump.json`，空库执行 `npm run db:seed` 可复现这套数据；教职工初始口令仍走种子脚本的强口令策略。

> 该重置脚本是一次性操作，未入库；如需再次重置，可用备份恢复或基于当前 seed dump 重建。

## 七、已知限制与后续

1. 验证码存进程内 Map：多实例部署需迁移到 Redis；
2. 「7 天免登录」是无状态 JWT，无法在服务端单点失效；修改密码后旧 token 仍可能有效，后续可加 `sessionVersion`；
3. WPS SSO 依赖外部控制台配置；KSO-1 已按公开算法实现并用单测锁定拼接格式，但真实接口仍需按 §3.6 手工验收；
4. `API /auth/refresh` 仍固定 24h，不继承 rememberMe；
5. 管理端解绑/解锁入口在「账户管理」和「学生管理」；教师只能看到状态，不能操作（后端仅 admin）。

---

## 八、本次改动文件

**前端**

- `packages/client/src/pages/auth/LoginPage.tsx`（重写）
- `packages/client/src/pages/auth/AuthShell.tsx`、`auth.css`（新增）
- `packages/client/src/pages/auth/WpsBindingPage.tsx`、`WpsCallbackPage.tsx`、`auth-helpers.ts`（新增）
- `packages/client/src/pages/auth/RegisterPage.tsx`
- `packages/client/src/App.tsx`、`index.html`、`index.css`（移除旧登录样式）
- `packages/client/src/services/api.ts`、`types/index.ts`
- `packages/client/src/utils/invitation-code.ts` + 测试（新增）
- `packages/client/src/pages/admin/AccountManagement.tsx`、`pages/teacher/StudentManagement.tsx`
- `packages/client/src/assets/snnu-emblem-{red,white}.png`、`public/snnu-emblem.png`（新增）

**后端**

- `packages/server/prisma/schema.prisma` + `migrations/20261023180000_login_redesign/`（新增）
- `packages/server/src/routes/auth.ts`（重写登录/新增 SSO）
- `packages/server/src/services/login-security.ts`、`wps-sso-service.ts`、`wps-kso-sign.ts`、`user-identifiers.ts`（新增）
- `packages/server/src/utils/captcha.ts`（改为服务端一次性存储）
- `packages/server/src/routes/users.ts`（解绑/解锁）、`accounts.ts`（工号派生/导入模板）、`students.ts`（学号派生）、`invitations.ts`（审批守卫）
- `packages/server/src/app.ts`（cookie-parser）、`config/index.ts`
- `packages/server/scripts/probe-wps-sso.ts`（新增，已加入 `.gitignore` 白名单）
- 测试：`auth-login.test.ts`、`wps-sso.test.ts`、`login-security.test.ts`、`wps-kso-sign.test.ts`、`captcha.test.ts`（新增）

**其他**

- `.env.example`、`packages/server/.env.example`
- `.gitignore`（`.superpowers/`、`backups/`、探针脚本白名单）
- `packages/server/prisma/seed.ts`、`prisma/seed-data/dump.json`（2 教师 + 4 学生的重置后数据）
- `CONTEXT.md`（账号/登录标识/学号/工号/管理员系统账号的术语表）
- `e2e/helpers/auth.ts`、`e2e/smoke.spec.ts`
- 本设计文档
