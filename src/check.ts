import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';
import { InvalidInputError } from './errors.js';
import { normalizeHost, type IpFamily, type NormalizedHost } from './host.js';
import { LATENCY_DECIMALS, MAX_PORTS_PER_RUN } from './limits.js';
import { resolveConcurrency, resolveFamily, resolvePort, resolveTimeout } from './options.js';

export type PortStatus = 'open' | 'closed' | 'timeout' | 'unreachable' | 'dns-error';

export interface PortResult {
  host: string;
  port: number;
  status: PortStatus;
  latencyMs: number;
  address?: string;
  error?: string;
}

export interface CheckOptions {
  timeoutMs?: number;
  family?: IpFamily;
  signal?: AbortSignal;
}

export interface CheckPortsOptions extends CheckOptions {
  concurrency?: number;
}

interface Target {
  host: string;
  port: number;
  family: IpFamily | undefined;
}

type Outcome = Pick<PortResult, 'status' | 'address' | 'error'>;

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA', 'EAI_NONAME']);
const UNKNOWN_CODE = 'UNKNOWN';

function errorCode(error: Error): string {
  const { code } = error as NodeJS.ErrnoException;
  if (typeof code === 'string') return code;
  if (error instanceof AggregateError) {
    const inner = error.errors.find((item): item is NodeJS.ErrnoException => item instanceof Error);
    if (inner !== undefined) return errorCode(inner);
  }
  return UNKNOWN_CODE;
}

function classify(error: Error): Outcome {
  const code = errorCode(error);
  if (code === 'ECONNREFUSED') return { status: 'closed', error: code };
  if (code === 'ETIMEDOUT') return { status: 'timeout', error: code };
  if (DNS_CODES.has(code)) return { status: 'dns-error', error: code };
  return { status: 'unreachable', error: code };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
}

function roundLatency(milliseconds: number): number {
  return Number(milliseconds.toFixed(LATENCY_DECIMALS));
}

function probe(target: Target, timeoutMs: number, signal: AbortSignal | undefined) {
  return new Promise<PortResult>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError(signal));
      return;
    }
    const started = performance.now();
    const socket = connect({ host: target.host, port: target.port, family: target.family });
    let settled = false;

    const release = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket.destroy();
      return true;
    };
    const finish = (outcome: Outcome): void => {
      const latencyMs = roundLatency(performance.now() - started);
      if (!release()) return;
      const { address, error } = outcome;
      resolve({
        host: target.host,
        port: target.port,
        status: outcome.status,
        latencyMs,
        ...(address === undefined ? {} : { address }),
        ...(error === undefined ? {} : { error }),
      });
    };
    const onAbort = (): void => {
      if (signal !== undefined && release()) reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      finish({ status: 'timeout' });
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort, { once: true });
    socket.on('connect', () => {
      finish({ status: 'open', address: socket.remoteAddress });
    });
    socket.on('error', (error) => {
      finish(classify(error));
    });
  });
}

function toTarget(host: NormalizedHost, port: unknown, family: IpFamily | undefined): Target {
  return { host: host.name, port: resolvePort(port), family };
}

export async function checkPort(
  host: string,
  port: number,
  options: CheckOptions = {},
): Promise<PortResult> {
  const normalized = normalizeHost(host);
  const target = toTarget(normalized, port, resolveFamily(normalized, options.family));
  return probe(target, resolveTimeout(options.timeoutMs), options.signal);
}

export async function checkPorts(
  host: string,
  ports: readonly number[],
  options: CheckPortsOptions = {},
): Promise<PortResult[]> {
  const normalized = normalizeHost(host);
  const family = resolveFamily(normalized, options.family);
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const concurrency = resolveConcurrency(options.concurrency);
  if (!Array.isArray(ports) || ports.length === 0 || ports.length > MAX_PORTS_PER_RUN) {
    throw new InvalidInputError(`ports must be a list of 1 to ${MAX_PORTS_PER_RUN} port numbers`);
  }
  const targets = ports.map((port) => toTarget(normalized, port, family));

  const results = new Array<PortResult>(targets.length);
  const queue = targets.entries();
  const lane = async (): Promise<void> => {
    for (const [index, target] of queue) {
      results[index] = await probe(target, timeoutMs, options.signal);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, lane));
  return results;
}
