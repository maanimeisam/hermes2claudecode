import { hermesProvider } from "./hermes.ts";
import type { Provider } from "./types.ts";

const registry = new Map<string, Provider>([["hermes", hermesProvider]]);

export function getProvider(name: string): Provider {
  const provider = registry.get(name.toLowerCase());
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Use one of: ${[...registry.keys()].join(", ")}`,
    );
  }
  return provider;
}

export const PROVIDER_NAMES = [...registry.keys()];

export type { Provider };
