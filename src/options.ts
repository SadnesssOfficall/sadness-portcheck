import { InvalidInputError } from './errors.js';
import type { IpFamily, NormalizedHost } from './host.js';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  MAX_PORT,
  MAX_TIMEOUT_MS,
  MIN_CONCURRENCY,
  MIN_PORT,
  MIN_TIMEOUT_MS,
} from './limits.js';

export function boundedInteger(label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidInputError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function resolvePort(port: unknown): number {
  return boundedInteger('port', port, MIN_PORT, MAX_PORT);
}

export function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  return boundedInteger('timeout', timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

export function resolveConcurrency(concurrency: number | undefined): number {
  if (concurrency === undefined) return DEFAULT_CONCURRENCY;
  return boundedInteger('concurrency', concurrency, MIN_CONCURRENCY, MAX_CONCURRENCY);
}

export function resolveFamily(host: NormalizedHost, requested: unknown): IpFamily | undefined {
  if (requested === undefined) return host.literalFamily;
  if (requested !== 4 && requested !== 6) throw new InvalidInputError('family must be 4 or 6');
  if (host.literalFamily !== undefined && requested !== host.literalFamily) {
    throw new InvalidInputError(
      `host is an IPv${host.literalFamily} address but IPv${requested} was requested`,
    );
  }
  return requested;
}
