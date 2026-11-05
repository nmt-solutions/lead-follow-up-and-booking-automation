export type ApplicationErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
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
