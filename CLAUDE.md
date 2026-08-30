# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

package `useclaudeproxy` is a TypeScript CLI that authenticates against an upstream **provider** (Nous Research Hermes OAuth device flow, OpenCode, Cline WorkOS device flow, or any OpenAI-compatible API), then downloads, configures, and runs the third-party `CLIProxyAPI` binary — a local OpenAI/Gemini/Claude/Codex-compatible proxy — wired with the obtained token.

Two distinct halves:

- **The TS app** (`src/`) handles provider auth, config writing, and lifecycle of the binary.
- **The binary** (`tools/cli-proxy-api`, fetched from GitHub releases) is the actual proxy. It is not part of the TS build; the TS app only downloads/extracts/spawns it.

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

Biome is the formatter + linter; a husky pre-commit hook runs `biome check` on staged files via lint-staged. There is **no test setup** in this repo.

## Running

There is one flow, not subcommands — the CLI is a single invocation:

```bash
pnpm dev -- --model stealth/ox-alpha                     # hermes (default provider)
pnpm dev -- --provider cline --model deepseek/...        # cline WorkOS device flow
pnpm dev -- --provider custom --url ... --api ... --model ...
useclaudeproxy --renew --model ...                       # re-extract binary + fresh login
```

`--model` is the only required flag. All flags are position-independent (parsed straight off argv by `src/args.ts`, not by commander's subcommand parsing). See README.md for the full flag table.

On success the app prints env vars (`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`) to point Claude Code at the local proxy, then spawns the binary and enters a per-provider token watcher loop.

## Architecture

Entry point is `src/index.ts`; the flow is linear and orchestrated in `src/app.ts`:

1. `getProvider(args.activeProvider)` — provider registry (`src/providers/index.ts`) resolves `hermes` | `opencode` | `cline` | `custom` to a `BaseProvider` instance.
2. `ensureCliProxy()` (`src/install-cli-proxy.ts`) — downloads the pinned CLIProxyAPI release (`VERSION` constant) from GitHub for the current platform/arch, extracts via `tar`, seeds `tools/config.yaml` from `config.example.yaml` if absent. Skips if `tools/` is non-empty unless `--force`. `--renew` instead wipes `tools/` (keeping only the downloaded archive), re-extracts, and clears the stored token.
3. `provider.initConfig()` — provider-specific: builds the `openai-compatibility` block in `tools/config.yaml` (host, port, api-keys, base-url, models with `claude-opus-5` alias, custom headers) and obtains/refreshes the token.
4. `provider.logConfigInfo()` — prints the endpoint and Claude Code env vars.
5. `runCliProxy()` (`src/run-cli-proxy.ts`) — spawns the binary with `-config tools/config.yaml`, inherits stdio, forwards SIGINT/SIGTERM.
6. `provider.startTokenWatcher(signal)` — loop that refreshes the token on an interval and re-injects it into `tools/config.yaml`; aborted on SIGINT/SIGTERM.

Read these files in order to understand the flow:

- **`src/args.ts`** — commander parser. Exports the resolved `args` object: `--model` (required), `--provider` (default `hermes`), `--url`/`--api` (required when provider is `custom`), `--data-dir`, `--tools-dir` (default `<repo>/tools`), `--proxy`, `--host`, `--port`, `--cli-key`, `--force`, `--renew`. Validations (missing `--model`, custom-provider requirements) run right after `program.parse()`.
- **`src/config.ts`** — zod-validated config sourced from the parsed args + env. On import it validates and **creates `DATA_DIR`**. App config is just NODE_ENV/DEBUG/DATA_DIR — no `.env` files.
- **`src/types.ts` / `src/utils.ts`** — `AccessDeniedError`, `AccountInfo`, and an abort-signal-aware `sleep`.
- **`src/http-client.ts`** — `createOAuthHttpClient()` builds a `got` instance (retry off, proxy agents when `--proxy` is set). Knows nothing about OAuth.
- **`src/config-yaml.ts`** — read/write of the live `tools/config.yaml` with a module-level cache (`readConfig`/`writeConfig`), plus `setProxyUrl` validation (`socks5|http|https` scheme, or `direct`/`none`/empty to clear).
- **`src/install-cli-proxy.ts`** / **`src/run-cli-proxy.ts`** — binary install/lifecycle described above.

### Provider system

All auth logic lives in `src/providers/`, one file per provider, registered in `src/providers/index.ts` (a `Map` of name → instance; `getProvider` throws on unknown names). To add a provider: subclass `BaseProvider` (`base-provider.ts`) and implement:

- `name`, `baseUrl`, `tokenPath` (provider-specific token file under `DATA_DIR`, e.g. `data/hermes-tokens.json`, mode `0o600` — paths are deliberately per-provider, not shared)
- `initConfig()` — write the provider's `openai-compatibility` block into the proxy config
- `getValidToken()` — use stored token, refresh if needed, else run the provider's login flow
- `startTokenWatcher(signal)` — periodic refresh loop; `sleep()` from `utils.ts` handles abort

`BaseProvider` supplies `readStoredToken`/`saveTokens`/`clearStoredToken`/`logConfigInfo`. Note `clearStoredToken` currently removes the whole `DATA_DIR` — providers that share a data dir are affected.

Each provider is self-contained by design: `hermes.ts` and `cline.ts` each carry their own copy of the device-flow client and error classes (they target different OAuth servers), while `opencode.ts` and `custom.ts` are simple key-based providers. Adding a provider that duplicates existing flow logic is acceptable here — the files are meant to be independent.

## Working rules (user preferences)

- Re-index this project with the codebase-memory MCP (`index_repository`) at each step; use it as the primary source of truth for understanding the project.
- Never create, update, run, or verify tests. Skip and exclude any files containing "test" in their names (e.g. `index_test.ts`).
- Never use web drivers (Puppeteer, etc.) or any sandbox. Verify syntax only with `pnpm type-check` (`tsc --noEmit`).
- Use the `debug` package to log each step's results (follow the existing `Debug("useclaudeproxy:<module>")` pattern).
- Source code only: do not write comments, READMEs, bash scripts, tests, bundler config, package.json, tsconfig, etc. — the user maintains all of those. Deliver clean code and nothing else.

## Import convention

`tsconfig.json` uses `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so source imports use `.ts` extensions (e.g. `./args.ts`) and `tsc` rewrites them to `.js` on build. Keep this pattern in new files — do not switch to extensionless imports. (Note: a few existing files import `./config.js` — prefer `.ts`.)

## Config files you will touch

- `tools/config.yaml` — the CLIProxyAPI config (host, port, api-keys, openai-compatibility, proxy-url). Written at runtime by `config-yaml.ts` and every provider's `initConfig()`; template is `tools/config.example.yaml`. It is gitignored-ish state: the archive + binary also live in `tools/`.
- `data/*-tokens.json` — per-provider token storage (mode `0o600`), created at runtime.
