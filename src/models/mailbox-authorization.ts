import { z } from "zod";
import type { WorkIdentity } from "./discovery";
import type { MailboxConfiguration } from "./mailboxes";
export const mailboxAuthorizationCallbackSchema = z
  .strictObject({
    state: z.string().regex(/^[a-f0-9]{64}$/),
    code: z.string().min(1).max(4096).optional(),
    error: z.string().min(1).max(256).optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.error));
export type MailboxCredentialVault = {
  encrypt(value: string, context: string): string;
  decrypt(value: string, context: string): string;
};

export const mailboxAuthorizationStatusSchema = z.enum([
  "connecting",
  "connected",
  "reconnect_required",
  "insufficient",
  "revocation_pending",
  "disconnected",
]);
export type MailboxAuthorizationStatus = z.infer<
  typeof mailboxAuthorizationStatusSchema
>;
export type MailboxStoredGrant = {
  id: string;
  businessId: string;
  generation: number;
  status: MailboxAuthorizationStatus;
  reason: string | null;
  accountSubject: string | null;
  credentials: string | null;
  rejectedCredentials: string | null;
  scopes: string[];
  authorizedAt: Date | null;
  actorId: string;
};
export type MailboxStoredState = {
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
export type MailboxAuthorizationPolicy = {
  id: string;
  businessId: string;
  version: number;
  account: string;
  configuration: MailboxConfiguration;
};
export type MailboxAuthorizationStore = {
  policy: MailboxAuthorizationPolicy;
  grant: MailboxStoredGrant | undefined;
  processingEnabled: boolean;
  createGrant(): Promise<MailboxStoredGrant>;
  updateGrant(
    change: Partial<Omit<MailboxStoredGrant, "id" | "businessId" | "actorId">>,
  ): Promise<void>;
  state(hash: string): Promise<MailboxStoredState | undefined>;
  createState(state: Omit<MailboxStoredState, "consumed">): Promise<void>;
  consumeState(id: string): Promise<void>;
  bindPendingAccount(account: string): Promise<void>;
  invalidate(): Promise<void>;
  googlePrimaryRevocable(): Promise<boolean>;
};
export type MailboxAuthorizationRepository = {
  withMailbox<T>(
    identity: WorkIdentity,
    businessId: string,
    mailboxId: string,
    operation: (store: MailboxAuthorizationStore) => Promise<T>,
  ): Promise<T>;
};
