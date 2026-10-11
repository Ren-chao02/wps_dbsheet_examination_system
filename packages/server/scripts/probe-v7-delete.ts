/**
 * 只读/探测 v7 sheet 删除接口形态：一律使用不存在的 sheetId(99999999)，
 * 不会删除任何真实数据；通过返回错误类型识别正确路由与权限。
 * 运行：cd packages/server && npx tsx scripts/probe-v7-delete.ts
 */
import { prisma } from '../src/config/prisma';
import { KingsoftAdapter } from '../src/engine/adapters/kingsoft-adapter';

const BASE = 'https://openapi.wps.cn/v7/coop/dbsheet';

async function call(label: string, url: string, method: string, body?: any) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`[${Date.now() - started}ms] ${label} -> ${res.status} ${text.slice(0, 300)}`);
  } catch (e: any) {
    console.log(`[${Date.now() - started}ms] ${label} -> FETCH-ERR ${String(e.message).slice(0, 200)}`);
  }
}

let TOKEN = '';

async function main() {
  const cfg = await prisma.wpsConfig.findUnique({ where: { id: 'wps_config' } });
  const row = await prisma.practiceTableAssignment.findFirst();
  if (!cfg?.accessToken || !row) {
    console.log('缺少 token 或练习分配，退出');
    return;
  }
  TOKEN = cfg.accessToken;
  const fileId = row.fileId;
  console.log(`fileId=${fileId} token=已加载(len=${TOKEN.length})`); // 不打印凭据片段

  // GET 列表形态（只读，安全）
  await call('GET /sheets (list)', `${BASE}/${fileId}/sheets`, 'GET');
  await call('GET /sheets?id=…', `${BASE}/${fileId}/sheets?id=99999999`, 'GET');

  // 删除候选：bogus sheetId=99999999
  await call('DELETE /sheets/99999999', `${BASE}/${fileId}/sheets/99999999`, 'DELETE');
  await call('DELETE /sheet/99999999', `${BASE}/${fileId}/sheet/99999999`, 'DELETE');
  await call('DELETE /sheets?id=99999999', `${BASE}/${fileId}/sheets?id=99999999`, 'DELETE');
  await call('POST /sheets/delete {sheetId}', `${BASE}/${fileId}/sheets/delete`, 'POST', { sheetId: 99999999 });
  await call('POST /sheets/99999999/delete', `${BASE}/${fileId}/sheets/99999999/delete`, 'POST');
  await call('DELETE /sheets/delete?sheetId=…', `${BASE}/${fileId}/sheets/delete?sheetId=99999999`, 'DELETE');
  await call('DELETE /sheets/99999999?force', `${BASE}/${fileId}/sheets/99999999?force=true`, 'DELETE');

  // 走适配器新 deleteSheet 代码路径验证（bogus id，安全）
  const adapter = new KingsoftAdapter(fileId, TOKEN, undefined, 'v7');
  try {
    await adapter.deleteSheet(99999999);
    console.log('adapter.deleteSheet(bogus): OK（意外，说明 99999999 被删了？）');
  } catch (e: any) {
    console.log(`adapter.deleteSheet(bogus) err: ${String(e.message).slice(0, 200)}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
