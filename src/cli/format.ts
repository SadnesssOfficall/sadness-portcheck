import type { PortResult, PortStatus } from '../check.js';
import { LATENCY_DECIMALS } from '../limits.js';
import { STATUSES, type Summary } from '../report.js';

export interface Report {
  host: string;
  ok: boolean;
  summary: Summary;
  results: PortResult[];
}

export interface CliIo {
  stdout: { write(text: string): unknown; isTTY?: boolean };
  stderr: { write(text: string): unknown };
  env: Readonly<Record<string, string | undefined>>;
}

const SGR = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33 } as const;
const RESET = '\u001b[0m';
const COLUMN_GAP = '  ';
const STATUS_WIDTH = Math.max(...STATUSES.map((status) => status.length));

const STATUS_COLOR: Record<PortStatus, keyof typeof SGR> = {
  open: 'green',
  closed: 'red',
  timeout: 'yellow',
  unreachable: 'yellow',
  'dns-error': 'red',
};

export function colorEnabled(io: CliIo): boolean {
  const noColor = io.env['NO_COLOR'] ?? '';
  return io.stdout.isTTY === true && noColor === '' && io.env['TERM'] !== 'dumb';
}

function endpoint(result: PortResult): string {
  const host = result.host.includes(':') ? `[${result.host}]` : result.host;
  return `${host}:${result.port}`;
}

function widest(values: readonly string[]): number {
  return Math.max(...values.map((value) => value.length));
}

export function formatText(report: Report, color: boolean): string {
  const paint = (style: keyof typeof SGR, text: string): string =>
    color ? `\u001b[${SGR[style]}m${text}${RESET}` : text;
  const endpoints = report.results.map(endpoint);
  const latencies = report.results.map((result) => result.latencyMs.toFixed(LATENCY_DECIMALS));
  const endpointWidth = widest(endpoints);
  const latencyWidth = widest(latencies);

  const lines = report.results.map((result, index) => {
    const status = paint(STATUS_COLOR[result.status], result.status.padEnd(STATUS_WIDTH));
    const latency = `${(latencies[index] ?? '').padStart(latencyWidth)} ms`;
    const detail = result.address ?? result.error;
    const row = [(endpoints[index] ?? '').padEnd(endpointWidth), status, latency];
    if (detail !== undefined) row.push(paint('dim', detail));
    return row.join(COLUMN_GAP);
  });

  const counts = STATUSES.filter((status) => report.summary[status] > 0).map(
    (status) => `${report.summary[status]} ${status}`,
  );
  return `${[...lines, paint('bold', counts.join(', '))].join('\n')}\n`;
}

export function formatJson(report: Report): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
