/**
 * 从「邀请链接 / 路径 / 纯邀请码」里提取邀请码。
 *
 * 邀请码由服务端 nanoid(8) 生成，字符集为 A-Za-z0-9_-；
 * 这里放宽到 6~32 位，兼容以后调整长度，同时避免把普通文字误判成邀请码。
 */
export function extractInvitationCode(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const fromPath = raw.match(/\/join\/([A-Za-z0-9_-]{6,32})(?:[/?#]|$)/);
  if (fromPath) return fromPath[1];

  if (/^[A-Za-z0-9_-]{6,32}$/.test(raw)) return raw;

  return null;
}
