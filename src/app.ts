import Debug from "debug";
import { args } from "./args.ts";
import { setProxyUrl } from "./config-yaml.ts";
import { ensureCliProxy } from "./install-cli-proxy.ts";
import { getProvider, type Provider } from "./providers/index.ts";
import { runCliProxy } from "./run-cli-proxy.ts";

const log = Debug("useclaudeproxy:oauth");
const errorLog = Debug("useclaudeproxy:oauth:error");

export async function app(): Promise<void> {
  await ensureCliProxy();

  const provider: Provider = getProvider(args.activeProvider);

  await provider.getValidToken();

  setProxyUrl(args.proxy);
  runCliProxy()
    .then((code) => process.exit(code))
    .catch((err) => {
      errorLog("Failed to run CLIProxyAPI: %o", err);
      process.exit(1);
    });

  const shutdown = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => shutdown.abort());
  }
  await provider.startTokenWatcher(shutdown.signal);
}
