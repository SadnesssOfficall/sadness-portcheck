# sadness-portcheck

Check whether TCP ports are open, from the command line or from code.

```console
$ sadness-portcheck localhost 25565
localhost:25565  closed       1.4 ms  ECONNREFUSED
1 closed
```

## Description

`sadness-portcheck` opens a TCP connection to each port you list and tells you what happened:
the port accepted the connection, refused it, did not answer in time, could not be reached, or
the host name did not resolve. It checks many ports in parallel with a concurrency limit, supports
IPv4 and IPv6, and has a `--json` mode and stable exit codes for scripts. It has no runtime
dependencies and only uses `node:net`.

## Features

- One host, many ports: single ports, ranges (`8000-8010`) and comma lists (`80,443`)
- Five statuses: `open`, `closed` (connection refused), `timeout`, `unreachable`, `dns-error`
- Latency in milliseconds for every port
- Per-port timeout and a concurrency limit
- IPv4 and IPv6, with `-4` / `-6` and IPv6 literals as `[::1]` or `::1`
- Readable output, optional colour, `NO_COLOR` support, `--json` report
- Exit codes: 0 all open, 1 at least one not open, 2 usage error
- Clean `Ctrl+C`: pending checks are cancelled and every socket is destroyed
- Strict host and port validation, and a cap on the size of a range
- Library API: `checkPort`, `checkPorts`

## Installation

Requires Node.js 20 or newer.

```sh
npm install --global sadness-portcheck
sadness-portcheck --help
```

Without a global install:

```sh
npx sadness-portcheck localhost 80
```

As a library dependency:

```sh
npm install sadness-portcheck
```

## Usage

```text
sadness-portcheck <host> <port|range>... [options]
```

```sh
sadness-portcheck localhost 25565
sadness-portcheck example.com 80 443 25565
sadness-portcheck localhost 8000-8010 --concurrency 4
sadness-portcheck example.com 22,80,443 --timeout 1500
sadness-portcheck '[::1]' 3000
sadness-portcheck -4 localhost 5432
sadness-portcheck example.com 443 --json
```

Quote IPv6 literals in brackets so that your shell does not treat `[::1]` as a glob. `::1` works unquoted.

### Options

| Option                  | Meaning                                      |
| ----------------------- | -------------------------------------------- |
| `-t, --timeout <ms>`    | Per-port timeout, 1 to 60000. Default 3000   |
| `-c, --concurrency <n>` | Checks running at once, 1 to 256. Default 32 |
| `-4, --ipv4`            | Use IPv4 only                                |
| `-6, --ipv6`            | Use IPv6 only                                |
| `--json`                | Print a JSON report instead of text          |
| `-h, --help`            | Show help                                    |
| `-v, --version`         | Show the version                             |

### Statuses

| Status        | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `open`        | The TCP handshake completed                                                   |
| `closed`      | The host answered with a refusal (`ECONNREFUSED`)                             |
| `timeout`     | No answer within `--timeout`, or the OS gave up (`ETIMEDOUT`)                 |
| `unreachable` | No route, no usable local address or another network error. The code is shown |
| `dns-error`   | The name did not resolve (`ENOTFOUND`, `EAI_AGAIN`, ...)                      |

Latency is the time from starting the connection until it succeeded or failed, so it includes
DNS resolution. For a `timeout` it is roughly the timeout itself.

### Exit codes

| Code | Meaning                                               |
| ---- | ----------------------------------------------------- |
| 0    | Every port is open                                    |
| 1    | At least one port is closed, timed out or unreachable |
| 2    | Usage error: invalid host, port, range or option      |
| 130  | Interrupted with `Ctrl+C`                             |

## Configuration

There are no configuration files and no environment variables beyond the standard terminal ones:

| Variable    | Effect                              |
| ----------- | ----------------------------------- |
| `NO_COLOR`  | Any non-empty value disables colour |
| `TERM=dumb` | Disables colour                     |

Colour is used only when stdout is a TTY, and never in `--json` mode.

Limits:

| Limit                                                   | Value          |
| ------------------------------------------------------- | -------------- |
| Ports per run (after ranges expand, duplicates removed) | 1024           |
| Timeout                                                 | 1 to 60000 ms  |
| Concurrency                                             | 1 to 256       |
| Host name length                                        | 253 characters |

Hosts are normalised: lower-cased, internationalised names converted to punycode, brackets removed from
IPv6 literals. Shorthand numeric hosts such as `127.1` or `2130706433` are rejected because different
resolvers read them differently; use `127.0.0.1`.

## Examples

```console
$ sadness-portcheck 127.0.0.1 8000-8002
127.0.0.1:8000  open         1.2 ms  127.0.0.1
127.0.0.1:8001  closed       1.1 ms  ECONNREFUSED
127.0.0.1:8002  closed       1.0 ms  ECONNREFUSED
1 open, 2 closed
```

JSON:

```console
$ sadness-portcheck localhost 8000 --json
{
  "host": "localhost",
  "ok": true,
  "summary": {
    "open": 1,
    "closed": 0,
    "timeout": 0,
    "unreachable": 0,
    "dns-error": 0
  },
  "results": [
    {
      "host": "localhost",
      "port": 8000,
      "status": "open",
      "latencyMs": 1.2,
      "address": "127.0.0.1"
    }
  ]
}
```

`address` is present for open ports and `error` carries the system error code when there was one.

In a script:

```sh
sadness-portcheck db.internal 5432 --timeout 2000 || echo "database is not reachable"
```

Library:

```ts
import { checkPort, checkPorts, parsePorts } from 'sadness-portcheck';

const one = await checkPort('localhost', 25565, { timeoutMs: 1000 });
console.log(one.status, one.latencyMs);

const many = await checkPorts('localhost', parsePorts(['8000-8010', '443']), {
  concurrency: 8,
  family: 4,
  signal: AbortSignal.timeout(30_000),
});
console.log(many.filter((result) => result.status === 'open').map((result) => result.port));
```

Both functions resolve with results and do not throw for network problems; those become a `status`.
They reject with `InvalidInputError` for invalid input (before any connection is made), and with the
signal's reason when the `AbortSignal` fires. `checkPorts` returns results in the order of the ports given.
`summarize(results)` counts results per status and `allOpen(results)` tells whether all are open.

## Architecture

```text
src/
  host.ts      host validation and normalisation
  ports.ts     port, range and list parsing with size limits
  options.ts   timeout, concurrency, port and family validation
  check.ts     one TCP probe, status classification, checkPort / checkPorts
  report.ts    per-status summary
  errors.ts    InvalidInputError and safe quoting of untrusted text
  limits.ts    all limits and defaults
  cli/         argument handling, output formatting, SIGINT wiring
```

The CLI is a thin layer over the library functions.

## Security

- **Input is validated before any socket is opened.** Hosts are limited to letters, digits, `.`, `_`
  and `-` (plus IPv6 literals), so a value such as `example.com/path` or `host;cmd` is rejected instead of
  being silently cut or reinterpreted. Nothing is ever passed to a shell.
- **Terminal escape injection.** Untrusted text echoed in error messages is quoted and every
  non-printable or non-ASCII character is escaped, so a hostile argument cannot rewrite your terminal.
- **Bounded work.** At most 1024 ports per run and 256 parallel connections.
- **No leaked sockets.** Each socket is destroyed on success, error, timeout and cancellation.
- **Not a stealth scanner.** It performs full TCP connects, which servers can log. Only check hosts you
  are allowed to test.

## Development

```sh
git clone https://github.com/SadnesssOfficall/sadness-portcheck.git
cd sadness-portcheck
npm install
npm run build
```

| Script                 | Purpose             |
| ---------------------- | ------------------- |
| `npm run build`        | Compile to `dist/`  |
| `npm run lint`         | ESLint (type-aware) |
| `npm run format:check` | Prettier            |
| `npm run typecheck`    | `tsc --noEmit`      |

## Testing

```sh
npm test
```

The tests use real `net.Server` instances on the loopback interface: open ports, ports that were
closed on purpose, concurrency, cancellation, socket cleanup, output formats, colour rules, exit
codes and hostile input.

Some tests depend on the machine and are skipped when it cannot support them:

- IPv6 tests run only when `::1` can be bound.
- Timeout, cancellation-in-flight and concurrency tests need an address that silently drops packets.
  They probe `192.0.2.1`, `198.51.100.1` and `203.0.113.1` (reserved documentation ranges, RFC 5737)
  and are skipped when none of them times out, for example behind a proxy or firewall that rejects them.
- The `unreachable` test needs an address that fails with `ENETUNREACH`, `EHOSTUNREACH` or
  `EADDRNOTAVAIL` (`100::1` or `0.0.0.0`, depending on the platform) and is skipped otherwise.
- The `dns-error` test resolves `nonexistent.invalid`; it passes with or without internet access.

## License

[MIT](LICENSE)
