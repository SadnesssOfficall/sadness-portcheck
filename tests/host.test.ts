import { describe, expect, it } from 'vitest';
import { InvalidInputError, normalizeHost } from '../src/index.js';

describe('normalizeHost', () => {
  it('lowercases hostnames and keeps a trailing dot', () => {
    expect(normalizeHost('LocalHost')).toEqual({ name: 'localhost', literalFamily: undefined });
    expect(normalizeHost('Example.COM.').name).toBe('example.com.');
  });

  it('accepts underscores and digits inside labels', () => {
    expect(normalizeHost('_dmarc.example.com').name).toBe('_dmarc.example.com');
    expect(normalizeHost('db-01.internal').name).toBe('db-01.internal');
    expect(normalizeHost('1e3.example.com').name).toBe('1e3.example.com');
  });

  it('converts internationalized names to punycode', () => {
    expect(normalizeHost('bücher.de').name).toBe('xn--bcher-kva.de');
  });

  it('recognises IPv4 literals', () => {
    expect(normalizeHost('127.0.0.1')).toEqual({ name: '127.0.0.1', literalFamily: 4 });
  });

  it('recognises IPv6 literals with and without brackets', () => {
    expect(normalizeHost('::1')).toEqual({ name: '::1', literalFamily: 6 });
    expect(normalizeHost('[::1]')).toEqual({ name: '::1', literalFamily: 6 });
    expect(normalizeHost('[2001:db8::7]').name).toBe('2001:db8::7');
  });

  it('accepts a 63 character label and a 253 character name', () => {
    expect(normalizeHost(`${'a'.repeat(63)}.com`).name).toHaveLength(67);
    const longest = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
    expect(longest).toHaveLength(253);
    expect(normalizeHost(longest).name).toBe(longest);
    expect(() => normalizeHost(`${longest}.e`)).toThrow(InvalidInputError);
  });

  it.each([
    '',
    ' ',
    'a b',
    ' example.com',
    'example.com ',
    'exa\tmple.com',
    'example.com\n',
    'a/b',
    'a/../b',
    'a#b',
    'a?b',
    'a%41',
    'exa­mple.com',
    'exa​mple.com',
    'a:b',
    'a@b',
    'host;reboot',
    'host$(id)',
    'host`id`',
    'http://example.com',
    'example.com:80',
    '-bad.example',
    'bad-.example',
    'a..b',
    '.example',
    '\u001b[31mred',
    '‮example.com',
    '[::1',
    '::1]',
    '[127.0.0.1]',
    '[example.com]',
    '[]',
    '%00',
    '127.1',
    '0x7f.1',
    '010.0.0.1',
    '2130706433',
    '256.1.1.1',
    '1.2.3',
  ])('rejects %j', (host) => {
    expect(() => normalizeHost(host)).toThrow(InvalidInputError);
  });

  it('rejects names that are too long', () => {
    expect(() => normalizeHost(`${'a'.repeat(64)}.com`)).toThrow(InvalidInputError);
    expect(() => normalizeHost(`${'a.'.repeat(130)}com`)).toThrow(InvalidInputError);
    expect(() => normalizeHost('a'.repeat(100_000))).toThrow(/longer than 253/u);
  });

  it('rejects values that are not strings', () => {
    expect(() => normalizeHost(undefined as unknown as string)).toThrow(InvalidInputError);
    expect(() => normalizeHost(42 as unknown as string)).toThrow(InvalidInputError);
  });

  it('never echoes control characters in error messages', () => {
    for (const hostile of ['\u001b[2J\u001b[31mx y', 'x\u009b31m y', '‮ y']) {
      let message = '';
      try {
        normalizeHost(hostile);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).toMatch(/^[\x20-\x7e]*$/u);
    }
  });
});
