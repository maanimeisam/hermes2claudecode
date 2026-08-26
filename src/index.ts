#!/usr/bin/env node

import Debug from "debug";
import { app } from "./app.ts";
import { config } from "./config.js";
import {
  AccessDeniedError,
  DeviceCodeExpiredError,
  OAuthHttpError,
} from "./types.ts";

const log = Debug("useclaudeproxy:oauth");
const errorLog = Debug("useclaudeproxy:oauth:error");

log("Enviroment: %s", config.NODE_ENV);
if (config.NODE_ENV === "development" && config.DEBUG)
  Debug.enable(config.DEBUG);

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
