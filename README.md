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

## How it works

```
useclaudeproxy --model <model>
   │
   ├─ 1. ensureCliProxy()      download CLIProxyAPI (pinned v7.2.142) from GitHub → tools/
   ├─ 2. getValidToken()       use stored token ──refresh──▶ run device flow
   │        │                     (portal.nousresearch.com)
   │        ▼
   ├─ 3. getAccountInfo()      verify the token, print account info
   ├─ 4. setProxyUrl()         apply --proxy to tools/config.yaml
   └─ 5. runCliProxy()         spawn cli-proxy-api -config tools/config.yaml
            + watch loop       transparently refresh the token while it runs
```

Tokens are persisted at `data/tokens.json` (mode `0o600`). On every refresh the
provider token is re-injected into `tools/config.yaml` so the proxy keeps
working without manual re-entry.

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

On success the CLI prints the env vars to point Claude Code at the local proxy:

```bash
export ANTHROPIC_MODEL=claude-opus-5
export ANTHROPIC_BASE_URL=http://127.0.0.1:8317
export ANTHROPIC_AUTH_TOKEN=456789
```

### Global flags

These work in **any position** — before or after the command.

| Flag                | Default            | Notes                                                         |
| ------------------- | ------------------ | ------------------------------------------------------------- |
| `--model <model>`   | _(required)_       | Model name to expose in OpenAI compatibility.                 |
| `--provider <name>` | `hermes`           | OAuth provider to use (hermes only, for now).                 |
| `--node-env <env>`  | `development`      | `development` \| `production`.                                |
| `--debug <ns>`      | `useclaudeproxy:*` | `debug` namespaces, e.g. `useclaudeproxy:oauth`.              |
| `--data-dir <dir>`  | `data`             | Token storage directory.                                      |
| `--proxy <url>`     | `""`               | CLIProxyAPI outbound proxy (`""`\|`direct`\|`none` to clear). |
| `--force`           | `false`            | Re-download the binary even if already installed.             |
| `--renew`           | `false`            | Re-extract from the kept archive and re-run the device flow.  |

Example with position-independent flags:

```bash
useclaudeproxy --data-dir ~/.useclaudeproxy --debug useclaudeproxy:oauth --model stealth/ox-alpha
# is equivalent to
useclaudeproxy --model stealth/ox-alpha --data-dir ~/.useclaudeproxy --debug useclaudeproxy:oauth
```

## Notes

- This repo contains the **TS orchestration app** (`src/`). The actual proxy is
  the third-party `cli-proxy-api` binary fetched from the
  [CLIProxyAPI releases](https://github.com/router-for-me/CLIProxyAPI/releases)
  — it is not part of the TS build.
- Two independent "proxy" concepts: the TS app's OAuth calls can use an outbound
  proxy (`--proxy`), and the binary has its own separate `proxy-url` for upstream
  provider traffic. They do not affect each other.
- Providers are pluggable. `hermes` is registered in `src/providers/index.ts`;
  add another by implementing the `Provider` interface in `src/providers/types.ts`.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

- [**router-for-me/CLIProxyAPI**](https://github.com/router-for-me/CLIProxyAPI)
  — the local OpenAI/Gemini/Claude/Codex-compatible proxy binary this tool
  downloads, configures, and runs. Licensed MIT.
