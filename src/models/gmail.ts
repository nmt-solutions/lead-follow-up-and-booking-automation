import { z } from "zod";
import type { WorkIdentity } from "./discovery";
import type { MailboxConfiguration } from "./mailboxes";
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
export type GmailCredentialVault = {
  encrypt(value: string, context: string): string;
  decrypt(value: string, context: string): string;
};

export const gmailReadScope = "https://www.googleapis.com/auth/gmail.readonly";
export const gmailSendScope = "https://www.googleapis.com/auth/gmail.send";
export const gmailStatusSchema = z.enum([
  "connecting",
  "connected",
  "reconnect_required",
  "insufficient",
  "revocation_pending",
  "disconnected",
]);
export type GmailStatus = z.infer<typeof gmailStatusSchema>;
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
export const gmailCallbackSchema = z
  .strictObject({
    state: z.string().regex(/^[a-f0-9]{64}$/),
    code: z.string().min(1).max(4096).optional(),
    error: z.string().min(1).max(256).optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.error));
export type GmailStoredGrant = {
  id: string;
  businessId: string;
  generation: number;
  status: GmailStatus;
  reason: string | null;
  accountSubject: string | null;
  credentials: string | null;
  rejectedCredentials: string | null;
  scopes: string[];
  authorizedAt: Date | null;
  actorId: string;
};
export type GmailStoredState = {
  id: string;
  businessId: string;
  mailboxId: string;
  generation: number;
  policyVersion: number;
  stateHash: string;
  verifier: string;
  actorId: string;
  sessionId: string;
  expiresAt: Date;
  consumed: boolean;
};
export type GmailPolicy = {
  id: string;
  businessId: string;
  version: number;
  account: string;
  configuration: MailboxConfiguration;
};
export type GmailStore = {
  policy: GmailPolicy;
  grant: GmailStoredGrant | undefined;
  processingEnabled: boolean;
  createGrant(): Promise<GmailStoredGrant>;
  updateGrant(
    change: Partial<Omit<GmailStoredGrant, "id" | "businessId" | "actorId">>,
  ): Promise<void>;
  state(hash: string): Promise<GmailStoredState | undefined>;
  createState(state: Omit<GmailStoredState, "consumed">): Promise<void>;
  consumeState(id: string): Promise<void>;
  invalidate(): Promise<void>;
};
export type GmailRepository = {
  withMailbox<T>(
    identity: WorkIdentity,
    businessId: string,
    mailboxId: string,
    operation: (store: GmailStore) => Promise<T>,
  ): Promise<T>;
};

const headerRef = z
  .string()
  .min(3)
  .max(998)
  .regex(/^<[^<>\s\u0000-\u001f\u007f]+>$/);
export const gmailNativeSchema = z.strictObject({
  direction: z.enum(["incoming", "manual_reply"]),
  internetMessageId: headerRef,
  inReplyTo: headerRef.nullable(),
  from: z.email().max(254),
  to: z.array(z.email().max(254)).min(1).max(50),
});
export type GmailNative = z.infer<typeof gmailNativeSchema>;
export const gmailManualSchema = z.strictObject({
  kind: z.literal("manual_reply"),
  eventId: z.string().min(1).max(256),
  messageRef: z.string().min(1).max(256),
  conversationRef: z.string().min(1).max(256),
  subject: z.string().min(1).max(500),
  text: z
    .string()
    .min(1)
    .max(20000)
    .refine((v) => !v.includes("\0")),
  occurredAt: z.iso.datetime({ offset: true }),
  native: gmailNativeSchema,
});
export type GmailManual = z.infer<typeof gmailManualSchema>;
