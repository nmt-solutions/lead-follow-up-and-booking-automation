import { z } from "zod";
import { MailboxFailure } from "./mailbox-failure";

import {
  mailboxAuthorizationStatusSchema,
  mailboxAuthorizationCallbackSchema,
  type MailboxAuthorizationRepository,
  type MailboxStoredGrant,
} from "./mailbox-authorization";
export const microsoftMailReadScope = "Mail.Read";
export const microsoftMailSendScope = "Mail.Send";
export const microsoftMailScopes = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  microsoftMailReadScope,
  "MailboxSettings.Read",
];
export const microsoftMailReasonSchema = z.enum([
  "consent_denied",
  "revoked",
  "insufficient",
  "unavailable",
  "rate_limited",
  "invalid_response",
  "account_mismatch",
  "unsupported_account",
  "license_required",
  "approval_required",
  "provider_consent_retained",
]);
export type MicrosoftMailReason = z.infer<typeof microsoftMailReasonSchema>;
export class MicrosoftMailFailure extends MailboxFailure {
  constructor(
    readonly reason: MicrosoftMailReason | "not_found" | "delta_expired",
    retryAfterSeconds = 60,
  ) {
    super(
      reason === "rate_limited"
        ? "rate_limited"
        : [
              "revoked",
              "insufficient",
              "unsupported_account",
              "license_required",
              "approval_required",
              "account_mismatch",
            ].includes(reason)
          ? "permission_required"
          : reason === "invalid_response"
            ? "invalid_provider_response"
            : "provider_unavailable",
      retryAfterSeconds,
    );
  }
}
export const microsoftMailViewSchema = z.object({
  configured: z.boolean(),
  status: mailboxAuthorizationStatusSchema.nullable(),
  reason: microsoftMailReasonSchema.nullable(),
  account: z.email(),
  accountKind: z.enum(["microsoft_work", "microsoft_personal"]).nullable(),
  read: z.boolean(),
  send: z.boolean(),
  authorizedAt: z.string().nullable(),
  folders: z.array(
    z.object({ id: z.string().min(1).max(256), label: z.string().max(200) }),
  ),
});
export type MicrosoftMailView = z.infer<typeof microsoftMailViewSchema>;
export const microsoftMailCallbackSchema = mailboxAuthorizationCallbackSchema;
export type MicrosoftMailRepository = MailboxAuthorizationRepository;
export type MicrosoftMailStoredGrant = MailboxStoredGrant;
