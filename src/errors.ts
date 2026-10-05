import { MAX_QUOTED_LENGTH } from './limits.js';

export class InvalidInputError extends Error {
  override name = 'InvalidInputError';
}

const UNPRINTABLE = /[^\x20-\x7e]/gu;
const HEX_RADIX = 16;

export function quote(value: string): string {
  const shown =
    value.length > MAX_QUOTED_LENGTH ? `${value.slice(0, MAX_QUOTED_LENGTH)}...` : value;
  const escaped = shown.replace(UNPRINTABLE, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return `\\u{${code.toString(HEX_RADIX)}}`;
  });
  return `"${escaped}"`;
}
