import { InvalidInputError, quote } from './errors.js';
import { MAX_PORT, MAX_PORTS_PER_RUN, MIN_PORT } from './limits.js';

const PORT_SPEC = /^(\d{1,5})(?:-(\d{1,5}))?$/u;

function tooManyPorts(): InvalidInputError {
  return new InvalidInputError(`at most ${MAX_PORTS_PER_RUN} ports can be checked at once`);
}

function expand(token: string): number[] {
  const match = PORT_SPEC.exec(token);
  if (match === null) throw new InvalidInputError(`invalid port or range ${quote(token)}`);
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  if (first < MIN_PORT || last > MAX_PORT) {
    throw new InvalidInputError(
      `ports must be between ${MIN_PORT} and ${MAX_PORT}: ${quote(token)}`,
    );
  }
  if (first > last) throw new InvalidInputError(`range ${quote(token)} is reversed`);
  if (last - first >= MAX_PORTS_PER_RUN) throw tooManyPorts();
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

export function parsePorts(specs: readonly string[]): number[] {
  const ports = new Set<number>();
  for (const spec of specs) {
    for (const token of spec.split(',')) {
      for (const port of expand(token)) ports.add(port);
      if (ports.size > MAX_PORTS_PER_RUN) throw tooManyPorts();
    }
  }
  if (ports.size === 0) throw new InvalidInputError('at least one port is required');
  return [...ports];
}
