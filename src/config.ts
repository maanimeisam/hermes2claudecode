import fs from "node:fs";
import { z } from "zod";
import { args } from "./args.ts";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  DATA_DIR: z.string().default("data"),
  DEBUG: z.string().optional(),

  // Proxy
});

const parsedEnv = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  DATA_DIR: args.dataDir,
  DEBUG: process.env.DEBUG,
});
if (!parsedEnv.success) {
  console.error("❌ Invalid arguments:");
  console.error(z.prettifyError(parsedEnv.error));
  process.exit(1);
}

export const config = Object.freeze(parsedEnv.data);
export type Config = typeof config;
fs.mkdirSync(config.DATA_DIR, { recursive: true });
