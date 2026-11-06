import { z } from "zod";
import { mailboxAuthorizationStatusSchema as gmailStatusSchema } from "./mailbox-authorization";

import { MailboxFailure } from "./mailbox-failure";
export type GmailFailureReason =
  | "revoked"
  | "insufficient"
  | "rate_limited"
  | "not_found"
  | "invalid_page"
  | "unavailable"
  | "invalid_response"
  | "account_mismatch";
export class GmailFailure extends MailboxFailure {
  constructor(readonly reason: GmailFailureReason) {
    super(
      reason === "rate_limited"
        ? "rate_limited"
        : reason === "revoked" || reason === "insufficient"
          ? "permission_required"
          : reason === "invalid_response"
            ? "invalid_provider_response"
            : "provider_unavailable",
    );
  }
}
export const gmailTokenSchema = z.object({
  access_token: z.string().min(1).max(8192),
  refresh_token: z.string().min(1).max(8192).optional(),
  expires_in: z.number().int().positive().max(86400),
  token_type: z.literal("Bearer"),
  scope: z.string().max(10000).optional(),
});
export type GmailToken = z.infer<typeof gmailTokenSchema>;
export type GmailAuthorizationProvider = {
  token(
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<GmailToken>;
  identity(
    accessToken: string,
  ): Promise<{ sub: string; email: string; email_verified: true }>;
  revoke(token: string): Promise<void>;
  api(path: string, accessToken: string, signal: AbortSignal): Promise<unknown>;
};
export const gmailReadScope = "https://www.googleapis.com/auth/gmail.readonly";
export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
export const gmailViewSchema = z.object({
  configured: z.boolean(),
  status: gmailStatusSchema.nullable(),
  reason: z
    .enum([
      "consent_denied",
      "revoked",
      "insufficient",
      "unavailable",
      "rate_limited",
      "invalid_response",
      "account_mismatch",
      "revocation_pending",
    ])
    .nullable(),
  read: z.boolean(),
  send: z.boolean(),
  account: z.email(),
  authorizedAt: z.string().nullable(),
});
export type GmailView = z.infer<typeof gmailViewSchema>;
export {
  mailNativeSchema as gmailNativeSchema,
  mailManualSchema as gmailManualSchema,
  type MailNative as GmailNative,
  type MailManual as GmailManual,
} from "./mail-native";

export {
  mailboxAuthorizationStatusSchema as gmailStatusSchema,
  type MailboxAuthorizationStatus as GmailStatus,
  type MailboxCredentialVault as GmailCredentialVault,
  type MailboxStoredGrant as GmailStoredGrant,
  type MailboxStoredState as GmailStoredState,
  type MailboxAuthorizationPolicy as GmailPolicy,
  type MailboxAuthorizationStore as GmailStore,
  type MailboxAuthorizationRepository as GmailRepository,
} from "./mailbox-authorization";

export { mailboxAuthorizationCallbackSchema as gmailCallbackSchema } from "./mailbox-authorization";
