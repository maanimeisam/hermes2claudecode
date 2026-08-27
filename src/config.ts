import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { args } from "./args.ts";

// All config is supplied via CLI flags (see args.ts). Validated with zod and
// frozen. Importing this module also creates DATA_DIR.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  DATA_DIR: z.string().default("data"),
  DEBUG: z.string().optional(),

  // Proxy
});

const parsedEnv = envSchema.safeParse({
  NODE_ENV: args.nodeEnv,
  DATA_DIR: args.dataDir,
  DEBUG: args.debug,
});
if (!parsedEnv.success) {
  console.error("❌ Invalid arguments:");
  console.error(z.prettifyError(parsedEnv.error));
  process.exit(1);
}

export const config = Object.freeze(parsedEnv.data);
export type Config = typeof config;
fs.mkdirSync(config.DATA_DIR, { recursive: true });

// Shared token-storage path. Which provider wrote it is the provider's concern;
// where it lives on disk is core infra.
export const TOKENS_PATH = path.join(config.DATA_DIR, "tokens.json");
export const WATCH_INTERVAL_MS = 7000;
