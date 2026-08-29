import Debug from "debug";
import crypto from "node:crypto";
import path from "node:path";
import open from "open";
import { args } from "../args.ts";
import { readConfig, writeConfig } from "../config-yaml.ts";
import { config } from "../config.ts";
import { createOAuthHttpClient } from "../http-client.ts";
import { type AccountInfo, AccessDeniedError } from "../types.ts";
import { sleep } from "../utils.ts";
import { BaseProvider } from "./base-provider.ts";

const log = Debug("useclaudeproxy:cline");
const errorLog = Debug("useclaudeproxy:cline:error");

const WATCH_INTERVAL_MS = 7000;
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  user?: Record<string, unknown>;
  authentication_method?: string;
};

type TokenErrorResponse = {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | string;
  error_description?: string;
};

class OAuthHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "OAuthHttpError";
  }
}

class DeviceCodeExpiredError extends Error {
  constructor() {
    super("Device code expired before authorization completed");
    this.name = "DeviceCodeExpiredError";
  }
}

class ClineDeviceFlowClient {
  OAUTH = {
    deviceCodeUrl: "https://api.workos.com/user_management/authorize/device",
    authenticateUrl: "https://api.workos.com/user_management/authenticate",
    clientId: "client_01K3A541FN8TA3EPPHTD2325AR",
    grantType: "urn:ietf:params:oauth:grant-type:device_code",
    verifyUrl: "https://api.cline.bot/api/v1/users/me/remote-config",
  };
  private pollIntervalMs = 7000;
  constructor(private readonly http = createOAuthHttpClient()) {}

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    log("Requesting device code");
    const response = await this.http.post(this.OAUTH.deviceCodeUrl, {
      headers: FORM_HEADERS,
      body: `client_id=${this.OAUTH.clientId}`,
    });
    const deviceCode = this.parseOrThrow<DeviceCodeResponse>(
      response,
      "Failed to get device code",
    );
    this.pollIntervalMs = (deviceCode.interval || 7) * 1000;
    return deviceCode;
  }

  async pollForToken(deviceCode: string): Promise<TokenResponse> {
    log("Polling for token");
    while (true) {
      await sleep(this.pollIntervalMs);
      const response = await this.http.post(this.OAUTH.authenticateUrl, {
        headers: FORM_HEADERS,
        body: `grant_type=${encodeURIComponent(this.OAUTH.grantType)}&device_code=${deviceCode}&client_id=${this.OAUTH.clientId}`,
      });
      if (response.statusCode === 200) {
        const data = parseBody<TokenResponse>(response);
        data.access_token = `workos:${data.access_token}`;
        return data;
      }

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
    const response = await this.http.post(this.OAUTH.authenticateUrl, {
      headers: FORM_HEADERS,
      body: `grant_type=refresh_token&client_id=${this.OAUTH.clientId}&refresh_token=${refreshToken}`,
    });
    const data = this.parseOrThrow<TokenResponse>(
      response,
      "Failed to refresh token",
    );
    data.access_token = `workos:${data.access_token}`;
    return data;
  }

  async fetchAccountInfo(accessToken: string): Promise<AccountInfo> {
    log("Verifying access token");
    const response = await this.http.get(this.OAUTH.verifyUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "*/*",
        "User-Agent": "Bun/1.3.13",
      },
    });
    const parsed = this.parseOrThrow<{ data: unknown; success: boolean }>(
      response,
      "Failed to verify access token",
    );
    if (!parsed.success) {
      throw new OAuthHttpError(
        "Access token invalid (remote-config success=false)",
        response.statusCode,
        parsed,
      );
    }
    return parsed as AccountInfo;
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

function generateTaskId(): string {
  return `${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

export class ClineProvider extends BaseProvider {
  readonly name = "cline";
  readonly baseUrl = "https://api.cline.bot/api/v1";
  readonly tokenPath = path.join(config.DATA_DIR, "cline-tokens.json");
  private readonly client = new ClineDeviceFlowClient();

  async initConfig(): Promise<void> {
    const cfg = readConfig();

    cfg["host"] = args.host;
    cfg["port"] = args.port;
    cfg["api-keys"] = [args.cliKey];
    cfg["openai-compatibility"] = [{ name: this.name }];

    const api = cfg["openai-compatibility"][0];
    api["base-url"] = this.baseUrl;
    api["models"] = [
      { name: args.model, alias: "claude-opus-5" },
      { name: args.model, alias: "" },
    ];

    api["headers"] = {
      "Content-Type": "application/json",
      "Http-Referer": "https://cline.bot",
      "User-Agent":
        "Cline/4.1.16 ai-sdk/openai-compatible/3.0.30 ai-sdk/provider-utils/5.0.27 runtime/node.js/v24.18.1",
      "X-Client-Type": "VSCode Extension",
      "X-Client-Version": "4.1.16",
      "X-Core-Version": "0.0.79",
      "X-Is-Multiroot": "true",
      "X-Platform": "Visual Studio Code",
      "X-Platform-Version": "1.135.0",
      "X-Task-Id": generateTaskId(),
      "X-Title": "Cline",
      Accept: "*/*",
      "Accept-Language": "*",
      "Sec-Fetch-Mode": "cors",
      "Accept-Encoding": "gzip, deflate, br",
    };

    api["disable-cooling"] = true;

    const token = await this.getValidToken();
    this.setApiKey(token.access_token);

    writeConfig(cfg);
  }

  async getValidToken(): Promise<TokenResponse> {
    const stored = this.readStoredToken<TokenResponse>();
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

  async startTokenWatcher(signal?: AbortSignal): Promise<void> {
    log("Watching token every %dms", WATCH_INTERVAL_MS);
    let current = (await this.getValidToken()).access_token;
    while (!signal?.aborted) {
      try {
        await this.client.fetchAccountInfo(current);
        log("Token valid");
      } catch (err) {
        errorLog("Token invalid, renewing: %o", err);
        const refreshed = await this.getValidToken();
        current = refreshed.access_token;
        log("Token RENEWED");
      }
      await sleep(WATCH_INTERVAL_MS, signal);
    }
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
    this.saveTokens(token);
    return token;
  }

  override saveTokens(token: TokenResponse): void {
    super.saveTokens(token);
    this.setApiKey(token.access_token);
  }
}

export const clineProvider = new ClineProvider();
