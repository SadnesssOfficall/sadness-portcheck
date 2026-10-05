import type { PortResult, PortStatus } from './check.js';

export const STATUSES: readonly PortStatus[] = [
  'open',
  'closed',
  'timeout',
  'unreachable',
  'dns-error',
];

export type Summary = Record<PortStatus, number>;

export function summarize(results: readonly PortResult[]): Summary {
  const summary: Summary = { open: 0, closed: 0, timeout: 0, unreachable: 0, 'dns-error': 0 };
  for (const result of results) summary[result.status] += 1;
  return summary;
}

export function allOpen(results: readonly PortResult[]): boolean {
  return results.every((result) => result.status === 'open');
}
