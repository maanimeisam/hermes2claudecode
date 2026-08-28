# useclaudeproxy

A TypeScript CLI (`useclaudeproxy`) that authenticates the **Hermes CLI** against
[Nous Research](https://nousresearch.com) via OAuth 2.0 Device Authorization
Grant, then downloads, configures, and runs
[`CLIProxyAPI`](https://github.com/router-for-me/CLIProxyAPI) — a local
OpenAI / Gemini / Claude / Codex compatible proxy — wired with the token it
just obtained.

In short: run one command, complete the device-flow login in your browser, and
you get a local proxy endpoint that Claude Code (or any OpenAI-compatible
client) can talk to.

---

## Install as a CLI

This repo uses **pnpm**.

```bash
git clone https://github.com/maanimeisam/useclaudeproxy.git
cd useclaudeproxy
npm install
npm run build        # tsc → dist/index.js (the useclaudeproxy bin)
npm link   # exposes `useclaudeproxy` on your PATH
```

After linking you can run `useclaudeproxy` from anywhere.

## Run without installing (npx)

You can also run it directly from npm without cloning — published as
[`useclaudeproxy`](https://npmjs.com/package/useclaudeproxy):

```bash
npx useclaudeproxy --model stealth/ox-alpha
```

⚠️ **Use a fixed working directory.** Tokens and config persist in the
current directory (default `data/` and `tools/config.yaml`). Each `npx`
invocation starts from wherever you ran it, so to reuse your saved login next
time, run it from the **same directory** every time. To keep data elsewhere,
pass `--data-dir`.

Tokens are persisted inside the provider's own file — Hermes uses
`data/hermes-tokens.json` (mode `0o600`). The token path is **provider-specific**,
not a shared global: a future provider can use a completely different location or
format without affecting others. On every refresh the provider token is
re-injected into `tools/config.yaml` so the proxy keeps working without manual
re-entry.

## Requirements

- **Node.js** ≥ 18
- **npm** (package manager)
- One of: Linux (`amd64` / `aarch64`), macOS, Windows, FreeBSD (the binary is
  fetched per-platform from the CLIProxyAPI release)

## Usage

The only required flag is `--model` — the upstream model name you want to
expose through the proxy.

```bash
# Run the device flow, start the proxy, and keep the token fresh.
useclaudeproxy --model stealth/ox-alpha

# Same thing, routing the proxy's own upstream traffic through a proxy:
useclaudeproxy --proxy http://127.0.0.1:2080 --model stealth/ox-alpha
```

### Providers

Two providers are built in. Both expose the same local proxy endpoint — they
differ only in how they authenticate upstream.

- **`hermes`** (default) — Nous Research OAuth 2.0 device flow. Completes a
  browser login, then auto-refreshes the token.
- **`opencode`** — authenticates against `https://opencode.ai/zen/v1` with a key
  (no device flow). Tokens persist in `data/opencode-tokens.json`.
- **`custom`** — point the proxy at any OpenAI-compatible API. No login: supply
  `--url`, `--api`, and `--model`; the given key is sent as a `Bearer` header
  upstream. Token persists in `data/custom-tokens.json`.

```bash
# Use the opencode provider, routing its upstream traffic through a proxy:
useclaudeproxy --proxy http://127.0.0.1:2080 --provider opencode --model hy3-free

# Point the proxy at any OpenAI-compatible API — no device flow.
# --url, --api and --model are all required for the custom provider.
useclaudeproxy --provider custom \
  --url http://1.1.1.1:20128/v1 \
  --api sk-123123123 \
  --model XX
```

On success the CLI prints the env vars to point Claude Code at the local proxy:

```bash
export ANTHROPIC_MODEL=claude-opus-5
export ANTHROPIC_BASE_URL=http://127.0.0.1:2096
export ANTHROPIC_AUTH_TOKEN=456789
```

### Global flags

These work in **any position** — before or after the command.

| Flag                | Default      | Notes                                                         |
| ------------------- | ------------ | ------------------------------------------------------------- |
| `--model <model>`   | _(required)_ | Model name to expose in OpenAI compatibility.                 |
| `--provider <name>` | `hermes`     | OAuth provider to use (`hermes` \| `opencode` \| `custom`).   |
| `--url <url>`       | `""`         | OpenAI-compatible API base URL (required when `custom`).      |
| `--api <key>`       | `""`         | API key for the custom API (required when `custom`).          |
| `--data-dir <dir>`  | `data`       | Token storage directory.                                      |
| `--proxy <url>`     | `""`         | CLIProxyAPI outbound proxy (`""`\|`direct`\|`none` to clear). |
| `--force`           | `false`      | Re-download the binary even if already installed.             |
| `--renew`           | `false`      | Re-extract from the kept archive and re-run the device flow.  |

### Renew

`--renew` re-extracts the binary from the kept archive and forces a fresh
device-flow login (ignores any stored token):

```bash
useclaudeproxy --renew
```

## Notes

- This repo contains the **TS orchestration app** (`src/`). The actual proxy is
  the third-party `cli-proxy-api` binary fetched from the
  [CLIProxyAPI releases](https://github.com/router-for-me/CLIProxyAPI/releases)
  — it is not part of the TS build.
- Two independent "proxy" concepts: the TS app's OAuth calls can use an outbound
  proxy (`--proxy`), and the binary has its own separate `proxy-url` for upstream
  provider traffic. They do not affect each other.
- Providers are pluggable. `hermes` and `opencode` are registered in
  `src/providers/index.ts`; add another by implementing `BaseProvider` in
  `src/providers/`.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- [**router-for-me/CLIProxyAPI**](https://github.com/router-for-me/CLIProxyAPI)
  — the local OpenAI/Gemini/Claude/Codex-compatible proxy binary this tool
  downloads, configures, and runs. Licensed MIT.
