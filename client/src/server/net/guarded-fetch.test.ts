import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedFetch } from './guarded-fetch';
import { allowLoopbackForTests, isPrivateAddress } from './public-address';

let server: Server;
let base = '';
const seen: { path: string; headers: Record<string, unknown>; method: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ path: req.url ?? '', headers: req.headers, method: req.method ?? '' });
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/json') return res.end(JSON.stringify({ ok: true }));
    if (url.pathname === '/big') return res.end('x'.repeat(2048));
    if (url.pathname === '/slow') return void setTimeout(() => res.end('late'), 500);
    if (url.pathname === '/hop') {
      const n = Number(url.searchParams.get('n') ?? 0);
      res.writeHead(302, { location: n > 0 ? `/hop?n=${n - 1}` : '/json' });
      return res.end();
    }
    if (url.pathname === '/to-other-host') {
      // localhost is a different host string from 127.0.0.1, so credentials must be dropped.
      res.writeHead(307, { location: `http://localhost:${(server.address() as AddressInfo).port}/json` });
      return res.end();
    }
    if (url.pathname === '/to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
      return res.end();
    }
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  allowLoopbackForTests(false);
  server.close();
});

describe('guard', () => {
  it('knows private addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fe80::1',
      '::ffff:169.254.169.254',
      'nope',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('refuses private, local and non-http addresses', async () => {
    allowLoopbackForTests(false);
    await expect(guardedFetch(`${base}/json`)).rejects.toMatchObject({ code: 'private_address' });
    await expect(guardedFetch('http://localhost/x')).rejects.toMatchObject({ code: 'private_address' });
    await expect(guardedFetch('http://[::1]/x')).rejects.toMatchObject({ code: 'private_address' });
    await expect(guardedFetch('http://169.254.169.254/latest')).rejects.toMatchObject({ code: 'private_address' });
    await expect(guardedFetch('ftp://example.com/x')).rejects.toMatchObject({ code: 'bad_url' });
    await expect(guardedFetch('file:///etc/passwd')).rejects.toMatchObject({ code: 'bad_url' });
    await expect(guardedFetch('https://user:pw@example.com')).rejects.toMatchObject({ code: 'bad_url' });
  });

  describe('with a local stand-in API', () => {
    beforeAll(() => allowLoopbackForTests(true));

    it('reads JSON and times the call', async () => {
      const res = await guardedFetch(`${base}/json`);
      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(res.ms).toBeGreaterThanOrEqual(0);
    });

    it('caps the size and the time', async () => {
      await expect(guardedFetch(`${base}/big`, {}, { maxBytes: 1024 })).rejects.toMatchObject({ code: 'too_large' });
      await expect(guardedFetch(`${base}/slow`, {}, { timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' });
    });

    it('follows up to 3 redirects, checking each', async () => {
      const ok = await guardedFetch(`${base}/hop?n=2`);
      expect(ok.redirects).toBe(3);
      expect(ok.json()).toEqual({ ok: true });
      await expect(guardedFetch(`${base}/hop?n=3`)).rejects.toMatchObject({ code: 'too_many_redirects' });
      await expect(guardedFetch(`${base}/to-metadata`)).rejects.toMatchObject({ code: 'private_address' });
    });

    it('drops keys when a redirect leaves the first host', async () => {
      seen.length = 0;
      await guardedFetch(
        `${base}/to-other-host`,
        { headers: { apikey: 'secret-key', authorization: 'Bearer x', accept: 'application/json' } },
        { secretHeaders: ['apikey'] },
      );
      const last = seen[seen.length - 1];
      expect(last.path).toBe('/json');
      expect(last.headers.apikey).toBeUndefined();
      expect(last.headers.authorization).toBeUndefined();
      expect(last.headers.accept).toBe('application/json');
    });
  });
});
