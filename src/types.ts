export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
};

export type TokenErrorResponse = {
  error:
    | "authorization_pending"
    | "slow_down"
    | "expired_token"
    | "access_denied"
    | string;
  error_description?: string;
};

export type AccountInfo = Record<string, unknown>;

export class OAuthHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "OAuthHttpError";
  }
}

export class DeviceCodeExpiredError extends Error {
  constructor() {
    super("Device code expired before authorization completed");
    this.name = "DeviceCodeExpiredError";
  }
}

export class AccessDeniedError extends Error {
  constructor() {
    super("User denied the authorization request");
    this.name = "AccessDeniedError";
  }
}
