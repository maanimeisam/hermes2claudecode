import Debug from "debug";
import fs from "node:fs";
import open from "open";
import { args } from "./args.ts";
import {
  initConfig,
  setOpenAICompatApiKey,
  setProxyUrl,
} from "./config-yaml.ts";
import { TOKENS_PATH, WATCH_INTERVAL_MS } from "./config.ts";
import { DeviceFlowClient } from "./device-flow-client.ts";
import { createOAuthHttpClient } from "./http-client.ts";
import { ensureCliProxy } from "./install-cli-proxy.ts";
import { runCliProxy } from "./run-cli-proxy.ts";
import type { TokenResponse } from "./types.ts";

const log = Debug("app:oauth");
const errorLog = Debug("app:oauth:error");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveTokens(token: TokenResponse): void {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(token, null, 2), {
    mode: 0o600,
  });
  setOpenAICompatApiKey(token.access_token);
}

async function getValidToken(client: DeviceFlowClient): Promise<TokenResponse> {
  let token: TokenResponse | undefined;
  if (fs.existsSync(TOKENS_PATH)) {
    try {
      token = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8")) as TokenResponse;
      await client.fetchAccountInfo(token.access_token);
      log("Stored token valid");
      return token;
    } catch (err) {
      errorLog("Stored Access-Token invalid: %o", err);
    }
  }

  // No valid stored token → refresh if possible, else run the device flow.
  if (token?.refresh_token) {
    try {
      log("Refreshing stored token");
      const refreshed = await client.refreshToken(token.refresh_token);
      saveTokens(refreshed);
      return refreshed;
    } catch (err) {
      errorLog("Stored Refresh-Token invalid: %o", err);
    }
  }

  return runDeviceFlow(client);
}

async function runDeviceFlow(client: DeviceFlowClient): Promise<TokenResponse> {
  const deviceCode = await client.requestDeviceCode();
  log("Device code received: user_code=%s", deviceCode.user_code);

  const verificationUrl =
    deviceCode.verification_uri_complete ?? deviceCode.verification_uri;
  await open(verificationUrl).catch((err) =>
    log("Failed to open browser: %o", err),
  );
  console.log(
    `Opened ${verificationUrl}. If it didn't open, enter code ${deviceCode.user_code} there.`,
  );

  const token = await client.pollForToken(deviceCode.device_code);
  log("Authorization successful");
  initConfig();
  saveTokens(token);
  return token;
}

export async function app(): Promise<void> {
  log("Starting Hermes OAuth Device Flow");

  await ensureCliProxy();

  const client = new DeviceFlowClient(createOAuthHttpClient());
  const token = await getValidToken(client);

  const account = await client.fetchAccountInfo(token.access_token);
  log("Account Information:\n" + JSON.stringify(account, null, 2));

  setProxyUrl(args.proxy);
  runCliProxy(args.passthrough)
    .then((code) => process.exit(code))
    .catch((err) => {
      errorLog("Failed to run CLIProxyAPI: %o", err);
      console.error(err);
      process.exit(1);
    });

  log("Watching token every %dms", WATCH_INTERVAL_MS);
  let current = token.access_token;
  while (true) {
    await sleep(WATCH_INTERVAL_MS);
    // getValidToken checks via fetchAccountInfo and renews (refresh/device flow) if invalid.
    const refreshed = await getValidToken(client);
    const renewed = refreshed.access_token !== current;
    current = refreshed.access_token;
    console.log(
      `Token ${renewed ? "RENEWED" : "valid"} (expires_in=${refreshed.expires_in})`,
    );
  }
}
