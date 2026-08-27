export interface Provider {
  readonly name: string;
  readonly tokenPath: string;
  getValidToken(): Promise<unknown>;
  startTokenWatcher(signal?: AbortSignal): Promise<void>;
  clearStoredToken(): void;
}
