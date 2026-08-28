import Debug from "debug";
import path from "node:path";
import open from "open";
import { args } from "../args.ts";
import { readConfig, writeConfig } from "../config-yaml.ts";
import { config } from "../config.ts";
import { createOAuthHttpClient } from "../http-client.ts";
import { type AccountInfo, AccessDeniedError } from "../types.ts";
import { sleep } from "../utils.ts";
import { BaseProvider } from "./base-provider.ts";

const log = Debug("useclaudeproxy:hermes");
const errorLog = Debug("useclaudeproxy:hermes:error");

const POLL_INTERVAL_MS = 7000;
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
  token_type: string;
  expires_in?: number;
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

class HermesDeviceFlowClient {
  OAUTH = {
    baseUrl: "https://portal.nousresearch.com/api/oauth",
    clientId: "hermes-cli",
    scope: "inference:invoke",
    grantType: "urn:ietf:params:oauth:grant-type:device_code",
    refreshTokenHeader: "X-Nous-Refresh-Token",
  };
  constructor(private readonly http = createOAuthHttpClient()) {}

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    log("Requesting device code");
    const response = await this.http.post(`${this.OAUTH.baseUrl}/device/code`, {
      headers: FORM_HEADERS,
      body: `client_id=${this.OAUTH.clientId}&scope=${encodeURIComponent(this.OAUTH.scope)}`,
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
      const response = await this.http.post(`${this.OAUTH.baseUrl}/token`, {
        headers: FORM_HEADERS,
        body: `grant_type=${this.OAUTH.grantType}&client_id=${this.OAUTH.clientId}&device_code=${deviceCode}`,
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
    const response = await this.http.post(`${this.OAUTH.baseUrl}/token`, {
      headers: {
        ...FORM_HEADERS,
        [this.OAUTH.refreshTokenHeader]: refreshToken,
      },
      body: `grant_type=refresh_token&client_id=${this.OAUTH.clientId}`,
    });
    return this.parseOrThrow<TokenResponse>(
      response,
      "Failed to refresh token",
    );
  }

  async fetchAccountInfo(accessToken: string): Promise<AccountInfo> {
    log("Fetching account information");
    const response = await this.http.get(`${this.OAUTH.baseUrl}/account`, {
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

export class HermesProvider extends BaseProvider {
  readonly name = "hermes";
  readonly baseUrl = "https://inference-api.nousresearch.com/v1";
  readonly tokenPath = path.join(config.DATA_DIR, "hermes-tokens.json");
  private readonly client = new HermesDeviceFlowClient();

  async initConfig(): Promise<void> {
    const config = readConfig();

    config["host"] = args.host;
    config["api-keys"] = [args.cliKey];
    config["openai-compatibility"] = [{ name: this.name }];

    const api = config["openai-compatibility"][0];
    api["base-url"] = this.baseUrl;
    api["models"] = [
      { name: args.model, alias: "claude-opus-5" },
      { name: args.model, alias: "" },
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

    const token = await this.getValidToken();
    this.setApiKey(token.access_token);

    writeConfig(config);
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
        const account = await this.client.fetchAccountInfo(current);
        // log("Account Information:", account);
        log("Token valid");
      } catch (err) {
        errorLog("Token invalid, renewing: %o", err);
        const refreshed = await this.getValidToken();
        current = refreshed.access_token;
        log(`Token RENEWED (expires_in=${refreshed.expires_in})`);
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

export const hermesProvider = new HermesProvider();
