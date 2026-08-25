import Debug from "debug";
import type { Got, Response } from "got";
import {
  AccessDeniedError,
  DeviceCodeExpiredError,
  OAuthHttpError,
  type AccountInfo,
  type DeviceCodeResponse,
  type TokenErrorResponse,
  type TokenResponse,
} from "./types.ts";

const log = Debug("app:oauth");

const OAUTH_BASE_URL = "https://portal.nousresearch.com/api/oauth";
const CLIENT_ID = "hermes-cli";
const SCOPE = "inference:invoke";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const POLL_INTERVAL_MS = 6000;

const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
};

/**
 * Encapsulates the Nous Research OAuth 2.0 Device Authorization Grant flow.
 * Each public method corresponds to exactly one step of the flow.
 */
export class DeviceFlowClient {
  constructor(private readonly http: Got) {}

  async requestDeviceCode(): Promise<DeviceCodeResponse> {
    log("Requesting device code");

    const response = await this.http.post(`${OAUTH_BASE_URL}/device/code`, {
      headers: FORM_HEADERS,
      body: `client_id=${CLIENT_ID}&scope=${encodeURIComponent(SCOPE)}`,
    });

    return this.parseOrThrow<DeviceCodeResponse>(
      response,
      "Failed to get device code",
    );
  }

  /**
   * Polls the token endpoint until the user authorizes, the code expires,
   * or access is denied.
   */
  async pollForToken(deviceCode: string): Promise<TokenResponse> {
    log("Polling for token");

    while (true) {
      await sleep(POLL_INTERVAL_MS);

      const response = await this.http.post(`${OAUTH_BASE_URL}/token`, {
        headers: FORM_HEADERS,
        body: `grant_type=${GRANT_TYPE}&client_id=${CLIENT_ID}&device_code=${deviceCode}`,
      });

      log(
        "Token poll result: status=%d, body=%s",
        response.statusCode,
        response.body,
      );

      if (response.statusCode === 200) {
        return parseBody<TokenResponse>(response);
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

    const response = await this.http.post(`${OAUTH_BASE_URL}/token`, {
      headers: { ...FORM_HEADERS, "X-Nous-Refresh-Token": refreshToken },
      body: `grant_type=refresh_token&client_id=${CLIENT_ID}`,
    });

    return this.parseOrThrow<TokenResponse>(
      response,
      "Failed to refresh token",
    );
  }

  async fetchAccountInfo(accessToken: string): Promise<AccountInfo> {
    log("Fetching account information");

    const response = await this.http.get(`${OAUTH_BASE_URL}/account`, {
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

  /** Terminal (non-retryable) polling errors raise; transient ones fall through to retry. */
  private handlePollingError(error: TokenErrorResponse): void {
    log("Polling error data: %o", error);

    switch (error.error) {
      case "authorization_pending":
      case "slow_down":
        return; // keep polling
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

  private parseOrThrow<T>(response: Response, failureMessage: string): T {
    if (response.statusCode !== 200) {
      log("%s (status=%d)", failureMessage, response.statusCode);
      throw new OAuthHttpError(
        failureMessage,
        response.statusCode,
        response.body,
      );
    }
    return parseBody<T>(response);
  }
}

function parseBody<T>(response: Response): T {
  return typeof response.body === "string"
    ? JSON.parse(response.body)
    : (response.body as T);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
