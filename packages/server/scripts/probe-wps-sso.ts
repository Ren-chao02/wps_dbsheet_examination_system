/**
 * WPS 账号 SSO 探针（只读，不写库）
 *
 * 用途：在真正启用登录页 WPS 入口前，验证三件事：
 *   1. 应用凭据/回调地址是否配置完整；
 *   2. 授权码能否换成用户 access_token；
 *   3. /v7/users/current 在 KSO-1 签名下能否读到用户身份。
 *
 * 用法（在 packages/server 目录下执行，读取当前 .env）：
 *   npx tsx scripts/probe-wps-sso.ts
 *     → 打印授权地址；浏览器打开、登录 WPS、同意授权
 *   npx tsx scripts/probe-wps-sso.ts --code=<回调地址里的 code>
 *     → 换 token 并读取用户信息（只打印 id/name/avatar，不打印 token）
 *
 * 注意：脚本不会调用 wpsConfigService.save()，不会覆盖多维表格全局 token。
 */
import { config } from '../src/config';
import { wpsSsoService } from '../src/services/wps-sso-service';

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function mask(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

async function main() {
  const enabled = await wpsSsoService.isEnabled();
  const credentials = await wpsSsoService.getCredentials();
  const redirectUri = wpsSsoService.getRedirectUri();

  console.log('WPS SSO 配置检查');
  console.log('  WPS_SSO_ENABLED :', config.wpsSso.enabled);
  console.log('  client_id       :', credentials.clientId ? mask(credentials.clientId) : '(空)');
  console.log('  client_secret   :', credentials.clientSecret ? '已配置' : '(空)');
  console.log('  redirect_uri    :', redirectUri || '(空，请配置 PUBLIC_BASE_URL 或 WPS_SSO_REDIRECT_URI)');
  console.log('  scope           :', config.wpsSso.scope);
  console.log('  isEnabled       :', enabled);

  if (!enabled) {
    console.log('\n当前不可用。请先设置 WPS_SSO_ENABLED=true，并补齐凭据/回调地址。');
    process.exitCode = 1;
    return;
  }

  const code = getArg('code');
  if (!code) {
    console.log('\n授权地址（浏览器打开并同意授权后，从回调地址复制 code）：');
    console.log(await wpsSsoService.buildAuthorizeUrl('probe-state'));
    console.log('\n然后执行：npx tsx scripts/probe-wps-sso.ts --code=<code>');
    return;
  }

  const accessToken = await wpsSsoService.exchangeCode(code.trim());
  console.log('\n授权码换 token：成功（token 不打印）');

  const profile = await wpsSsoService.fetchProfile(accessToken);
  console.log('读取 WPS 用户：成功');
  console.log('  wps id :', profile.id);
  console.log('  name   :', profile.name);
  console.log('  avatar :', profile.avatar ? '已返回' : '(空)');
  console.log('\n结论：SSO 授权链路可用。可以设置 WPS_SSO_ENABLED=true 并重启后端。');
}

main().catch((err) => {
  console.error('\n探针失败：', err?.message || err);
  console.error('排查顺序：scope 是否开通（user 类型）→ 回调地址是否完全一致 → 是否开启 KSO-1 接口签名。');
  process.exitCode = 1;
});
