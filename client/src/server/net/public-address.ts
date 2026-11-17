// Adapted from dl-cms/cms/src/server/net/public-address.ts
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * Calls Dialed makes for people (APIs, docs pages) must not reach the private network or cloud metadata.
 * Addresses are checked as parsed IPs (so `::ffff:a9fe:a9fe` is caught), and the check runs inside the
 * connection's DNS lookup, so a hostname can't resolve to a public address for the check and a private one
 * for the request.
 */
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24], // 6to4 relays
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  // IPv4-mapped addresses (::ffff:a.b.c.d) need no rule: BlockList checks them against the IPv4 ranges above.
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32], // Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10], // site-local
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

const globals = globalThis as unknown as { __dialedAllowLoopback?: boolean };

/** Tests only: lets loopback through so a local test server can stand in for an API. */
export function allowLoopbackForTests(allow: boolean) {
  if (!process.env.VITEST) throw new Error('allowLoopbackForTests only works under Vitest.');
  globals.__dialedAllowLoopback = allow;
}

const loopbackAllowed = (ip: string) =>
  Boolean(process.env.VITEST && globals.__dialedAllowLoopback && (ip === '127.0.0.1' || ip === '::1'));

/** True for anything that isn't a public unicast address (including strings that aren't IPs). */
export function isPrivateAddress(ip: string) {
  const version = isIP(ip);
  if (!version) return true;
  if (loopbackAllowed(ip)) return false;
  return BLOCKED.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

export class PrivateAddressError extends Error {
  code = 'EPRIVATE';
  constructor() {
    super('The URL points to a private or local address.');
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function publicLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '');
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address)))
      return callback(new PrivateAddressError(), '');
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

let agent: Agent | undefined;

/** Pass as `dispatcher` to fetch: every connection's resolved address is checked before connecting. */
export function publicDispatcher() {
  agent ??= new Agent({ connect: { lookup: publicLookup as never } });
  return agent;
}

/** Throws PrivateAddressError for a host that is local or an IP that isn't public (DNS names are checked on connect). */
export function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !loopbackAllowed(host === 'localhost' ? '127.0.0.1' : host) &&
    (host === 'localhost' || host.endsWith('.localhost'))
  )
    throw new PrivateAddressError();
  if (isIP(host) && isPrivateAddress(host)) throw new PrivateAddressError();
}
