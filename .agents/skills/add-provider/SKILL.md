---
name: add-provider
description: >
  Reusable workflow for adding a new LLM provider (e.g. a new OpenAI-compatible
  upstream) to useclaudeproxy. Use whenever the user says "add a provider",
  "add support for <provider>", "new provider", or asks to wire a new
  inference/OAuth backend into the CLIProxyAPI config. Covers the BaseProvider
  contract, the two existing archetypes (hermes = OAuth device flow,
  opencode = static/pre-shared token), registration in the registry, and the
  validation/type-check steps that keep a new provider consistent with the rest.
argument-hint: "<provider-name>"
license: MIT
---

# Add a Provider

Guide for adding a new provider to `useclaudeproxy` consistent with the existing
architecture. Do NOT refactor existing providers or change the `BaseProvider`
contract unless the new provider genuinely requires it — in that case, flag it.

## Step 0 — Read the existing code first

Before writing anything, inspect the contract and the two reference
implementations. Do not assume conventions; derive them from the source.

- `src/providers/base-provider.ts` — the architectural contract. This is the
  source of truth for required methods/properties.
- `src/providers/hermes.ts` — reference for a provider that uses a real OAuth
  2.0 Device Authorization Grant (device code → poll → refresh → account info).
- `src/providers/opencode.ts` — reference for a provider with a static /
  pre-shared token (no interactive OAuth), custom request headers, and a
  reachability pinger for the watcher.
- `src/providers/index.ts` — the registry (`Map<string, BaseProvider>`).
- `src/providers/types.ts` — intentionally empty; provider types live per-file.
- `src/app.ts` — shows how the active provider is selected (`args.activeProvider`)
  and invoked (`initConfig` → `logConfigInfo` → `startTokenWatcher`).
- `src/config-yaml.ts` — `readConfig()` / `writeConfig()` (cached in-memory,
  `CONFIG_PATH = tools/config.yaml`). Mutate the returned object, then
  `writeConfig(config)` once.
- `src/http-client.ts` — `createOAuthHttpClient()` returns a `got` instance
  already configured for retries/proxy/rejectUnauthorized. Reuse it; do not build
  a custom HTTP client.
- `src/utils.ts` — `sleep(ms, signal?)` for the watcher loop.
- `src/args.ts` — `args.model`, `args.activeProvider`, `args.dataDir`.

## Step 1 — Pick the reference archetype

Choose which existing provider to copy as the template:

- **OAuth 2.0 Device Flow (interactive login, refreshable token)** → copy
  `hermes.ts`. This covers most "real" cloud providers.
- **Static / pre-shared token, no interactive login** (e.g. a fixed public key
  or a token the user supplies) → copy `opencode.ts`.

If the new provider is OAuth but uses a different grant (e.g. client
credentials, API-key header auth), still start from `hermes.ts` and replace only
the auth client internals — keep the public `BaseProvider` shape.

## Step 2 — The BaseProvider contract (must satisfy all of these)

A provider file `src/providers/<name>.ts` MUST:

1. Extend `BaseProvider`.
2. Declare the three abstract members:
   ```ts
   readonly name = "<name>";                       // lowercase, registry key
   readonly baseUrl = "https://<upstream>/v1";     // used in initConfig + watcher
   readonly tokenPath = path.join(config.DATA_DIR, "<name>-tokens.json");
   ```
3. Implement all three abstract methods:
   - `initConfig(): Promise<void>` — edit `tools/config.yaml` to register this
     provider as an `openai-compatibility` entry (see Step 4), obtain a token,
     call `setApiKey(...)`, then `writeConfig(config)`.
   - `getValidToken(): Promise<unknown>` — return a usable token. Reuse stored
     token if valid, else refresh/renew, else run the flow. **Keep the base
     return type `unknown`**; the concrete token type is defined locally in the
     provider file and narrowed there (see Step 5).
   - `startTokenWatcher(signal?: AbortSignal): Promise<void>` — loop (abortable
     via `sleep(ms, signal)`) that keeps the token/session alive or confirms the
     upstream is reachable.
4. Export a singleton at the bottom: `export const <name>Provider = new <Name>Provider();`

## Step 3 — File / naming / style conventions (preserve exactly)

- **One file per provider**, `src/providers/<name>.ts`. Keep a provider's
  OAuth client (if any) as a private class *inside* that file — do not leak it
  into `base-provider.ts` or `src/`.
- **Two debug loggers** at top of file:
  ```ts
  const log = Debug("useclaudeproxy:<name>");
  const errorLog = Debug("useclaudeproxy:<name>:error");
  ```
- **`.ts` import extensions** everywhere (`import { BaseProvider } from "./base-provider.ts"`).
  `tsconfig` uses `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`.
- **Module-level `const`s** for intervals/headers (e.g. `WATCH_INTERVAL_MS`,
  `buildXxxHeaders()`). Match the existing style.
- **Provider-specific types** (`TokenResponse`, error classes, response shapes)
  are declared locally in the provider file. Do NOT add them to
  `base-provider.ts`, `types.ts`, or any shared module unless they are genuinely
  shared by two+ providers — in which case flag it as a deliberate change.
- Use `crypto.randomUUID()` (node:crypto) for any session/request IDs, as
  `opencode.ts` does.

## Step 4 — `initConfig()` config-editing pattern (preserve exactly)

This is the most error-prone part. Follow the exact shape used by both
`hermes.ts` and `opencode.ts`:

```ts
async initConfig(): Promise<void> {
  const config = readConfig();
  config["host"] = "127.0.0.1";
  config["api-keys"] = ["456789"];
  config["openai-compatibility"] = [{ name: this.name }];

  const api = config["openai-compatibility"][0];
  api["base-url"] = this.baseUrl;
  api["models"] = [
    { name: args.model, alias: "claude-opus-5" },
    { name: args.model, alias: "" },
  ];
  api["disable-cooling"] = true;
  api["headers"] = { /* provider-specific headers */ };

  const token = await this.getValidToken();
  this.setApiKey(/* token field used as the api key, e.g. token.access_token */);

  writeConfig(config);
}
```

> **CRITICAL — `setApiKey` assumes index `[0]`.** `BaseProvider.setApiKey()`
> writes to `config["openai-compatibility"][0]`. Therefore `initConfig` MUST set
> `config["openai-compatibility"]` to a single-entry array whose `[0]` is *this*
> provider. If/when multiple providers must coexist in one config, the
> `[0]`-hardcoding in `setApiKey` becomes a latent bug — note it, do not silently
> work around it by reaching into the base.
> `# ponytail: setApiKey targets openai-compatibility[0]; multi-provider coexistence needs index lookup.`

## Step 5 — Token persistence pattern

- `readStoredToken<TokenResponse>()` reads `this.tokenPath` (returns `undefined`
  on missing/corrupt).
- `saveTokens(token)` writes to `this.tokenPath` with `mode: 0o600`. **Override it**
  to also push the key through the config, exactly like both existing providers:
  ```ts
  override saveTokens(token: TokenResponse): void {
    super.saveTokens(token);
    this.setApiKey(token.access_token);
  }
  ```
- Define the token type locally and narrow it through the provider's own methods.
  Do not widen the base `getValidToken(): Promise<unknown>` signature.

## Step 6 — Register the provider (required integration)

Edit `src/providers/index.ts`:

1. `import { <name>Provider } from "./<name>.ts";`
2. Add to the registry Map: `["<name>", <name>Provider]`.
3. That's it — `getProvider()` and `PROVIDER_NAMES` are derived automatically.

No other file needs changes: `app.ts` already selects via `args.activeProvider`
(`--provider <name>`), and `getProvider` throws a clear "Unknown provider" error
if the name is missing.

## Step 7 — Validation checklist

Run these in the repo root (package manager is `pnpm`):

1. **Type-check** — `pnpm type-check` (`tsc --noEmit`). Must pass clean.
2. **Lint/format** — `pnpm check` (biome). Must pass clean.
3. **Registry sanity** — confirm `PROVIDER_NAMES` now includes the new name and
   that import is correct.
4. **Runtime smoke (no real network needed where possible)**:
   - Instantiate the provider: `const p = <name>Provider;`.
   - `await p.getValidToken()` returns a token shaped as the provider defines
     (static token for opencode-style, or a stored/refreshed one).
   - `await p.initConfig()` produces a `tools/config.yaml` whose
     `openai-compatibility[0].name === "<name>"` and whose
     `api-key-entries[0]["api-key"]` is the token surfaced by `setApiKey`.
   - `startTokenWatcher` aborts cleanly when its `AbortSignal` fires (verify the
     `sleep(ms, signal)` + `!signal?.aborted` loop guard, no busy spin).

## Step 8 — Consistency review (before declaring done)

- [ ] New file `<name>.ts` under `src/providers/`, one class, one singleton export.
- [ ] Extends `BaseProvider`; all 3 abstract props + 3 abstract methods implemented.
- [ ] `.ts` import extensions used; `Debug` namespaces `useclaudeproxy:<name>` /
      `useclaudeproxy:<name>:error`.
- [ ] No provider-specific types/constants/logic leaked into `base-provider.ts`,
      `types.ts`, `src/config-yaml.ts`, or `src/http-client.ts`. Any shared
      addition is flagged as deliberate.
- [ ] `getValidToken` keeps base return type `unknown`; concrete type narrowed locally.
- [ ] `setApiKey` target is `openai-compatibility[0]` (initConfig puts this
      provider there).
- [ ] `saveTokens` override calls `super.saveTokens` then `setApiKey`.
- [ ] Registered in `src/providers/index.ts` registry Map.
- [ ] `pnpm type-check` and `pnpm check` pass.
- [ ] Existing providers (`hermes`, `opencode`) were NOT modified unless required.

## Non-goals / boundaries

- Do not add a test runner or test setup; the repo has none. The Step 7 runtime
  smoke is an ad-hoc check, not committed tests, unless the user asks.
- Do not change `args.ts`, `app.ts`, or `config-yaml.ts` to support one provider.
  They are generic already.
- Do not touch `tools/cli-proxy-api` (the binary) — it is not part of the TS build.
- If the new provider needs a capability no existing provider has (e.g. streaming
  handling, multiple model blocks, a different config schema), implement it
  inside the new provider file first; only generalize into `BaseProvider` if a
  second future provider will clearly need the same thing.
