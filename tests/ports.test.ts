import { describe, expect, it } from 'vitest';
import { InvalidInputError, MAX_PORTS_PER_RUN, parsePorts } from '../src/index.js';

describe('parsePorts', () => {
  it('parses single ports in the given order', () => {
    expect(parsePorts(['443', '80', '25565'])).toEqual([443, 80, 25565]);
  });

  it('expands ranges inclusively', () => {
    expect(parsePorts(['8000-8003'])).toEqual([8000, 8001, 8002, 8003]);
    expect(parsePorts(['9-9'])).toEqual([9]);
  });

  it('accepts comma separated lists mixed with ranges', () => {
    expect(parsePorts(['22,80-82', '443'])).toEqual([22, 80, 81, 82, 443]);
  });

  it('removes duplicates and keeps the first occurrence', () => {
    expect(parsePorts(['80', '80-81', '81,80'])).toEqual([80, 81]);
  });

  it('accepts the port boundaries', () => {
    expect(parsePorts(['1', '65535'])).toEqual([1, 65535]);
    expect(parsePorts(['65530-65535'])).toHaveLength(6);
  });

  it('accepts exactly the maximum number of ports', () => {
    expect(parsePorts([`1-${MAX_PORTS_PER_RUN}`])).toHaveLength(MAX_PORTS_PER_RUN);
  });

  it.each([
    '',
    ',',
    '80,',
    ',80',
    '80,,81',
    '0',
    '65536',
    '99999',
    '100000',
    '-1',
    '+80',
    ' 80',
    '80 ',
    '80.0',
    '8e1',
    '0x50',
    'http',
    '80-',
    '-80',
    '80-90-100',
    '0-10',
    '1-70000',
    '８０',
  ])('rejects %j', (spec) => {
    expect(() => parsePorts([spec])).toThrow(InvalidInputError);
  });

  it('rejects reversed ranges', () => {
    expect(() => parsePorts(['8010-8000'])).toThrow(/reversed/u);
  });

  it('rejects ranges wider than the limit without expanding them', () => {
    expect(() => parsePorts(['1-65535'])).toThrow(/at most 1024/u);
    expect(() => parsePorts([`1-${MAX_PORTS_PER_RUN + 1}`])).toThrow(/at most 1024/u);
  });

  it('rejects a combined list that exceeds the limit', () => {
    expect(() => parsePorts([`1-${MAX_PORTS_PER_RUN}`, '5000'])).toThrow(/at most 1024/u);
  });

  it('requires at least one port', () => {
    expect(() => parsePorts([])).toThrow(/at least one port/u);
  });

  it('never echoes control characters in error messages', () => {
    expect(() => parsePorts(['\u001b[31m80'])).toThrow(/\\u\{1b\}/u);
  });
});
