import Debug from "debug";
import cp from "node:child_process";
import path from "node:path";
import { args } from "./args.ts";
import { CONFIG_PATH, setProxyUrl } from "./config-yaml.ts";

const log = Debug("app:run");

const BINARY = path.join(args.toolsDir, "cli-proxy-api");

export async function runCliProxy(proxyArgs: string[] = []): Promise<number> {
  setProxyUrl(args.proxy);

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
