import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  checkPort,
  checkPorts,
  InvalidInputError,
  MAX_PORTS_PER_RUN,
  summarize,
  allOpen,
} from '../src/index.js';
import {
  activeSockets,
  blackholeHost,
  closedPort,
  listen,
  settledSockets,
  supportsIPv6,
  unreachableHost,
} from './helpers.js';

const blackhole = await blackholeHost();
const unreachable = await unreachableHost();
const ipv6 = await supportsIPv6();
const REFUSAL_TIMEOUT_MS = 5000;
const SHORT_TIMEOUT_MS = 300;

describe('checkPort', () => {
  it('reports an open port with latency and the remote address', async () => {
    const server = await listen();
    const result = await checkPort('127.0.0.1', server.port, { timeoutMs: REFUSAL_TIMEOUT_MS });
    expect(result).toMatchObject({
      host: '127.0.0.1',
      port: server.port,
      status: 'open',
      address: '127.0.0.1',
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.latencyMs).toBeLessThan(REFUSAL_TIMEOUT_MS);
    expect(result).not.toHaveProperty('error');
  });

  it('closes its socket on the server side after an open check', async () => {
    const server = await listen();
    await checkPort('127.0.0.1', server.port);
    const [socket] = server.sockets;
    expect(socket).toBeDefined();
    if (socket !== undefined && !socket.destroyed) await once(socket, 'close');
    expect(server.connections()).toBe(1);
  });

  it('reports a closed port as closed with ECONNREFUSED', async () => {
    const port = await closedPort();
    const result = await checkPort('127.0.0.1', port, { timeoutMs: REFUSAL_TIMEOUT_MS });
    expect(result).toMatchObject({ status: 'closed', error: 'ECONNREFUSED', port });
  });

  it('resolves localhost and connects to a server bound to IPv4 only', async () => {
    const server = await listen();
    const result = await checkPort('localhost', server.port, { timeoutMs: REFUSAL_TIMEOUT_MS });
    expect(result.status).toBe('open');
    expect(result.host).toBe('localhost');
  });

  it('reports a name that does not exist as dns-error', async () => {
    const result = await checkPort('nonexistent.invalid', 80, { timeoutMs: REFUSAL_TIMEOUT_MS });
    expect(result.status).toBe('dns-error');
    expect(result.error).toMatch(/^(ENOTFOUND|EAI_AGAIN|EAI_FAIL|EAI_NODATA|EAI_NONAME)$/u);
  });

  it('forces the address family', async () => {
    const server = await listen();
    expect((await checkPort('127.0.0.1', server.port, { family: 4 })).status).toBe('open');
    await expect(checkPort('127.0.0.1', server.port, { family: 6 })).rejects.toThrow(
      /IPv4 address but IPv6/u,
    );
    await expect(checkPort('::1', server.port, { family: 4 })).rejects.toThrow(
      /IPv6 address but IPv4/u,
    );
  });

  it.skipIf(unreachable === undefined)(
    'reports an address without a route as unreachable (needs a host with no route to 100::1 or a Windows-style 0.0.0.0 refusal)',
    async () => {
      const result = await checkPort(unreachable ?? '', 81, { timeoutMs: REFUSAL_TIMEOUT_MS });
      expect(result.status).toBe('unreachable');
      expect(result.error).toMatch(/^(ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL)$/u);
    },
  );

  it.skipIf(blackhole === undefined)(
    'times out against an address that silently drops packets (needs 192.0.2.0/24 to be dropped, not rejected)',
    async () => {
      const baseline = activeSockets();
      const result = await checkPort(blackhole ?? '', 81, { timeoutMs: SHORT_TIMEOUT_MS });
      expect(result.status).toBe('timeout');
      expect(result.latencyMs).toBeGreaterThanOrEqual(SHORT_TIMEOUT_MS - 5);
      expect(result.latencyMs).toBeLessThan(SHORT_TIMEOUT_MS * 5);
      expect(await settledSockets(baseline)).toBeLessThanOrEqual(baseline);
    },
  );

  describe('input validation', () => {
    it.each([0, -1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '80', null, undefined])(
      'rejects port %j',
      async (port) => {
        await expect(checkPort('127.0.0.1', port as number)).rejects.toThrow(InvalidInputError);
      },
    );

    it.each([0, -5, 60_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', null])(
      'rejects timeout %j',
      async (timeoutMs) => {
        await expect(
          checkPort('127.0.0.1', 80, { timeoutMs: timeoutMs as number }),
        ).rejects.toThrow(/timeout must be/u);
      },
    );

    it('rejects an unknown family', async () => {
      await expect(checkPort('127.0.0.1', 80, { family: 5 as 4 })).rejects.toThrow(
        /family must be 4 or 6/u,
      );
    });

    it('rejects an invalid host before opening any socket', async () => {
      const baseline = activeSockets();
      await expect(checkPort('bad host', 80)).rejects.toThrow(InvalidInputError);
      expect(activeSockets()).toBe(baseline);
    });
  });

  describe('cancellation', () => {
    it('rejects immediately for an already aborted signal without connecting', async () => {
      const server = await listen();
      const controller = new AbortController();
      controller.abort();
      await expect(
        checkPort('127.0.0.1', server.port, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(server.connections()).toBe(0);
    });

    it('preserves a custom abort reason', async () => {
      const controller = new AbortController();
      const reason = new Error('stop now');
      controller.abort(reason);
      await expect(checkPort('127.0.0.1', 80, { signal: controller.signal })).rejects.toBe(reason);
    });

    it.skipIf(blackhole === undefined)(
      'aborts a pending connection and destroys the socket (needs a packet-dropping address)',
      async () => {
        const baseline = activeSockets();
        const controller = new AbortController();
        const pending = checkPort(blackhole ?? '', 81, {
          timeoutMs: REFUSAL_TIMEOUT_MS,
          signal: controller.signal,
        });
        setTimeout(() => {
          controller.abort();
        }, 50);
        const started = Date.now();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(Date.now() - started).toBeLessThan(REFUSAL_TIMEOUT_MS / 2);
        expect(await settledSockets(baseline)).toBeLessThanOrEqual(baseline);
      },
    );
  });
});

describe('checkPorts', () => {
  it('returns results in input order for mixed open and closed ports', async () => {
    const first = await listen();
    const second = await listen();
    const closed = await closedPort();
    const results = await checkPorts('127.0.0.1', [second.port, closed, first.port], {
      timeoutMs: REFUSAL_TIMEOUT_MS,
    });
    expect(results.map((result) => [result.port, result.status])).toEqual([
      [second.port, 'open'],
      [closed, 'closed'],
      [first.port, 'open'],
    ]);
    expect(summarize(results)).toEqual({
      open: 2,
      closed: 1,
      timeout: 0,
      unreachable: 0,
      'dns-error': 0,
    });
    expect(allOpen(results)).toBe(false);
  });

  it('handles many ports with a small concurrency limit', async () => {
    const server = await listen();
    const ports = Array.from({ length: 200 }, () => server.port);
    const results = await checkPorts('127.0.0.1', ports, { concurrency: 3 });
    expect(results).toHaveLength(ports.length);
    expect(allOpen(results)).toBe(true);
    expect(server.connections()).toBe(ports.length);
  });

  it('accepts a concurrency larger than the number of ports', async () => {
    const server = await listen();
    const results = await checkPorts('127.0.0.1', [server.port], { concurrency: 256 });
    expect(results).toHaveLength(1);
  });

  it('rejects invalid input before opening any connection', async () => {
    const server = await listen();
    const baseline = activeSockets();
    const rejects = async (ports: readonly number[], concurrency?: number) => {
      await expect(
        checkPorts('127.0.0.1', ports, concurrency === undefined ? {} : { concurrency }),
      ).rejects.toThrow(InvalidInputError);
    };
    await rejects([]);
    await rejects([server.port, 0]);
    await rejects([server.port, 70000]);
    await rejects([server.port], 0);
    await rejects([server.port], 257);
    await rejects([server.port], 1.5);
    await rejects([server.port], Number.NaN);
    await rejects(Array.from({ length: MAX_PORTS_PER_RUN + 1 }, () => server.port));
    await expect(checkPorts('127.0.0.1', 'nope' as unknown as number[])).rejects.toThrow(
      InvalidInputError,
    );
    expect(server.connections()).toBe(0);
    expect(activeSockets()).toBe(baseline);
  });

  it('rejects when the signal is already aborted', async () => {
    const server = await listen();
    const controller = new AbortController();
    controller.abort();
    await expect(
      checkPorts('127.0.0.1', [server.port, server.port], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.connections()).toBe(0);
  });

  it.skipIf(blackhole === undefined)(
    'never runs more checks at once than the concurrency limit (needs a packet-dropping address)',
    async () => {
      const ports = [81, 82, 83, 84];
      const timed = async (concurrency: number) => {
        const started = Date.now();
        const results = await checkPorts(blackhole ?? '', ports, {
          timeoutMs: SHORT_TIMEOUT_MS,
          concurrency,
        });
        expect(results.every((result) => result.status === 'timeout')).toBe(true);
        return Date.now() - started;
      };
      expect(await timed(1)).toBeGreaterThanOrEqual(ports.length * SHORT_TIMEOUT_MS - 20);
      expect(await timed(2)).toBeGreaterThanOrEqual((ports.length / 2) * SHORT_TIMEOUT_MS - 20);
      expect(await timed(ports.length)).toBeLessThan(ports.length * SHORT_TIMEOUT_MS - 20);
    },
  );

  it.skipIf(blackhole === undefined)(
    'aborts every pending check and leaves no sockets behind (needs a packet-dropping address)',
    async () => {
      const baseline = activeSockets();
      const controller = new AbortController();
      const pending = checkPorts(blackhole ?? '', [81, 82, 83, 84, 85, 86], {
        timeoutMs: REFUSAL_TIMEOUT_MS,
        concurrency: 3,
        signal: controller.signal,
      });
      setTimeout(() => {
        controller.abort();
      }, 50);
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(await settledSockets(baseline)).toBeLessThanOrEqual(baseline);
    },
  );
});

describe.skipIf(!ipv6)('IPv6 loopback (runs only when this host can bind ::1)', () => {
  it('connects to an IPv6 literal, bracketed or not', async () => {
    const server = await listen('::1');
    const plain = await checkPort('::1', server.port);
    const bracketed = await checkPort('[::1]', server.port);
    expect(plain).toMatchObject({ host: '::1', status: 'open', address: '::1' });
    expect(bracketed).toMatchObject({ host: '::1', status: 'open' });
  });

  it('finds an IPv6-only server when IPv6 is forced on localhost', async () => {
    const server = await listen('::1');
    const result = await checkPort('localhost', server.port, { family: 6 });
    expect(result.status).toBe('open');
  });

  it('does not see an IPv6-only server over IPv4', async () => {
    const server = await listen('::1');
    const result = await checkPort('127.0.0.1', server.port, { timeoutMs: REFUSAL_TIMEOUT_MS });
    expect(result.status).toBe('closed');
  });

  it('reports a closed IPv6 port', async () => {
    const port = await closedPort('::1');
    const result = await checkPort('::1', port, { timeoutMs: REFUSAL_TIMEOUT_MS });
    expect(result.status).toBe('closed');
  });
});
