# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

`temps` (package `hermes2claudecode`) is a TypeScript CLI that authenticates the **Hermes CLI** against Nous Research's OAuth 2.0 Device Authorization Grant (`https://portal.nousresearch.com/api/oauth`). It then downloads, configures, and runs the third-party `CLIProxyAPI` binary (`tools/cli-proxy-api`) — a local OpenAI/Gemini/Claude/Codex-compatible proxy — wired with the provider tokens it obtained.

The two halves are distinct:
- **The TS app** (`src/`) handles OAuth, config editing, and lifecycle of the binary.
- **The binary** (`tools/cli-proxy-api`, ~600KB ELF, fetched from GitHub releases) is the actual proxy. It is not part of the TS build.

## Commands

Package manager is **pnpm**. All commands run from the repo root.

```bash
pnpm dev        # tsx --watch src/index.ts
pnpm dev:once   # single run, no watch
pnpm build      # tsc (prebuild runs rimraf dist)
pnpm type-check # tsc --noEmit
pnpm check      # biome check --write --no-errors-on-unmatched
pnpm lint       # biome lint --write
pnpm format     # biome format --write
```

Biome 2.5.2 (config: `biome.json`) is the formatter + linter; a husky pre-commit hook runs `biome check` on staged files via lint-staged. There is **no test setup** in this repo (no test runner dependency; `tsconfig` references a `tests/` dir that does not exist).

The app is invoked through three subcommands plus a no-command default:
- `temps` (no command) → run the OAuth device flow, validate/refresh the stored token, print account info, optionally `--watch`.
- `temps run [-- ...args]` → ensure the binary is present, then spawn it with `tools/config.yaml` (passes extra args through verbatim, e.g. `--tui`).
- `temps set-token <claude|gemini|codex> <token>` → upsert a `<provider>-api-key` in `tools/config.yaml`.
- `temps set-proxy <url|""|direct|none>` → set the binary's global `proxy-url`.

Inline overrides work as position-independent global flags (e.g. `temps --node-env production --debug app:*`).

## Architecture

Entry point is `src/index.ts`; it routes on `args.command` and calls one of the paths below. Read these files in order to understand the flow:

- **`src/args.ts`** — commander parser. Parses position-independent global flags (node-env, debug, data-dir, proxy-*) straight from raw argv (before handing the rest to commander), then exports the resolved `args` object plus `PROVIDERS = ["claude","gemini","codex"]`. Flags work in both `temps --force` and `temps run --force` because they're read from argv, not commander.
- **`src/config.ts`** — zod-validated config sourced from the parsed CLI args. On import it validates against `envSchema` (with defaults) and **creates `DATA_DIR`**. The app's own config is NODE_ENV, DEBUG, DATA_DIR, PROXY_* — all supplied via flags, no `.env` files.
- **`src/types.ts`** — shared types and the three error classes used across the flow: `OAuthHttpError` (status + body), `DeviceCodeExpiredError`, `AccessDeniedError`.
- **`src/http-client.ts`** — `createOAuthHttpClient()` builds a `got` instance for the OAuth provider. This module knows nothing about OAuth; it only configures retries/proxy and returns the client.
- **`src/device-flow-client.ts`** — `DeviceFlowClient` class, one public method per flow step (`requestDeviceCode`, `pollForToken`, `refreshToken`, `fetchAccountInfo`) over the `got` client. `handlePollingError` distinguishes terminal errors (`expired_token` → `DeviceCodeExpiredError`, `access_denied` → `AccessDeniedError`) from transient ones (`authorization_pending`, `slow_down`) that just continue polling.
- **`src/config-yaml.ts`** — surgical read/write of the **live** `tools/config.yaml` using `yaml`'s `parseDocument` so comments/formatting are preserved (only the changed key moves). `CONFIG_PATH` is `tools/config.yaml`. `setProviderApiKey` upserts into the `<provider>-api-key` sequence; `setProxyUrl` validates the URL scheme (`socks5|http|https`) or `direct`/`none`/empty to clear.
- **`src/install-cli-proxy.ts`** — `ensureCliProxy()` downloads the pinned `CLIProxyAPI` release (`VERSION = "7.2.140"`) from GitHub for the current platform/arch, extracts via `tar`, and skips if `tools/` is non-empty unless `--force`.
- **`src/run-cli-proxy.ts`** — `runCliProxy()` spawns the binary with `-config tools/config.yaml`, inherits stdio, and forwards SIGINT/SIGTERM so the user can drive it directly.
- **`src/app.ts`** — orchestration. `app()`: `ensureCliProxy()` → `getValidToken()` (use stored token if `fetchAccountInfo` succeeds, else refresh, else run device flow) → print account info → optionally a 6s `--watch` loop that re-validates/renews the token. Tokens persist at `DATA_DIR/tokens.json` with `mode 0o600`.

### Two separate proxy concepts (easy to conflate)

- `config.ts` `PROXY_*` / `createOAuthHttpClient()` — the outbound proxy used by **the TS app's OAuth calls** to `portal.nousresearch.com`.
- `config-yaml.ts` `proxy-url` in `tools/config.yaml` — the outbound proxy used by the **`CLIProxyAPI` binary** for its upstream provider traffic.

These are independent. Editing one does not affect the other.

### Import convention

`tsconfig.json` uses `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so source imports use `.ts` extensions (e.g. `./args.ts`) and `tsc` rewrites them to `.js` on build. Keep this pattern in new files — do not switch to extensionless imports.

## Config files you will touch

- App config (NODE_ENV, DEBUG, DATA_DIR, PROXY_*) is now supplied via position-independent global flags — `--node-env`, `--debug`, `--data-dir`, `--proxy-enabled`, `--proxy-host`, `--proxy-port`. `DEBUG="app:*"` enables all `debug` namespaces. No `.env` files.
- `tools/config.yaml` — the `CLIProxyAPI` config (api-keys, routes, proxy-url, management, plugins). Edited at runtime by `config-yaml.ts`; the example is `tools/config.example.yaml`. Full provider key blocks are commented out by default.
