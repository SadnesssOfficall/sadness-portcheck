import { connect, createServer, type Server, type Socket } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach } from 'vitest';
import { run } from '../src/cli/main.js';

const PROBE_TIMEOUT_MS = 500;
const SETTLE_TIMEOUT_MS = 2000;
const SETTLE_STEP_MS = 20;
const BLACKHOLE_CANDIDATES = ['192.0.2.1', '198.51.100.1', '203.0.113.1'];
const UNREACHABLE_CANDIDATES = ['100::1', '0.0.0.0'];
const UNREACHABLE_CODES = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL']);

export interface TestServer {
  port: number;
  connections: () => number;
  sockets: Socket[];
}

const servers: { server: Server; sockets: Socket[] }[] = [];

afterEach(async () => {
  for (const { server, sockets } of servers.splice(0)) {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
});

export async function listen(host = '127.0.0.1'): Promise<TestServer> {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  servers.push({ server, sockets });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server has no port');
  return { port: address.port, connections: () => sockets.length, sockets };
}

export async function closedPort(host = '127.0.0.1'): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server has no port');
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return address.port;
}

export async function supportsIPv6(): Promise<boolean> {
  const server = createServer();
  return new Promise<boolean>((resolve) => {
    server.once('error', () => {
      resolve(false);
    });
    server.listen(0, '::1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

function rawConnect(host: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: 81 });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve('TIMEOUT');
    }, PROBE_TIMEOUT_MS);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve('CONNECTED');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(error.code ?? 'UNKNOWN');
    });
  });
}

let blackhole: Promise<string | undefined> | undefined;
let unreachable: Promise<string | undefined> | undefined;

async function firstMatching(
  candidates: readonly string[],
  accepts: (outcome: string) => boolean,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (accepts(await rawConnect(candidate))) return candidate;
  }
  return undefined;
}

export function blackholeHost(): Promise<string | undefined> {
  blackhole ??= firstMatching(BLACKHOLE_CANDIDATES, (outcome) => outcome === 'TIMEOUT');
  return blackhole;
}

export function unreachableHost(): Promise<string | undefined> {
  unreachable ??= firstMatching(UNREACHABLE_CANDIDATES, (outcome) =>
    UNREACHABLE_CODES.has(outcome),
  );
  return unreachable;
}

export function activeSockets(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'TCPSocketWrap').length;
}

export async function settledSockets(baseline: number): Promise<number> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (activeSockets() > baseline && Date.now() < deadline) await sleep(SETTLE_STEP_MS);
  return activeSockets();
}

export interface CliOptions {
  env?: Record<string, string>;
  tty?: boolean;
  signal?: AbortSignal;
}

export async function cli(args: string[], options: CliOptions = {}) {
  let stdout = '';
  let stderr = '';
  const code = await run(
    args,
    {
      stdout: {
        write: (text) => (stdout += text),
        isTTY: options.tty ?? false,
      },
      stderr: { write: (text) => (stderr += text) },
      env: options.env ?? {},
    },
    options.signal,
  );
  return { code, stdout, stderr };
}
