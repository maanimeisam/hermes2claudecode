import Debug from "debug";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { args } from "../args.ts";
import { readConfig, writeConfig } from "../config-yaml.ts";
import { config } from "../config.ts";
import { createOAuthHttpClient } from "../http-client.ts";
import { sleep } from "../utils.ts";
import { BaseProvider } from "./base-provider.ts";

const log = Debug("useclaudeproxy:opencode");
const errorLog = Debug("useclaudeproxy:opencode:error");
const WATCH_INTERVAL_MS = 7000;

type Token = {
  key: string;
};

function generateRequestId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateSessionId(): string {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

function toOpencodeSession(id: string | undefined | null): string | null {
  const stripped = String(id ?? "")
    .replace(/^ses_/, "")
    .replace(/-/g, "");
  return stripped ? `ses_${stripped}` : null;
}

function buildOpenCodeHeaders(sessionId?: string): Record<string, string> {
  const currentSession = toOpencodeSession(sessionId) ?? generateSessionId();
  return {
    "Content-Type": "application/json",
    "User-Agent":
      "opencode/1.18.23 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
    "x-opencode-client": "cli",
    "x-opencode-session": currentSession,
    "x-opencode-request": generateRequestId(),
    "x-opencode-project": "global",
    accept: "*/*",
    "accept-encoding": "gzip, deflate, br",
  };
}

export class OpenCodeProvider extends BaseProvider {
  readonly name = "opencode";
  readonly baseUrl = "https://opencode.ai/zen/v1";
  readonly tokenPath = path.join(config.DATA_DIR, "opencode-tokens.json");
  private readonly http = createOAuthHttpClient();
  async initConfig(): Promise<void> {
    const config = readConfig();

    config["host"] = args.host;
    config["port"] = args.port;
    config["api-keys"] = [args.cliKey];
    config["openai-compatibility"] = [{ name: this.name }];

    const api = config["openai-compatibility"][0];
    api["base-url"] = this.baseUrl;
    api["models"] = [
      { name: args.model, alias: "claude-opus-5" },
      { name: args.model, alias: "" },
    ];
    api["disable-cooling"] = true;

    api["headers"] = buildOpenCodeHeaders();

    const token = await this.getValidToken();
    this.setApiKey(token.key);

    writeConfig(config);
  }

  async getValidToken(): Promise<Token> {
    if (fs.existsSync(this.tokenPath)) {
      const token = this.readStoredToken<Token>();
      if (token) return token;
    }

    const token: Token = {
      key: "public",
    };
    this.saveTokens(token);

    return token;
  }

  override saveTokens(token: Token): void {
    super.saveTokens(token);
    this.setApiKey(token.key);
  }

  async startTokenWatcher(signal?: AbortSignal): Promise<void> {
    const cfg = readConfig();
    const token = await this.getValidToken();

    log(
      "Watching OpenCode provider at %s every %dms",
      this.baseUrl,
      WATCH_INTERVAL_MS,
    );
    while (!signal?.aborted) {
      try {
        const res = await this.http.post(`${this.baseUrl}/chat/completions`, {
          headers: {
            ...buildOpenCodeHeaders(),
            Authorization: `Bearer ${token.key}`,
          },
          json: {
            model: args.model,
            messages: [{ role: "user", content: "ping" }],
            stream: false,
            max_tokens: 5,
            temperature: 0.5,
            reasoning_effort: "low",
            stream_options: { include_usage: true },
          },
          throwHttpErrors: false,
          retry: { limit: 0 },
          timeout: { request: 30_000 },
          https: { rejectUnauthorized: false },
        });
        if (res.statusCode !== 200) {
          throw new Error(`StatusCode: ${res.statusCode}`);
        }
        log("OpenCode provider reachable");
      } catch (err) {
        errorLog("OpenCode provider unavailable: %o", err);
      }
      await sleep(WATCH_INTERVAL_MS, signal);
    }
  }
}

export const openCodeProvider = new OpenCodeProvider();
