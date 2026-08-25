import { ensureCliProxy } from "./install-cli-proxy.ts";

// Web-panel install entry point. Reuses the existing, tested download/extract
// logic in install-cli-proxy.ts so the panel's "Update binary" action has a
// backend without duplicating it. `--force` (read by args.ts) re-downloads.
ensureCliProxy()
  .then(() => {
    console.log("OK: CLIProxyAPI ready");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Install failed:", err);
    process.exit(1);
  });
