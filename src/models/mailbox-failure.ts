export class MailboxFailure extends Error {
  constructor(
    readonly condition:
      | "rate_limited"
      | "permission_required"
      | "invalid_provider_response"
      | "provider_unavailable",
    readonly retryAfterSeconds?: number,
  ) {
    super(condition);
  }
}
