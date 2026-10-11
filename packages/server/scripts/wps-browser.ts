/**
 * 用真实浏览器操作 WPS 云端文档
 *
 * 为什么需要它：有些问题**从 API 和文档都推不出结论**，唯一办法是在真实的
 * WPS 文档里改一下、再读一次。最典型的一个是：「视图的筛选条件到底会不会
 * 出现在 schema/query 的返回里」—— 它决定 3 条判分规则（视图筛选/排序/分组）
 * 是不是对每个学生都判错。
 *
 * 用法：
 *   npx tsx scripts/wps-browser.ts login
 *       一次性：在桌面上开一个浏览器窗口，人工登录 kdocs，登录成功后自动关闭。
 *       登录态存进下面的 profile 目录，之后就能无人值守地复用。
 *
 *   npx tsx scripts/wps-browser.ts shot <url> [输出路径]
 *       用已保存的登录态打开某页并截图，用来确认页面状态/找元素。
 *
 *   npx tsx scripts/wps-browser.ts dom <url> [关键词]
 *       打开某页并把可见文本/按钮名打印出来，用来定位"该点哪里"。
 *
 * ⚠️ 登录态存放位置：~/.local/share/exam-wps-verify/chrome-profile
 *    **不在仓库里**，不会进版本库。要撤销授权：直接删掉那个目录即可。
 *
 * 说明：用的是系统安装的 Chrome（channel: 'chrome'）。Playwright 自带的
 * chromium 在这里只下载了 headless shell，开不了可视窗口。
 */
import { chromium, type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const PROFILE_DIR = path.join(
  process.env.HOME || '/root',
  '.local/share/exam-wps-verify/chrome-profile',
);

function launch(headless: boolean) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  return chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chrome',           // 用系统 Chrome
    headless,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // 桌面会话的图形环境由 shell 传进来（DISPLAY/XAUTHORITY）
  });
}

/**
 * 判断是否已登录 kdocs。
 *
 * 双通道判断，因为单看 cookie 不可靠 —— 有些前端把会话放 localStorage，
 * 光看 cookie 会永远探不到"已经登录了"：
 *   ① cookie：有没有会话类 cookie
 *   ② 行为：页面上还有没有「登录」入口 / 有没有出现用户区
 */
async function loginState(ctx: BrowserContext, page: Page): Promise<{ logged: boolean; why: string }> {
  const cookies = await ctx.cookies('https://www.kdocs.cn').catch(() => []);
  const cookieHit = cookies.find(c => /sid|session|token|auth/i.test(c.name) && c.value.length > 10);
  if (cookieHit) return { logged: true, why: `cookie:${cookieHit.name}` };

  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 6000)).catch(() => '');
  const hasLoginEntry = /登录|立即登录|免费注册|扫码登录/.test(text);
  const hasUserArea = /我的文档|个人中心|退出登录|最近使用|共享给我/.test(text);
  if (hasUserArea && !hasLoginEntry) return { logged: true, why: '页面已出现用户区' };

  return { logged: false, why: hasLoginEntry ? '页面上仍有登录入口' : '未识别到登录态' };
}

async function login() {
  console.log(`profile: ${PROFILE_DIR}`);
  console.log('即将在桌面上打开浏览器窗口，请在窗口里完成 kdocs 登录……');
  const ctx = await launch(false);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://www.kdocs.cn/', { waitUntil: 'domcontentloaded' });

  // 跑满 8 分钟（比调用方超时留余量，免得被中途掐断导致 cookie 没落盘）；
  // 每 30 秒打一次状态，这样调用方可以读输出文件看进度，不用干等
  const deadline = Date.now() + 8 * 60 * 1000;
  let ok = false;
  let why = '';
  let lastLog = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await loginState(ctx, page);
    if (st.logged) { ok = true; why = st.why; break; }
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      console.log(`[${new Date().toLocaleTimeString('zh-CN')}] 等待登录中… 当前判断依据: ${st.why}`);
    }
  }

  if (ok) {
    // 给 cookie 一点落盘时间，再优雅关闭
    await new Promise(r => setTimeout(r, 2000));
    const proof = `/tmp/wps-login-proof.png`;
    await page.screenshot({ path: proof }).catch(() => undefined);
    console.log(`LOGIN_OK 检测到登录（依据: ${why}），登录态已存入 profile`);
    console.log(`截图: ${proof}`);
  } else {
    console.log('LOGIN_TIMEOUT 8 分钟内没检测到登录');
  }
  await ctx.close();
  process.exit(ok ? 0 : 2);
}

async function shot(url: string, out?: string) {
  const ctx = await launch(true);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000); // 等前端渲染完（kdocs 是 SPA）
  const file = out || `/tmp/wps-shot-${Date.now()}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log('已登录:', await looksLoggedIn(ctx));
  console.log('标题:', await page.title());
  console.log('当前地址:', page.url());
  console.log('截图:', file);
  await ctx.close();
}

async function dom(url: string, keyword?: string) {
  const ctx = await launch(true);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('已登录:', await looksLoggedIn(ctx));
  console.log('标题:', await page.title());
  console.log('当前地址:', page.url());

  const items = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>('button, [role="button"], [class*="toolbar"] *, [title]').forEach(el => {
      const t = (el.innerText || el.getAttribute('title') || '').trim();
      if (t && t.length < 20) out.push(t);
    });
    return Array.from(new Set(out));
  });
  const filtered = keyword ? items.filter(t => t.includes(keyword)) : items;
  console.log(`可点元素(${filtered.length}):`, filtered.slice(0, 80).join(' | '));
  await ctx.close();
}

const [cmd, arg1, arg2] = process.argv.slice(2);
const run = { login, shot, dom }[cmd as 'login' | 'shot' | 'dom'];
if (!run) {
  console.log('用法: tsx scripts/wps-browser.ts <login|shot|dom> [url] [额外参数]');
  process.exit(1);
}
(run as (a?: string, b?: string) => Promise<void>)(arg1, arg2).catch(e => {
  console.error('FAIL', e);
  process.exit(1);
});
