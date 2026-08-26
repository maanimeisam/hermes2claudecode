import Debug from "debug";
import fs from "node:fs";
import { args } from "./args.ts";
import { setProxyUrl } from "./config-yaml.ts";
import { TOKENS_PATH, WATCH_INTERVAL_MS } from "./config.ts";
import { ensureCliProxy } from "./install-cli-proxy.ts";
import { getProvider, type Provider } from "./providers/index.ts";
import { runCliProxy } from "./run-cli-proxy.ts";

const log = Debug("useclaudeproxy:oauth");
const errorLog = Debug("useclaudeproxy:oauth:error");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Clear the stored token so the next getValidToken() re-runs the device flow.
function clearStoredToken(): void {
  if (fs.existsSync(TOKENS_PATH)) {
    fs.rmSync(TOKENS_PATH, { force: true });
    log("--renew: cleared stored token");
  }
}

export async function app(): Promise<void> {
  const provider: Provider = getProvider(args.activeProvider);
  log("Starting %s OAuth Device Flow", provider.name);

  await ensureCliProxy();

  // if (args.renew) clearStoredToken();

  const token = await provider.getValidToken();

  const account = await provider.getAccountInfo(token.access_token);
  log("Account Information:\n" + JSON.stringify(account, null, 2));

  setProxyUrl(args.proxy);
  runCliProxy()
    .then((code) => process.exit(code))
    .catch((err) => {
      errorLog("Failed to run CLIProxyAPI: %o", err);
      console.error(err);
      process.exit(1);
    });

  log("Watching token every %dms", WATCH_INTERVAL_MS);
  let current = token.access_token;
  while (true) {
    await sleep(WATCH_INTERVAL_MS);
    const refreshed = await provider.getValidToken();
    const renewed = refreshed.access_token !== current;
    current = refreshed.access_token;
    log(
      `Token ${renewed ? "RENEWED" : "valid"} (expires_in=${refreshed.expires_in})`,
    );
  }
}
