import dns from 'node:dns/promises';
import net from 'node:net';
import { AppError, forbidden } from '../util/errors.js';

/** 判断 IPv4/IPv6 是否属于内网、回环、链路本地等敏感网段 */
export function isPrivateAddress(ip) {
  if (!ip) return true;
  const v = ip.replace(/^\[|\]$/g, '');
  if (net.isIPv4(v)) {
    const p = v.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;            // link-local / 云元数据
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    if (a >= 224) return true;                          // 组播 / 保留
    return false;
  }
  if (net.isIPv6(v)) {
    const low = v.toLowerCase();
    if (low === '::' || low === '::1') return true;
    if (low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')) return true;
    if (low.startsWith('::ffff:')) return isPrivateAddress(low.slice(7));
    if (low.startsWith('64:ff9b')) return true;
    if (low.startsWith('2001:db8')) return true;
    return false;
  }
  return true;
}

const LOCAL_NAMES = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback',
  'metadata', 'metadata.google.internal', 'instance-data',
]);

/**
 * 校验目标主机允许被抓取。
 * 防 SSRF：解析 DNS 后逐个校验 IP，含 DNS 重绑定初筛。
 */
export async function assertHostAllowed(hostname, security, resolve = dns.lookup) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');

  if (security.denyHosts?.some((d) => host === d.toLowerCase() || host.endsWith('.' + d.toLowerCase()))) {
    throw forbidden(`目标主机在黑名单中: ${host}`);
  }
  if (security.allowHosts?.length) {
    const ok = security.allowHosts.some((d) => {
      const x = d.toLowerCase();
      return host === x || host.endsWith('.' + x);
    });
    if (!ok) throw forbidden(`目标主机不在白名单中: ${host}`);
  }
  if (!security.blockPrivateNetworks) return { host, addresses: [] };

  if (LOCAL_NAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new AppError('blocked_private_address', `禁止抓取本机/内网主机: ${host}（如为测试需要，设置 SEO2API_ALLOW_PRIVATE=1）`, 403);
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new AppError('blocked_private_address', `禁止抓取内网地址: ${host}（如为测试需要，设置 SEO2API_ALLOW_PRIVATE=1）`, 403);
    }
    return { host, addresses: [host] };
  }
  // 单段主机名（如 intranet）一律拒绝
  if (!host.includes('.')) {
    throw new AppError('blocked_private_address', `主机名不完整，拒绝抓取: ${host}（需为完整域名或 IP）`, 403);
  }

  let records;
  try {
    records = await resolve(host, { all: true, verbatim: true });
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'ENODATA') {
      throw new AppError('dns_error', `域名无法解析: ${host}`, 502);
    }
    throw forbidden(`DNS 解析失败: ${host} (${err.code || err.message})`);
  }
  const list = Array.isArray(records) ? records : [records];
  if (!list.length) throw new AppError('dns_error', `域名无 DNS 记录: ${host}`, 502);
  const bad = list.find((r) => isPrivateAddress(r.address));
  if (bad) {
    // 这个拒绝经常是 DNS 环境问题（代理/VPN 把公网域名解析成保留地址），
    // 所以错误信息要给出可操作的指引，而不是只说"拒绝"。
    throw new AppError(
      'blocked_private_address',
      `${host} 解析到非公网地址 ${bad.address}，已拒绝抓取。若这是 DNS 代理或 VPN 造成的误判，可设置 SEO2API_ALLOW_PRIVATE=1 关闭该防护。`,
      403,
      { host, address: bad.address, addresses: list.map((r) => r.address) }
    );
  }
  return { host, addresses: list.map((r) => r.address) };
}
