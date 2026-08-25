import Debug from "debug";
import got, { type ExtendOptions, type Got } from "got";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { args } from "./args.ts";

const log = Debug("app:proxy:upstream-client");

/**
 * Builds a `got` instance configured for the upstream OAuth provider,
 * optionally routed through the configured HTTP(S) proxy.
 *
 * This module has one job: produce a correctly-configured HTTP client.
 * It knows nothing about OAuth flows, device codes, or polling.
 */
export function createOAuthHttpClient(): Got {
  log("Proxy=%s", args.proxy);

  const options: ExtendOptions = {
    https: { rejectUnauthorized: false },
    headers: { "Content-Type": "application/json" },
    retry: { limit: 0 },
    throwHttpErrors: false,
    timeout: { request: undefined },
    ...(args.proxy ? { agent: buildProxyAgents() } : {}),
  };

  return got.extend(options);
}

function buildProxyAgents() {
  const agentOptions = { keepAlive: true, keepAliveMsecs: 30_000 };

  return {
    http: new HttpProxyAgent(args.proxy, agentOptions),
    https: new HttpsProxyAgent(args.proxy, agentOptions),
  };
}
