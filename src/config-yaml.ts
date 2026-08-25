import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

let cache: Record<string, any> | undefined;
export const CONFIG_PATH = path.join(
  import.meta.dirname,
  "..",
  "tools",
  "config.yaml",
);

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

export function initConfig() {
  const config = readConfig();

  config["host"] = "127.0.0.1";
  config["api-keys"] = ["456789"];
  config["openai-compatibility"] = [{ name: "Hermes" }];

  const api = config["openai-compatibility"][0];
  api["base-url"] = "https://inference-api.nousresearch.com/v1";
  api["models"] = [
    {
      name: "tencent/hy3:free",
      alias: "claude-opus-5",
    },
    {
      name: "tencent/hy3:free",
      alias: "",
    },
  ];

  api["headers"] = {
    "User-Agent": "OpenAI/Python 2.24.0",
    "X-Stainless-Arch": "x64",
    "X-Stainless-Async": "false",
    "X-Stainless-Lang": "python",
    "X-Stainless-Os": "Linux",
    "X-Stainless-Package-Version": "2.24.0",
    "X-Stainless-Read-Timeout": "30.0",
    "X-Stainless-Retry-Count": "0",
    "X-Stainless-Runtime": "CPython",
    "X-Stainless-Runtime-Version": "3.11.15",
  };

  api["disable-cooling"] = true;

  const text = `
#API-KEY: ${config["api-keys"]}
OpenAI-compatible: http://127.0.0.1:${config["port"]}/v1
Anthropic-compatible: http://127.0.0.1:${config["port"]}
Gemini-compatible: http://127.0.0.1:${config["port"]}

Model >>> Alias:
    tencent/hy3:free >>> claude-opus-5
    tencent/hy3:free >>>

[ClaudeCode]
export ANTHROPIC_MODEL=claude-opus-5
export ANTHROPIC_BASE_URL=http://127.0.0.1:${config["port"]}
export ANTHROPIC_AUTH_TOKEN=${config["api-keys"]}
`;

  console.log(text);
  writeConfig(config);
}

export function setOpenAICompatApiKey(apiKey: string) {
  const config = readConfig();
  const api = config["openai-compatibility"][0];

  api["api-key-entries"] = [{ "api-key": apiKey }];
  api["headers"]["Authorization"] = `Bearer ${apiKey}`;

  writeConfig(config);
}

export function setProxyUrl(proxyUrl: string) {
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
