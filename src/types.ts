export type AccountInfo = Record<string, unknown>;

export class AccessDeniedError extends Error {
  constructor() {
    super("User denied the authorization request");
    this.name = "AccessDeniedError";
  }
}
