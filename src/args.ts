import { Command } from "commander";

export const PROVIDERS = ["claude", "gemini", "codex"];

interface CliArgs {
  force: boolean;
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
  .option("--data-dir <dir>", "token storage directory", "data")
  .option("--model <model>", "model name to expose in openai-compatibility")
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

if (
  !program.opts<{ renew: boolean; model?: string }>().renew &&
  !program.opts().model
) {
  program.error("required option '--model <model>' not specified");
}

program.addHelpText(
  "after",
  `
Environment variables:
  NODE_ENV   development | production
             Example: export NODE_ENV=production

  DEBUG      debug namespaces, e.g. "useclaudeproxy:*"
             Example: export DEBUG="useclaudeproxy:*"
`,
);

const cli: CliArgs = {
  force: false,
  dataDir: "data",
  proxy: "",
  renew: false,
  activeProvider: "hermes",
  model: "",
};

const opts = program.opts() as {
  dataDir: string;
  proxy: string;
  force: boolean;
  renew: boolean;
  watch: boolean;
  model: string;
  provider: string;
  activeProvider: string;
};

process.env.DEBUG ??= "useclaudeproxy:*";
cli.dataDir = opts.dataDir;
cli.proxy = opts.proxy ?? "";
cli.model = opts.model;
cli.force = opts.force;
cli.renew = opts.renew;
cli.activeProvider = opts.provider;

export const args = cli;
