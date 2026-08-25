import { Command } from "commander";

export const PROVIDERS = ["claude", "gemini", "codex"];

interface CliArgs {
  command: "set-token" | "set-proxy" | undefined;
  force: boolean;
  nodeEnv: string;
  debug: string;
  dataDir: string;
  proxy: string;
  renew: boolean;
  provider?: string;
  token?: string;
  proxyUrl?: string;
  passthrough: string[];
}

// Globals are declared on `program` (not on subcommands) and commander is left
// in its default mode, so each flag is recognized in ANY position — before or
// after the subcommand (e.g. `temps --data-dir x run` or `temps run --data-dir x`).
// Defaults live here, satisfying config.ts's expectations.
const program = new Command();

program
  .name("temps")
  .description("Hermes OAuth Device Flow")
  .option("--node-env <env>", "development | production", "development")
  .option("--debug <ns>", 'debug namespaces, e.g. "app:*"', "app:*")
  .option("--data-dir <dir>", "token storage directory", "data")
  .option(
    "--proxy <url>",
    'CLIProxyAPI outbound proxy (omit for "", or ""|direct|none to clear)',
  )
  .option("--force", "re-download CLIProxyAPI even if already installed")
  .option("--renew", "re-extract from the kept archive and re-run device flow")
  .addHelpText(
    "after",
    `
Global options (any position, before or after the subcommand):
  --node-env <env>     development | production (default: development)
  --debug <ns>         debug namespaces, e.g. "app:*" (default: app:*)
  --data-dir <dir>     token storage directory (default: data)
  --proxy <url>        CLIProxyAPI outbound proxy (omit for "", or ""|direct|none to clear)
  --force              re-download CLIProxyAPI even if already installed
  --renew              re-extract from the kept archive and re-run device flow
Pass-through args for "run" go after "--": temps run -- --tui`,
  );

const cli: CliArgs = {
  command: undefined,
  force: false,
  nodeEnv: "development",
  debug: "app:*",
  dataDir: "data",
  proxy: "",
  renew: false,
  passthrough: [],
};

// Options-only invocation (no command) → default OAuth device-flow path.
// Without this, commander shows help and exits instead of running app().
program.action(() => {
  cli.command = undefined;
});

program
  .command("set-token")
  .description("Set the access token (api-key) for a provider")
  .argument("<provider>", `provider (${PROVIDERS.join(" | ")})`)
  .argument("<token>", "access token")
  .action((provider: string, token: string) => {
    cli.command = "set-token";
    cli.provider = provider;
    cli.token = token;
  });

program
  .command("set-proxy")
  .description(
    'Set the global outbound proxy ("", "direct", or "none" to clear)',
  )
  .argument("<url>", "proxy url")
  .action((url: string) => {
    cli.command = "set-proxy";
    cli.proxyUrl = url;
  });

program.parse();

const opts = program.opts() as {
  nodeEnv: string;
  debug: string;
  dataDir: string;
  proxy: string;
  force: boolean;
  renew: boolean;
  watch: boolean;
};

// --debug feeds the `debug` library's namespace filter via process.env, which
// must be set before any Debug() logger is created (module load time).
process.env.DEBUG = opts.debug;
cli.nodeEnv = opts.nodeEnv;
cli.debug = opts.debug;
cli.dataDir = opts.dataDir;
cli.proxy = opts.proxy ?? "";
cli.force = opts.force;
cli.renew = opts.renew;

export const args = cli;
