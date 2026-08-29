import Debug from "debug";
import { args } from "./args.ts";
import { ensureCliProxy } from "./install-cli-proxy.ts";
import type { BaseProvider } from "./providers/base-provider.ts";
import { getProvider } from "./providers/index.ts";
import { runCliProxy } from "./run-cli-proxy.ts";

const log = Debug("useclaudeproxy:oauth");
const errorLog = Debug("useclaudeproxy:oauth:error");

export async function app(): Promise<void> {
  const provider: BaseProvider = getProvider(args.activeProvider);

  await ensureCliProxy();

  if (args.renew) process.exit(0);

  await provider.initConfig();

  provider.logConfigInfo();

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
