export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "MFA_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVITATION_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "SETUP_REQUIRED";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ApplicationError";
  }
}
