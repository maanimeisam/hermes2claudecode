#!/usr/bin/env node

import Debug from "debug";
import { app } from "./app.ts";
import { PROVIDERS, args } from "./args.ts";
import { setOpenAICompatApiKey, setProxyUrl } from "./config-yaml.ts";
import { config } from "./config.js";
import {
  AccessDeniedError,
  DeviceCodeExpiredError,
  OAuthHttpError,
} from "./types.ts";

const log = Debug("app:oauth");
const errorLog = Debug("app:oauth:error");

log("Enviroment: %s", config.NODE_ENV);
if (config.NODE_ENV === "development" && config.DEBUG)
  Debug.enable(config.DEBUG);

if (args.command === "set-token") {
  if (!PROVIDERS.includes(args.provider!)) {
    console.error(
      `Unknown provider "${args.provider}". Use one of: ${PROVIDERS.join(", ")}`,
    );
    process.exit(1);
  }
  try {
    setOpenAICompatApiKey(args.token!);
    console.log(`✅ Set ${args.provider}-api-key in config.yaml`);
    process.exit(0);
  } catch (err) {
    errorLog("Failed to set token: %o", err);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (args.command === "set-proxy") {
  try {
    const url = args.proxyUrl ?? "";
    setProxyUrl(url);
    console.log(`✅ Set proxy-url: ${url}`);
    process.exit(0);
  } catch (err) {
    errorLog("Failed to set proxy: %o", err);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

app().catch((err) => {
  if (
    err instanceof DeviceCodeExpiredError ||
    err instanceof AccessDeniedError
  ) {
    errorLog(err.message);
    console.error(err.message);
  } else if (err instanceof OAuthHttpError) {
    errorLog(
      "OAuth request failed: %s (status=%d) body=%o",
      err.message,
      err.statusCode,
      err.body,
    );
    console.error(err.message);
  } else {
    errorLog("Fatal error: %o", err);
    console.error(err);
  }
  process.exit(1);
});
