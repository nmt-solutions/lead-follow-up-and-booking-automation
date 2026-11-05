export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVITATION_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "SETUP_REQUIRED"
  | "CHANNEL_SETUP_REQUIRED"
  | "COMMERCIAL_SETUP_REQUIRED"
  | "FILE_SETUP_REQUIRED"
  | "FILE_DISALLOWED"
  | "FILE_UNAVAILABLE"
  | "DISCOVERY_SETUP_REQUIRED"
  | "DISCOVERY_SCOPE_INVALID"
  | "DISCOVERY_INTERRUPTED"
  | "AI_SETUP_REQUIRED"
  | "AI_VALIDATION_REQUIRED"
  | "AI_ALLOWANCE_EXHAUSTED";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ApplicationError";
  }
}
