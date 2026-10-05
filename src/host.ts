import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { InvalidInputError, quote } from './errors.js';
import { MAX_HOST_LENGTH, MAX_LABEL_LENGTH } from './limits.js';

export type IpFamily = 4 | 6;

export interface NormalizedHost {
  name: string;
  literalFamily: IpFamily | undefined;
}

const LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/u;
const HOSTNAME_CHARACTERS = /^[\p{L}\p{N}._-]+$/u;
const DIGITS = /^\d+$/u;
const BRACKET = /[[\]]/u;
const TRAILING_DOT = /\.$/u;

function literalFamily(value: string): IpFamily | undefined {
  const family = isIP(value);
  return family === 4 || family === 6 ? family : undefined;
}

function unwrapBrackets(input: string): string {
  if (input.startsWith('[') && input.endsWith(']')) {
    const inner = input.slice(1, -1);
    if (literalFamily(inner) !== 6)
      throw new InvalidInputError(`invalid IPv6 literal ${quote(input)}`);
    return inner;
  }
  if (BRACKET.test(input)) throw new InvalidInputError(`invalid host ${quote(input)}`);
  return input;
}

function normalizeHostname(value: string): string {
  if (!HOSTNAME_CHARACTERS.test(value)) throw new InvalidInputError(`invalid host ${quote(value)}`);
  const ascii = domainToASCII(value);
  const labels = ascii.replace(TRAILING_DOT, '').split('.');
  const valid =
    ascii.length > 0 &&
    ascii.length <= MAX_HOST_LENGTH &&
    labels.every((label) => label.length <= MAX_LABEL_LENGTH && LABEL.test(label));
  if (!valid) throw new InvalidInputError(`invalid host ${quote(value)}`);
  if (DIGITS.test(labels.at(-1) ?? '')) {
    throw new InvalidInputError(
      `ambiguous numeric host ${quote(value)}; use a full dotted IPv4 address`,
    );
  }
  return ascii;
}

export function normalizeHost(input: string): NormalizedHost {
  if (typeof input !== 'string' || input.length === 0) {
    throw new InvalidInputError('host must be a non-empty string');
  }
  if (input.length > MAX_HOST_LENGTH + 2) {
    throw new InvalidInputError(`host is longer than ${MAX_HOST_LENGTH} characters`);
  }
  const unwrapped = unwrapBrackets(input);
  const family = literalFamily(unwrapped);
  if (family !== undefined) return { name: unwrapped, literalFamily: family };
  return { name: normalizeHostname(unwrapped), literalFamily: undefined };
}
