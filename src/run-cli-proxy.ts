import Debug from "debug";
import cp from "node:child_process";
import path from "node:path";
import { CONFIG_PATH } from "./config-yaml.ts";
import { ensureCliProxy } from "./install-cli-proxy.ts";

const log = Debug("app:run");

const BINARY = path.join(import.meta.dirname, "..", "tools", "cli-proxy-api");

// Spawns the extracted binary with tools/config.yaml. `proxyArgs` are passed
// through verbatim (e.g. --tui, --standalone). Inherits stdio and forwards
// signals so the user drives it directly (Ctrl+C shuts the server down).
export async function runCliProxy(proxyArgs: string[] = []): Promise<number> {
  await ensureCliProxy();
  const argv = [BINARY, "-config", CONFIG_PATH, ...proxyArgs];
  log("Spawning: %s", argv.join(" "));
  const child = cp.spawn(argv[0], argv.slice(1), { stdio: "inherit" });

  const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  process.on("exit", () => child.kill());

  return new Promise((resolve) =>
    child.on("exit", (code) => resolve(code ?? 0)),
  );
}
