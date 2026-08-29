import type { BaseProvider } from "./base-provider.ts";
import { hermesProvider } from "./hermes.ts";
import { openCodeProvider } from "./opencode.ts";
import { customProvider } from "./custom.ts";
import { clineProvider } from "./cline.ts";

const registry = new Map<string, BaseProvider>([
  ["hermes", hermesProvider],
  ["opencode", openCodeProvider],
  ["cline", clineProvider],
  ["custom", customProvider],
]);

export function getProvider(name: string): BaseProvider {
  const provider = registry.get(name.toLowerCase());
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Use one of: ${[...registry.keys()].join(", ")}`,
    );
  }
  return provider;
}

export const PROVIDER_NAMES = [...registry.keys()];
