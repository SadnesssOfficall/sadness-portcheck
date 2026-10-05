# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-05

### Added

- `sadness-portcheck` CLI: TCP checks for one host and many ports, ranges and comma lists
- Status per port: `open`, `closed`, `timeout`, `unreachable`, `dns-error`, with latency in milliseconds
- `--timeout`, `--concurrency`, `-4`/`-6` and `--json` options
- IPv6 literals with or without brackets
- Exit codes 0 (all open), 1 (at least one not open), 2 (usage error), 130 (interrupted)
- Colour only on a TTY, disabled by `NO_COLOR` and `TERM=dumb`
- Clean shutdown on SIGINT; every socket is destroyed in every outcome
- Host and port validation, with a limit of 1024 ports per run
- Library API: `checkPort`, `checkPorts`, `parsePorts`, `normalizeHost`, `summarize`, `allOpen`
