import Debug from "debug";
import fs from "node:fs";
import open from "open";
import { args } from "../args.ts";
import { readConfig, writeConfig } from "../config-yaml.ts";
import { TOKENS_PATH } from "../config.ts";
import { createOAuthHttpClient } from "../http-client.ts";
import {
  AccessDeniedError,
  DeviceCodeExpiredError,
  OAuthHttpError,
  type AccountInfo,
  type DeviceCodeResponse,
  type TokenErrorResponse,
  type TokenResponse,
} from "../types.ts";
import type { Provider } from "./types.ts";

const log = Debug("useclaudeproxy:oauth");
const errorLog = Debug("useclaudeproxy:oauth:error");

const POLL_INTERVAL_MS = 7000;
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};

const OAUTH = {
  baseUrl: "https://portal.nousresearch.com/api/oauth",
  clientId: "hermes-cli",
  scope: "inference:invoke",
  grantType: "urn:ietf:params:oauth:grant-type:device_code",
  refreshTokenHeader: "X-Nous-Refresh-Token",
};

// Device flow client — Hermes-specific (endpoints, headers, error mapping).
class HermesDeviceFlowClient {
  constructor(private readonly http = createOAuthHttpClient()) {}

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    log("Requesting device code");
    const response = await this.http.post(`${OAUTH.baseUrl}/device/code`, {
      headers: FORM_HEADERS,
      body: `client_id=${OAUTH.clientId}&scope=${encodeURIComponent(OAUTH.scope)}`,
    });
    return this.parseOrThrow<DeviceCodeResponse>(
      response,
      "Failed to get device code",
    );
  }

  async pollForToken(deviceCode: string): Promise<TokenResponse> {
    log("Polling for token");
    while (true) {
      await sleep(POLL_INTERVAL_MS);
      const response = await this.http.post(`${OAUTH.baseUrl}/token`, {
        headers: FORM_HEADERS,
        body: `grant_type=${OAUTH.grantType}&client_id=${OAUTH.clientId}&device_code=${deviceCode}`,
      });
      if (response.statusCode === 200)
        return parseBody<TokenResponse>(response);
      if (response.statusCode === 400) {
        this.handlePollingError(parseBody<TokenErrorResponse>(response));
        continue;
      }
      throw new OAuthHttpError(
        `Unexpected status during polling: ${response.statusCode}`,
        response.statusCode,
        response.body,
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    log("Refreshing access token");
    const response = await this.http.post(`${OAUTH.baseUrl}/token`, {
      headers: { ...FORM_HEADERS, [OAUTH.refreshTokenHeader]: refreshToken },
      body: `grant_type=refresh_token&client_id=${OAUTH.clientId}`,
    });
    return this.parseOrThrow<TokenResponse>(
      response,
      "Failed to refresh token",
    );
  }

  async fetchAccountInfo(accessToken: string): Promise<AccountInfo> {
    log("Fetching account information");
    const response = await this.http.get(`${OAUTH.baseUrl}/account`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    return this.parseOrThrow<AccountInfo>(
      response,
      "Failed to fetch account info",
    );
  }

  private handlePollingError(error: TokenErrorResponse): void {
    switch (error.error) {
      case "authorization_pending":
      case "slow_down":
        return;
      case "expired_token":
        throw new DeviceCodeExpiredError();
      case "access_denied":
        throw new AccessDeniedError();
      default:
        throw new OAuthHttpError(
          `Unexpected polling error: ${error.error}`,
          400,
          error,
        );
    }
  }

  private parseOrThrow<T>(
    response: { statusCode: number; body: unknown },
    failureMessage: string,
  ): T {
    if (response.statusCode !== 200) {
      throw new OAuthHttpError(
        failureMessage,
        response.statusCode,
        response.body,
      );
    }
    return parseBody<T>(response);
  }
}

function parseBody<T>(response: { body: unknown }): T {
  return typeof response.body === "string"
    ? JSON.parse(response.body)
    : (response.body as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HermesProvider implements Provider {
  readonly name = "hermes";
  private readonly client = new HermesDeviceFlowClient();

  async getValidToken(): Promise<TokenResponse> {
    const stored = this.readStoredToken();
    if (stored) {
      try {
        await this.client.fetchAccountInfo(stored.access_token);
        log("Stored token valid");
        return stored;
      } catch (err) {
        errorLog("Stored Access-Token invalid: %o", err);
      }
      if (stored.refresh_token) {
        try {
          log("Refreshing stored token");
          const refreshed = await this.client.refreshToken(
            stored.refresh_token,
          );
          this.saveTokens(refreshed);
          return refreshed;
        } catch (err) {
          errorLog("Stored Refresh-Token invalid: %o", err);
        }
      }
    }
    return this.runDeviceFlow();
  }

  async getAccountInfo(accessToken: string): Promise<Record<string, unknown>> {
    return this.client.fetchAccountInfo(accessToken);
  }

  private async runDeviceFlow(): Promise<TokenResponse> {
    const deviceCode = await this.client.requestDeviceCode();
    log("Device code received: user_code=%s", deviceCode.user_code);

    const verificationUrl =
      deviceCode.verification_uri_complete ?? deviceCode.verification_uri;
    await open(verificationUrl).catch((err) =>
      log("Failed to open browser: %o", err),
    );
    console.log(
      `Opened ${verificationUrl}. If it didn't open, enter code ${deviceCode.user_code} there.`,
    );

    const token = await this.client.pollForToken(deviceCode.device_code);
    log("Authorization successful");
    this.initConfig(args.model);
    this.saveTokens(token);
    return token;
  }

  private readStoredToken(): TokenResponse | undefined {
    if (!fs.existsSync(TOKENS_PATH)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8")) as TokenResponse;
    } catch {
      return undefined;
    }
  }

  private saveTokens(token: TokenResponse): void {
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(token, null, 2), {
      mode: 0o600,
    });
    this.setApiKey(token.access_token);
  }

  private initConfig(model: string): void {
    const config = readConfig();

    config["host"] = "127.0.0.1";
    config["api-keys"] = ["456789"];
    config["openai-compatibility"] = [{ name: "Hermes" }];

    const api = config["openai-compatibility"][0];
    api["base-url"] = "https://inference-api.nousresearch.com/v1";
    api["models"] = [
      { name: model, alias: "claude-opus-5" },
      { name: model, alias: "" },
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
    ${model} >>> claude-opus-5
    ${model} >>>

[ClaudeCode]
export ANTHROPIC_MODEL=claude-opus-5
export ANTHROPIC_BASE_URL=http://127.0.0.1:${config["port"]}
export ANTHROPIC_AUTH_TOKEN=${config["api-keys"]}
`;

    console.log(text);
    writeConfig(config);
  }

  private setApiKey(apiKey: string): void {
    const config = readConfig();
    const api = config["openai-compatibility"][0];

    api["api-key-entries"] = [{ "api-key": apiKey }];
    api["headers"]["Authorization"] = `Bearer ${apiKey}`;

    writeConfig(config);
  }
}

export const hermesProvider = new HermesProvider();
