import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkPorts } from '../check.js';
import { InvalidInputError, quote } from '../errors.js';
import { normalizeHost, type IpFamily } from '../host.js';
import { parsePorts } from '../ports.js';
import { allOpen, summarize } from '../report.js';
import { colorEnabled, formatJson, formatText, type CliIo } from './format.js';

export type { CliIo } from './format.js';

export const EXIT_OK = 0;
export const EXIT_NOT_OPEN = 1;
export const EXIT_USAGE = 2;
export const EXIT_INTERRUPTED = 130;

const PROGRAM = 'sadness-portcheck';
const WHOLE_NUMBER = /^\d{1,9}$/u;

const OPTIONS = {
  timeout: { type: 'string', short: 't' },
  concurrency: { type: 'string', short: 'c' },
  ipv4: { type: 'boolean', short: '4' },
  ipv6: { type: 'boolean', short: '6' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

const HELP = `sadness-portcheck - check whether TCP ports are open

Usage:
  sadness-portcheck <host> <port|range>... [options]

Arguments:
  host                  Hostname, IPv4 address or IPv6 address ([::1] or ::1)
  port|range            Port (1-65535), range (8000-8010) or comma list (80,443)

Options:
  -t, --timeout <ms>    Per-port timeout, 1-60000 (default 3000)
  -c, --concurrency <n> Parallel checks, 1-256 (default 32)
  -4, --ipv4            Use IPv4 only
  -6, --ipv6            Use IPv6 only
      --json            Print a JSON report
  -h, --help            Show this help
  -v, --version         Show the version

Exit codes:
  0    every port is open
  1    at least one port is closed, timed out or unreachable
  2    usage error
  130  interrupted

Statuses: open, closed, timeout, unreachable, dns-error
`;

function version(): string {
  const manifest = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

function parseOptions(argv: string[]) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code.startsWith('ERR_PARSE_ARGS')) throw new InvalidInputError((error as Error).message);
    throw error;
  }
}

function wholeNumber(label: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!WHOLE_NUMBER.test(value)) {
    throw new InvalidInputError(`${label} must be a whole number, got ${quote(value)}`);
  }
  return Number(value);
}

function chosenFamily(ipv4: boolean | undefined, ipv6: boolean | undefined): IpFamily | undefined {
  if (ipv4 === true && ipv6 === true) {
    throw new InvalidInputError('--ipv4 and --ipv6 cannot be used together');
  }
  if (ipv4 === true) return 4;
  return ipv6 === true ? 6 : undefined;
}

async function execute(argv: string[], io: CliIo, signal: AbortSignal | undefined) {
  const { values, positionals } = parseOptions(argv);
  if (values.help === true) {
    io.stdout.write(HELP);
    return EXIT_OK;
  }
  if (values.version === true) {
    io.stdout.write(`${version()}\n`);
    return EXIT_OK;
  }
  const [hostArgument, ...portArguments] = positionals;
  if (hostArgument === undefined) throw new InvalidInputError('missing host');
  const host = normalizeHost(hostArgument).name;
  const results = await checkPorts(host, parsePorts(portArguments), {
    timeoutMs: wholeNumber('timeout', values.timeout),
    concurrency: wholeNumber('concurrency', values.concurrency),
    family: chosenFamily(values.ipv4, values.ipv6),
    signal,
  });
  const report = { host, ok: allOpen(results), summary: summarize(results), results };
  io.stdout.write(values.json === true ? formatJson(report) : formatText(report, colorEnabled(io)));
  return report.ok ? EXIT_OK : EXIT_NOT_OPEN;
}

export async function run(argv: string[], io: CliIo, signal?: AbortSignal): Promise<number> {
  if (argv.length === 0) {
    io.stderr.write(HELP);
    return EXIT_USAGE;
  }
  try {
    return await execute(argv, io, signal);
  } catch (error) {
    if (signal?.aborted === true) {
      io.stderr.write(`${PROGRAM}: interrupted\n`);
      return EXIT_INTERRUPTED;
    }
    if (error instanceof InvalidInputError) {
      io.stderr.write(`${PROGRAM}: ${error.message}\n`);
      return EXIT_USAGE;
    }
    throw error;
  }
}
