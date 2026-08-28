import Debug from "debug";
import fs from "node:fs";
import path from "node:path";
import { args } from "../args.ts";
import { readConfig, writeConfig } from "../config-yaml.ts";
import { config } from "../config.ts";
import { createOAuthHttpClient } from "../http-client.ts";
import { sleep } from "../utils.ts";
import { BaseProvider } from "./base-provider.ts";

const log = Debug("useclaudeproxy:custom");
const errorLog = Debug("useclaudeproxy:custom:error");
const WATCH_INTERVAL_MS = 7000;

type Token = {
  key: string;
};

export class CustomProvider extends BaseProvider {
  readonly name = "custom";
  readonly baseUrl = args.url;
  readonly tokenPath = path.join(config.DATA_DIR, "custom-tokens.json");
  private readonly http = createOAuthHttpClient();

  async initConfig(): Promise<void> {
    const config = readConfig();

    config["host"] = "127.0.0.1";
    config["api-keys"] = ["456789"];
    config["openai-compatibility"] = [{ name: this.name }];

    const api = config["openai-compatibility"][0];
    api["base-url"] = this.baseUrl;
    api["models"] = [
      { name: args.model, alias: "claude-opus-5" },
      { name: args.model, alias: "" },
    ];
    api["disable-cooling"] = true;

    api["headers"] = {};

    const token = await this.getValidToken();
    this.setApiKey(token.key);

    writeConfig(config);
  }

  async getValidToken(): Promise<Token> {
    if (fs.existsSync(this.tokenPath)) {
      const token = this.readStoredToken<Token>();
      if (token) return token;
    }

    const token: Token = { key: args.api };
    this.saveTokens(token);
    return token;
  }

  override saveTokens(token: Token): void {
    super.saveTokens(token);
    this.setApiKey(token.key);
  }

  async startTokenWatcher(signal?: AbortSignal): Promise<void> {
    const token = await this.getValidToken();

    log(
      "Watching custom provider at %s every %dms",
      this.baseUrl,
      WATCH_INTERVAL_MS,
    );
    while (!signal?.aborted) {
      try {
        const res = await this.http.post(`${this.baseUrl}/chat/completions`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token.key}`,
          },
          json: {
            model: args.model,
            messages: [{ role: "user", content: "ping" }],
            stream: false,
            max_tokens: 10,
          },
          throwHttpErrors: false,
          retry: { limit: 0 },
          timeout: { request: 30_000 },
          https: { rejectUnauthorized: false },
        });
        if (res.statusCode !== 200) {
          throw new Error(`StatusCode: ${res.statusCode}`);
        }
        log("Custom provider reachable");
      } catch (err) {
        errorLog("Custom provider unavailable: %o", err);
      }
      await sleep(WATCH_INTERVAL_MS, signal);
    }
  }
}

export const customProvider = new CustomProvider();
