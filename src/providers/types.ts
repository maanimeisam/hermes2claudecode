import type { TokenResponse } from "../types.ts";

export interface Provider {
  readonly name: string;

  getValidToken(): Promise<TokenResponse>;

  getAccountInfo(accessToken: string): Promise<Record<string, unknown>>;
}
