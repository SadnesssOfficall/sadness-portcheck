import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blackholeHost, cli, closedPort, listen, supportsIPv6 } from './helpers.js';

const blackhole = await blackholeHost();
const ipv6 = await supportsIPv6();
const REFUSAL_TIMEOUT = '5000';
const ESCAPE = '\u001b';

interface JsonReport {
  host: string;
  ok: boolean;
  summary: Record<string, number>;
  results: { host: string; port: number; status: string; latencyMs: number; address?: string }[];
}

describe('top level', () => {
  it('prints help and exits 0', async () => {
    const result = await cli(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('sadness-portcheck <host>');
    expect(result.stderr).toBe('');
  });

  it('prints help for -h even next to other arguments', async () => {
    expect((await cli(['localhost', '80', '-h'])).code).toBe(0);
  });

  it('prints the package version', async () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const result = await cli(['--version']);
    expect(result.stdout).toBe(`${manifest.version}\n`);
    expect(result.code).toBe(0);
  });

  it('exits 2 with usage when called without arguments', async () => {
    const result = await cli([]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Usage:');
    expect(result.stdout).toBe('');
  });
});

describe('checking ports', () => {
  it('exits 0 when every port is open', async () => {
    const first = await listen();
    const second = await listen();
    const result = await cli(['127.0.0.1', String(first.port), String(second.port)]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`127.0.0.1:${first.port}`);
    expect(result.stdout).toContain(`127.0.0.1:${second.port}`);
    expect(result.stdout.trimEnd().split('\n').at(-1)).toBe('2 open');
    expect(result.stderr).toBe('');
  });

  it('exits 1 when at least one port is closed', async () => {
    const server = await listen();
    const closed = await closedPort();
    const result = await cli([
      '127.0.0.1',
      String(server.port),
      String(closed),
      '--timeout',
      REFUSAL_TIMEOUT,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      new RegExp(`:${closed}\\s+closed\\s+[\\d.]+ ms\\s+ECONNREFUSED`, 'u'),
    );
    expect(result.stdout.trimEnd().split('\n').at(-1)).toBe('1 open, 1 closed');
  });

  it('aligns columns and shows the address of open ports', async () => {
    const server = await listen();
    const result = await cli(['127.0.0.1', String(server.port)]);
    expect(result.stdout).toMatch(
      new RegExp(
        `^127\\.0\\.0\\.1:${server.port}  open {9}[\\d.]+ ms  127\\.0\\.0\\.1\\n1 open\\n$`,
        'u',
      ),
    );
  });

  it('exits 1 for a host that does not resolve', async () => {
    const result = await cli(['nonexistent.invalid', '80', '-t', REFUSAL_TIMEOUT]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('dns-error');
  });

  it('expands ranges and comma lists', async () => {
    const server = await listen();
    const result = await cli([
      '--json',
      '-t',
      REFUSAL_TIMEOUT,
      '127.0.0.1',
      `${server.port}`,
      `${server.port},${server.port}`,
    ]);
    const report = JSON.parse(result.stdout) as JsonReport;
    expect(report.results).toHaveLength(1);

    const range = await cli(['--json', '-t', REFUSAL_TIMEOUT, '127.0.0.1', '1-3']);
    expect((JSON.parse(range.stdout) as JsonReport).results.map((r) => r.port)).toEqual([1, 2, 3]);
  });

  it('accepts short options and a free-standing option order', async () => {
    const server = await listen();
    const result = await cli([
      '-c',
      '1',
      '-t',
      REFUSAL_TIMEOUT,
      '-4',
      '127.0.0.1',
      String(server.port),
    ]);
    expect(result.code).toBe(0);
  });

  it('treats everything after -- as positional', async () => {
    const server = await listen();
    const result = await cli(['--', '127.0.0.1', String(server.port)]);
    expect(result.code).toBe(0);
  });
});

describe('json output', () => {
  it('prints a stable report', async () => {
    const server = await listen();
    const closed = await closedPort();
    const result = await cli([
      '127.0.0.1',
      String(server.port),
      String(closed),
      '--json',
      '-t',
      REFUSAL_TIMEOUT,
    ]);
    const report = JSON.parse(result.stdout) as JsonReport;
    expect(result.code).toBe(1);
    expect(report.host).toBe('127.0.0.1');
    expect(report.ok).toBe(false);
    expect(report.summary).toEqual({
      open: 1,
      closed: 1,
      timeout: 0,
      unreachable: 0,
      'dns-error': 0,
    });
    expect(report.results[0]).toMatchObject({
      port: server.port,
      status: 'open',
      address: '127.0.0.1',
    });
    expect(report.results[1]).toMatchObject({
      port: closed,
      status: 'closed',
      error: 'ECONNREFUSED',
    });
    expect(typeof report.results[0]?.latencyMs).toBe('number');
  });

  it('reports ok for all-open results and never contains colour codes', async () => {
    const server = await listen();
    const result = await cli(['127.0.0.1', String(server.port), '--json'], { tty: true });
    expect(result.code).toBe(0);
    expect((JSON.parse(result.stdout) as JsonReport).ok).toBe(true);
    expect(result.stdout).not.toContain(ESCAPE);
  });
});

describe('colour', () => {
  it('colours output on a TTY', async () => {
    const server = await listen();
    const result = await cli(['127.0.0.1', String(server.port)], { tty: true });
    expect(result.stdout).toContain(`${ESCAPE}[32mopen`);
  });

  it('stays plain when stdout is not a TTY', async () => {
    const server = await listen();
    expect((await cli(['127.0.0.1', String(server.port)], { tty: false })).stdout).not.toContain(
      ESCAPE,
    );
  });

  it('honours NO_COLOR', async () => {
    const server = await listen();
    const result = await cli(['127.0.0.1', String(server.port)], {
      tty: true,
      env: { NO_COLOR: '1' },
    });
    expect(result.stdout).not.toContain(ESCAPE);
  });

  it('ignores an empty NO_COLOR as the specification asks', async () => {
    const server = await listen();
    const result = await cli(['127.0.0.1', String(server.port)], {
      tty: true,
      env: { NO_COLOR: '' },
    });
    expect(result.stdout).toContain(ESCAPE);
  });

  it('stays plain for TERM=dumb', async () => {
    const server = await listen();
    const result = await cli(['127.0.0.1', String(server.port)], {
      tty: true,
      env: { TERM: 'dumb' },
    });
    expect(result.stdout).not.toContain(ESCAPE);
  });
});

describe('usage errors', () => {
  const failing: [string, string[], RegExp][] = [
    ['missing host', ['--json'], /missing host/u],
    ['missing ports', ['localhost'], /at least one port/u],
    ['port zero', ['localhost', '0'], /invalid port|between 1 and 65535/u],
    ['port too large', ['localhost', '65536'], /between 1 and 65535/u],
    ['non-numeric port', ['localhost', 'http'], /invalid port/u],
    ['reversed range', ['localhost', '8010-8000'], /reversed/u],
    ['range too wide', ['localhost', '1-65535'], /at most 1024/u],
    ['bad host', ['bad host', '80'], /invalid host/u],
    ['host with shell syntax', ['host;rm', '80'], /invalid host/u],
    ['URL instead of host', ['http://example.com', '80'], /invalid host/u],
    ['numeric shorthand host', ['127.1', '80'], /ambiguous numeric host/u],
    ['both families', ['-4', '-6', 'localhost', '80'], /cannot be used together/u],
    ['IPv6 literal with -4', ['-4', '::1', '80'], /IPv6 address but IPv4/u],
    ['IPv4 literal with -6', ['-6', '127.0.0.1', '80'], /IPv4 address but IPv6/u],
    ['non-numeric timeout', ['-t', 'abc', 'localhost', '80'], /timeout must be a whole number/u],
    ['negative timeout', ['-t', '-5', 'localhost', '80'], /./u],
    [
      'zero timeout',
      ['-t', '0', 'localhost', '80'],
      /timeout must be an integer between 1 and 60000/u,
    ],
    ['huge timeout', ['-t', '60001', 'localhost', '80'], /timeout must be an integer/u],
    ['fractional timeout', ['-t', '1.5', 'localhost', '80'], /whole number/u],
    [
      'zero concurrency',
      ['-c', '0', 'localhost', '80'],
      /concurrency must be an integer between 1 and 256/u,
    ],
    ['huge concurrency', ['-c', '257', 'localhost', '80'], /concurrency must be an integer/u],
    ['unknown option', ['--nope', 'localhost', '80'], /nope/u],
    ['option without value', ['localhost', '80', '--timeout'], /timeout/u],
  ];

  it.each(failing)('exits 2 for %s', async (_name, args, message) => {
    const result = await cli(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(message);
    expect(result.stderr.startsWith('sadness-portcheck: ')).toBe(true);
  });

  it('never echoes terminal escape sequences from arguments', async () => {
    const hostile = `${ESCAPE}[2J${ESCAPE}]0;owned\u0007`;
    for (const args of [
      [hostile, '80'],
      ['localhost', hostile],
      ['-t', hostile, 'localhost', '80'],
    ]) {
      const result = await cli(args);
      expect(result.code).toBe(2);
      expect(result.stderr).not.toContain(ESCAPE);
      expect(result.stderr).not.toContain('\u0007');
    }
  });
});

describe('interruption', () => {
  it('exits 130 and prints nothing to stdout when already interrupted', async () => {
    const server = await listen();
    const controller = new AbortController();
    controller.abort();
    const result = await cli(['127.0.0.1', String(server.port)], { signal: controller.signal });
    expect(result.code).toBe(130);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('sadness-portcheck: interrupted\n');
    expect(server.connections()).toBe(0);
  });

  it.skipIf(blackhole === undefined)(
    'exits 130 when interrupted while checks are pending (needs a packet-dropping address)',
    async () => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, 50);
      const started = Date.now();
      const result = await cli([blackhole ?? '', '81-90', '-t', '10000'], {
        signal: controller.signal,
      });
      expect(result.code).toBe(130);
      expect(result.stdout).toBe('');
      expect(Date.now() - started).toBeLessThan(5000);
    },
  );
});

describe.skipIf(!ipv6)('IPv6 (runs only when this host can bind ::1)', () => {
  it('checks bracketed and plain IPv6 literals and prints them bracketed', async () => {
    const server = await listen('::1');
    for (const host of ['[::1]', '::1']) {
      const result = await cli([host, String(server.port)]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`[::1]:${server.port}`);
    }
  });

  it('honours -6 for localhost', async () => {
    const server = await listen('::1');
    const result = await cli(['-6', 'localhost', String(server.port)]);
    expect(result.code).toBe(0);
  });
});
