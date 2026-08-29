import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { args } from "./args.ts";

let cache: Record<string, any> | undefined;
export const CONFIG_PATH = path.join(args.toolsDir, "config.yaml");

export function readConfig(
  filePath: string = CONFIG_PATH,
): Record<string, any> {
  if (!cache) {
    cache = (YAML.parse(fs.readFileSync(filePath, "utf8")) ?? {}) as Record<
      string,
      any
    >;
  }
  return cache;
}

export function writeConfig(
  config: Record<string, any>,
  filePath: string = CONFIG_PATH,
): void {
  fs.writeFileSync(filePath, YAML.stringify(config), "utf8");
  cache = config;
}

export function setProxyUrl(proxyUrl: string): void {
  const url = proxyUrl.trim();
  const PROXY_RE = /^(socks5|http|https):\/\//i;

  if (url !== "" && !/^(direct|none)$/i.test(url) && !PROXY_RE.test(url)) {
    throw new Error(
      `Invalid proxy-url: ${url} (use http/https/socks5://..., "direct", "none", or "")`,
    );
  }

  const config = readConfig();
  config["proxy-url"] = url;
  writeConfig(config);
}
