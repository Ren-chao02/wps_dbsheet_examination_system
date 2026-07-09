/**
 * IP 白名单工具（支持 IPv4 CIDR，如 192.168.1.0/24）
 */

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

function isValidIPv4(ip: string): boolean {
  if (!IPV4_REGEX.test(ip)) return false;
  const parts = ip.split('.').map(Number);
  return parts.every((n) => n >= 0 && n <= 255);
}

function isValidCidr(cidr: string): boolean {
  const [ip, prefix] = cidr.split('/');
  if (!isValidIPv4(ip)) return false;
  if (prefix === undefined) return true; // 单个 IP 也视为 /32
  const p = Number(prefix);
  return Number.isInteger(p) && p >= 0 && p <= 32;
}

/**
 * 判断 IP 是否在 CIDR 范围内
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  if (!isValidIPv4(ip) || !isValidCidr(cidr)) return false;

  const [network, prefixStr] = cidr.split('/');
  const prefix = prefixStr === undefined ? 32 : Number(prefixStr);

  const ipLong = ipToLong(ip);
  const networkLong = ipToLong(network);

  const mask = prefix === 0 ? 0 : 0xffffffff << (32 - prefix);
  return (ipLong & mask) === (networkLong & mask);
}

/**
 * 判断 IP 是否被允许（任一白名单项匹配即通过）
 */
export function isIpAllowed(ip: string, allowedIps: string[]): boolean {
  if (!allowedIps || allowedIps.length === 0) return true;
  return allowedIps.some((cidr) => isIpInCidr(ip, cidr));
}

/**
 * 校验 CIDR 列表是否全部合法
 */
export function validateCidrList(list: string[]): { valid: boolean; invalid: string[] } {
  const invalid = list.filter((item) => !isValidCidr(item));
  return { valid: invalid.length === 0, invalid };
}
