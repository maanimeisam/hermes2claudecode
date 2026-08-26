import Debug from "debug";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CONFIG_PATH, readConfig, writeConfig } from "./config-yaml.ts";

if (!process.env.DEBUG) {
  Debug.enable("app:*");
}

const log = Debug("app:main");
const logRead = Debug("app:read");
const logWrite = Debug("app:write");
const logArray = Debug("app:array");
const logProxy = Debug("app:proxy");
const logProvider = Debug("app:provider");
const logOpenAI = Debug("app:openai-compat");
const logCache = Debug("app:cache");
const logError = Debug("app:error");

const SEED_CONFIG_PATH = CONFIG_PATH;
// const SEED_CONFIG_PATH = path.join(import.meta.dirname, "config.sample.yaml");

function dumpFile(
  filePath: string,
  logger: Debug.Debugger,
  label: string,
): void {
  logger("%s:\n%s", label, fs.readFileSync(filePath, "utf8"));
}

// The old setProxyUrl() validated the value before writing it. `write()` no
// longer knows anything about specific keys, so validation like this now
// lives at the call site instead.
function assertValidProxyUrl(url: string): void {
  const u = url.trim();
  const isEmpty = u === "";
  const isKeyword = /^(direct|none)$/i.test(u);
  const isProxyScheme = /^(socks5|http|https):\/\//i.test(u);
  if (!isEmpty && !isKeyword && !isProxyScheme) {
    throw new Error(
      `Invalid proxy-url: ${url} (use http/https/socks5://..., "direct", "none", or "")`,
    );
  }
}

async function main(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "app-config-"));
  const configPath = path.join(workDir, "config.yaml");
  fs.copyFileSync(SEED_CONFIG_PATH, configPath);
  log("copied seed config.yaml to scratch path %s", configPath);
  dumpFile(configPath, logRead, "initial config");

  const config = readConfig(configPath);

  logRead("config.host -> %o", config.host);
  logRead("config.port -> %o", config.port);
  logRead("config.debug -> %o", config.debug);
  logRead("config['does-not-exist'] -> %o", config["does-not-exist"]);

  // --- scalar values: just assign directly ---
  config.port = 9090;
  logWrite("config.port = 9090 -> now reads %o", config.port);

  config.debug = true;
  logWrite("config.debug = true -> now reads %o", config.debug);

  config["ws-auth"] = false;
  logWrite("config['ws-auth'] = false -> now reads %o", config["ws-auth"]);

  // --- arrays: ordinary array methods, no dedicated helpers needed ---
  logArray("config['api-keys'] -> %O", config["api-keys"]);

  (config["api-keys"] as string[]).push("your-api-key-4");
  logArray("api-keys.push('your-api-key-4') -> %O", config["api-keys"]);

  config["api-keys"] = (config["api-keys"] as string[]).filter(
    (key) => key !== "your-api-key-2",
  );
  logArray("api-keys filtered out 'your-api-key-2' -> %O", config["api-keys"]);

  config["api-keys"] = ["fresh-key-a", "fresh-key-b"];
  logArray("api-keys reassigned wholesale -> %O", config["api-keys"]);

  config["excluded-models"] = [
    ...((config["excluded-models"] as string[] | undefined) ?? []),
    "gpt-5-*",
  ];
  logArray(
    "excluded-models created on demand -> %O",
    config["excluded-models"],
  );

  logArray(
    "Array.isArray(config.port) -> %o (port is a scalar, not an array)",
    Array.isArray(config.port),
  );

  // --- proxy-url: validate, then assign ---
  assertValidProxyUrl("socks5://proxy.example.com:1080");
  config["proxy-url"] = "socks5://proxy.example.com:1080";
  logProxy("proxy-url = 'socks5://...' -> %o", config["proxy-url"]);

  assertValidProxyUrl("direct");
  config["proxy-url"] = "direct";
  logProxy("proxy-url = 'direct' -> %o", config["proxy-url"]);

  assertValidProxyUrl("");
  config["proxy-url"] = "";
  logProxy("proxy-url = '' -> %o", config["proxy-url"]);

  try {
    assertValidProxyUrl("ftp://not-supported");
    config["proxy-url"] = "ftp://not-supported";
  } catch (err) {
    logError(
      "assertValidProxyUrl('ftp://not-supported') threw: %s",
      (err as Error).message,
    );
  }

  // --- provider API keys: `${provider}-api-key` is [{ "api-key": string }] ---
  function setProviderApiKey(provider: string, apiKey: string): void {
    const key = `${provider}-api-key`;
    const entries = config[key] as Array<{ "api-key": string }> | undefined;
    if (!entries?.length) {
      config[key] = [{ "api-key": apiKey }];
    } else {
      entries[0]["api-key"] = apiKey;
    }
  }

  setProviderApiKey("claude", "sk-ant-demo-111");
  logProvider("after first setProviderApiKey -> %O", config["claude-api-key"]);

  setProviderApiKey("claude", "sk-ant-demo-222");
  logProvider("after second setProviderApiKey -> %O", config["claude-api-key"]);

  setProviderApiKey("gemini", "AIzaSy-demo-key");
  logProvider(
    "after setProviderApiKey for gemini -> %O",
    config["gemini-api-key"],
  );

  // --- openai-compatibility: [{ "api-key-entries": [{ "api-key": string }] }] ---
  function setOpenAICompatApiKey(apiKey: string): void {
    type Entry = { "api-key": string };
    type Provider = { "api-key-entries": Entry[] };
    const providers = config["openai-compatibility"] as Provider[] | undefined;

    if (!providers?.length) {
      config["openai-compatibility"] = [
        { "api-key-entries": [{ "api-key": apiKey }] },
      ];
      return;
    }

    const entries = providers[0]["api-key-entries"];
    if (!entries?.length) {
      providers[0]["api-key-entries"] = [{ "api-key": apiKey }];
    } else {
      entries[0]["api-key"] = apiKey;
    }
  }

  setOpenAICompatApiKey("hermes-demo-key-1");
  logOpenAI(
    "after first setOpenAICompatApiKey -> %O",
    config["openai-compatibility"],
  );

  setOpenAICompatApiKey("hermes-demo-key-2");
  logOpenAI(
    "after second setOpenAICompatApiKey -> %O",
    config["openai-compatibility"],
  );

  // --- one write() persists every mutation made above ---
  writeConfig(config, configPath);
  logWrite("write(config) -> persisted to %s", configPath);
  dumpFile(configPath, log, "config after write()");

  // --- cache behavior ---
  const readAgain = readConfig(configPath);
  logCache(
    "read() right after write() returns the same object: %o",
    readAgain === config,
  );

  fs.writeFileSync(configPath, "mutated-on-disk: true\n", "utf8");
  const stillCached = readConfig(configPath);
  logCache(
    "read() after an out-of-band file edit still returns the cache (no write() happened): %o",
    stillCached === config,
  );

  writeConfig(config, configPath);
  dumpFile(
    configPath,
    logCache,
    "write() overwrote the out-of-band edit with the in-memory config",
  );

  fs.rmSync(workDir, { recursive: true, force: true });
  log("cleaned up %s", workDir);
}

main().catch((err) => {
  logError("example script failed: %O", err);
  process.exitCode = 1;
});
