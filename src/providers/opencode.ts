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
            messages: [
              {
                role: "system",
                content:
                  'You are a title generator. You output ONLY a thread title. Nothing else.\n\n<task>\nGenerate a brief title that would help the user find this conversation later.\n\nFollow all rules in <rules>\nUse the <examples> so you know what a good title looks like.\nYour output must be:\n- A single line\n- ≤50 characters\n- No explanations\n</task>\n\n<rules>\n- you MUST use the same language as the user message you are summarizing\n- Title must be grammatically correct and read naturally - no word salad\n- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")\n- Focus on the main topic or question the user needs to retrieve\n- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"\n- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it\n- Keep exact: technical terms, numbers, filenames, HTTP codes\n- Remove: the, this, my, a, an\n- Never assume tech stack\n- Never use tools\n- NEVER respond to questions, just generate a title for the conversation\n- The title should NEVER include "summarizing" or "generating" when generating a title\n- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT\n- Always output something meaningful, even if the input is minimal.\n- If the user message is short or conversational (e.g. "hello", "lol", "what\'s up", "hey"):\n  → create a title that reflects the user\'s tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)\n</rules>\n\n<examples>\n"debug 500 errors in production" → Debugging production 500 errors\n"refactor user service" → Refactoring user service\n"why is app.js failing" → app.js failure investigation\n"implement rate limiting" → Rate limiting implementation\n"how do I connect postgres to my API" → Postgres API connection\n"best practices for React hooks" → React hooks best practices\n"@src/auth.ts can you add refresh token support" → Auth refresh token support\n"@utils/parser.ts this is broken" → Parser bug fix\n"look at @config.json" → Config review\n"@App.tsx add dark mode toggle" → Dark mode toggle in App\n</examples>\n',
              },
              {
                role: "user",
                content: "Generate a title for this conversation:\n",
              },
              { role: "user", content: "Hello" },
            ],
            stream: false,
            max_tokens: 100,
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
