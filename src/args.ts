import { Command } from "commander";

export const PROVIDERS = ["claude", "gemini", "codex"];

interface CliArgs {
  force: boolean;
  nodeEnv: string;
  debug: string;
  dataDir: string;
  proxy: string;
  renew: boolean;
  activeProvider: string;
  provider?: string;
  token?: string;
  proxyUrl?: string;
  model: string;
}

const program = new Command();

program
  .name("useclaudeproxy")
  .description("Hermes OAuth Device Flow")
  .option("--node-env <env>", "development | production", "development")
  .option(
    "--debug <ns>",
    'debug namespaces, e.g. "useclaudeproxy:*"',
    "useclaudeproxy:*",
  )
  .option("--data-dir <dir>", "token storage directory", "data")
  .requiredOption(
    "--model <model>",
    "model name to expose in openai-compatibility",
  )
  .option(
    "--proxy <url>",
    'CLIProxyAPI outbound proxy (omit for "", or ""|direct|none to clear)',
  )
  .option(
    "--provider <name>",
    "OAuth provider to use (default: hermes)",
    "hermes",
  )
  .option("--force", "re-download CLIProxyAPI even if already installed")
  .option("--renew", "re-extract from the kept archive and re-run device flow")
  .parse();

const cli: CliArgs = {
  force: false,
  nodeEnv: "development",
  debug: "useclaudeproxy:*",
  dataDir: "data",
  proxy: "",
  renew: false,
  activeProvider: "hermes",
  model: "",
};

const opts = program.opts() as {
  nodeEnv: string;
  debug: string;
  dataDir: string;
  proxy: string;
  force: boolean;
  renew: boolean;
  watch: boolean;
  model: string;
  provider: string;
  activeProvider: string;
};

process.env.DEBUG = opts.debug;
cli.nodeEnv = opts.nodeEnv;
cli.debug = opts.debug;
cli.dataDir = opts.dataDir;
cli.proxy = opts.proxy ?? "";
cli.model = opts.model;
cli.force = opts.force;
cli.renew = opts.renew;
cli.activeProvider = opts.provider;

export const args = cli;
