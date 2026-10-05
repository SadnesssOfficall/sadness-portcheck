#!/usr/bin/env node
import { run } from './main.js';

const controller = new AbortController();
process.once('SIGINT', () => {
  controller.abort();
});

process.exitCode = await run(
  process.argv.slice(2),
  { stdout: process.stdout, stderr: process.stderr, env: process.env },
  controller.signal,
);
