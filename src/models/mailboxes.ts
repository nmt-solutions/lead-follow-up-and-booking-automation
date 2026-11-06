import { z } from "zod";
import type { WorkIdentity } from "./discovery";
import type { IncomingInquiry } from "./inbox";
import { mailNativeSchema, type MailManual } from "./mail-native";

export { MailboxFailure } from "./mailbox-failure";

const ref = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const refs = z
  .array(ref)
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length);
export const mailboxScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("mailbox") }),
  z.strictObject({ kind: z.literal("folders"), refs }),
  z.strictObject({ kind: z.literal("threads"), refs }),
]);
export const mailboxHistorySchema = z
  .strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    maxMessages: z.number().int().min(1).max(10000),
  })
  .refine((v) => new Date(v.from) < new Date(v.to));
export const mailboxConfigurationSchema = z.strictObject({
  connectionId: z.uuid(),
  requestedRead: z.boolean(),
  requestedSend: z.boolean(),
  enabled: z.boolean(),
  scope: mailboxScopeSchema,
  history: mailboxHistorySchema.nullable().default(null),
  salesSubjectTerms: z
    .array(
      z
        .string()
        .trim()
        .min(3)
        .max(80)
        .regex(/^[^\u0000-\u001f\u007f]+$/),
    )
    .max(20)
    .optional(),
});
export const saveMailboxSchema = z
  .strictObject({
    id: z.uuid().nullable(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    configuration: mailboxConfigurationSchema,
  })
  .refine((v) => v.id !== null || v.expectedVersion === 0);
export const queueMailboxSchema = z.strictObject({
  mode: z.enum(["incremental", "history"]),
});
export const mailboxWorkSchema = z.strictObject({
  businessId: z.uuid(),
  mailboxId: z.uuid(),
  jobId: z.uuid(),
  policyVersion: z.number().int().positive(),
  identity: z.strictObject({
    userId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
  }),
});
export const mailboxGrantSchema = z.strictObject({
  provider: z.enum(["gmail", "microsoft"]),
  account: z.email(),
  revision: ref,
  read: z.enum(["granted", "missing", "revoked", "insufficient"]),
  send: z.enum(["granted", "missing", "revoked", "insufficient"]),
  // null denotes provider-wide access, never application processing consent.
  folders: z.array(ref).max(1000).nullable(),
  threads: z.array(ref).max(1000).nullable(),
  // Existence in this exact mailbox is independent of OAuth's breadth.
  availableFolders: z.array(ref).max(1000),
  availableThreads: z.array(ref).max(1000),
  observedAt: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }),
  microsoft: z
    .strictObject({
      sentFolderRef: ref,
      excludedFolderRefs: z.array(ref).max(10),
    })
    .optional(),
});
export const mailboxMetadataSchema = z.strictObject({
  messageRef: ref,
  conversationRef: ref,
  folderRefs: z.array(ref).max(100),
  occurredAt: z.iso.datetime({ offset: true }),
  relevance: z.enum(["sales", "unrelated", "unknown"]),
  native: mailNativeSchema.optional(),
});
const cursor = z
  .string()
  .min(1)
  .max(524288)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const mailboxPageSchema = z.strictObject({
  provider: z.enum(["gmail", "microsoft"]),
  account: z.email(),
  grantRevision: ref,
  cursor: cursor.nullable(),
  nextCursor: cursor,
  hasMore: z.boolean(),
  messages: z.array(mailboxMetadataSchema).max(100),
  visibility: z.enum(["current", "recovering", "limited"]).optional(),
  completeReplyCapture: z.boolean().optional(),
});
export type MailboxConfiguration = z.infer<typeof mailboxConfigurationSchema>;
export type MailboxGrant = z.infer<typeof mailboxGrantSchema>;
export type MailboxMetadata = z.infer<typeof mailboxMetadataSchema>;
export type MailboxPage = z.infer<typeof mailboxPageSchema>;
export type MailboxWork = z.infer<typeof mailboxWorkSchema>;
export type MailboxJobState = z.infer<typeof jobStateSchema>;
export type MailboxView = {
  id: string;
  inboxConnectionId: string;
  version: number;
  account: string;
  provider: "gmail" | "microsoft";
  configuration: MailboxConfiguration;
  incrementalSince: string;
  visibility: "unsafe" | "current" | "recovering" | "limited";
  lastSyncedAt: string | null;
  pendingManualReplies: number;
  pendingIncomingReplies: number;
  incomingReplyReview: {
    id: string;
    subject: string;
    text: string;
    occurredAt: string;
    inReplyTo: string | null;
  }[];
  manualReplyReview: {
    id: string;
    subject: string;
    text: string;
    occurredAt: string;
    inReplyTo: string | null;
  }[];
  grant: Pick<
    MailboxGrant,
    "read" | "send" | "observedAt" | "validUntil" | "folders" | "threads"
  > | null;
  jobs: MailboxJobState[];
};
export type MailboxWorkspace = {
  canManage: boolean;
  providerMode: MailboxProvider["mode"];
  connections: {
    id: string;
    label: string;
    provider: "gmail" | "microsoft";
    account: string;
  }[];
  mailboxes: MailboxView[];
};
export type MailboxSnapshot = {
  work: MailboxWork;
  configuration: MailboxConfiguration;
  inboxConnectionId: string;
  provider: "gmail" | "microsoft";
  account: string;
  connectionVersion: number;
  incrementalSince: string;
  cursor: string | null;
  checkpoint: number;
  permissionObservation: MailboxGrant | null;
  mode: "incremental" | "history";
  limit: number;
  considered: number;
  seen: string[];
  knownThreads?: string[];
  oauthGeneration?: number | null;
  appMessages?: { messageRef: string; internetMessageId: string }[];
  sequenceMessages?: {
    internetMessageId: string;
    recipient: string;
    fromAddress: string;
    replyTo: string;
  }[];
  retryAt?: string | null;
  visibility?: MailboxView["visibility"];
};
export type MailboxProvider = {
  key: string;
  mode: "unconfigured" | "fixture" | "live";
  inspect(context: MailboxSnapshot, signal: AbortSignal): Promise<unknown>;
  list(
    context: MailboxSnapshot,
    grant: MailboxGrant,
    signal: AbortSignal,
  ): Promise<unknown>;
  read(
    context: MailboxSnapshot,
    metadata: MailboxMetadata,
    signal: AbortSignal,
  ): Promise<unknown>;
};
export type MailboxBatch = {
  snapshot: MailboxSnapshot;
  grant: MailboxGrant;
  page: MailboxPage;
  selected: {
    metadata: MailboxMetadata;
    event: IncomingInquiry | MailManual;
  }[];
  seen: string[];
  excluded: number;
};
export type MailboxRepository = {
  workspace(
    identity: WorkIdentity,
    businessId: string,
  ): Promise<Omit<MailboxWorkspace, "providerMode">>;
  save(
    identity: WorkIdentity,
    businessId: string,
    input: z.infer<typeof saveMailboxSchema>,
  ): Promise<MailboxView>;
  queue(
    identity: WorkIdentity,
    businessId: string,
    mailboxId: string,
    mode: "incremental" | "history",
  ): Promise<MailboxWork>;
  prepare(work: MailboxWork): Promise<MailboxSnapshot | null>;
  repeat(work: MailboxWork): Promise<MailboxWork | null>;
  commit(batch: MailboxBatch): Promise<MailboxJobState>;
  stop(
    snapshot: MailboxSnapshot,
    reason: "authorization_required" | "scope_changed",
  ): Promise<void>;
  fail(
    snapshot: MailboxSnapshot,
    reason: NonNullable<MailboxJobState["reason"]>,
    grant?: MailboxGrant,
    retryAfterSeconds?: number,
  ): Promise<MailboxJobState>;
};

export function selectedMetadata(
  config: MailboxConfiguration,
  metadata: MailboxMetadata,
  since: string,
  mode: "incremental" | "history",
) {
  const time = new Date(metadata.occurredAt).getTime();
  const history = config.history;
  if (
    mode === "history" &&
    (!history ||
      time < new Date(history.from).getTime() ||
      time >= new Date(history.to).getTime())
  )
    return false;
  if (mode === "incremental" && time < new Date(since).getTime()) return false;
  if (metadata.relevance !== "sales") return false;
  const scope = config.scope;
  return (
    scope.kind === "mailbox" ||
    (scope.kind === "threads"
      ? scope.refs.includes(metadata.conversationRef)
      : scope.refs.some((ref) => metadata.folderRefs.includes(ref)))
  );
}
export function permissionAllows(
  config: MailboxConfiguration,
  grant: MailboxGrant,
  at: Date,
) {
  if (
    !config.enabled ||
    !config.requestedRead ||
    grant.read !== "granted" ||
    new Date(grant.observedAt) > at ||
    new Date(grant.validUntil) <= at
  )
    return false;
  const scope = config.scope;
  if (scope.kind === "mailbox")
    return grant.folders === null && grant.threads === null;
  const allowed = scope.kind === "folders" ? grant.folders : grant.threads;
  const other = scope.kind === "folders" ? grant.threads : grant.folders;
  const available =
    scope.kind === "folders" ? grant.availableFolders : grant.availableThreads;
  return (
    scope.refs.every((ref) => available.includes(ref)) &&
    other === null &&
    (allowed === null || scope.refs.every((ref) => allowed.includes(ref)))
  );
}

const jobStateSchema = z.object({
  retryAt: z.iso.datetime({ offset: true }).nullable().optional(),
  id: z.uuid(),
  mode: z.enum(["incremental", "history"]),
  policyVersion: z.number().int(),
  status: z.enum(["queued", "running", "partial", "completed", "blocked"]),
  reason: z
    .enum([
      "setup_required",
      "worker_required",
      "permission_required",
      "scope_changed",
      "provider_unavailable",
      "invalid_provider_response",
      "limit_reached",
      "interrupted",
      "authorization_required",
      "rate_limited",
      "cursor_recovery",
      "history_gap",
      "manual_reply_review",
      "reply_association_review",
    ])
    .nullable(),
  checkpoint: z.number().int(),
  considered: z.number().int(),
  captured: z.number().int(),
  duplicates: z.number().int(),
  excluded: z.number().int(),
});
export const mailboxWorkspaceSchema = z.object({
  canManage: z.boolean(),
  providerMode: z.enum(["unconfigured", "fixture", "live"]),
  connections: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      provider: z.enum(["gmail", "microsoft"]),
      account: z.email(),
    }),
  ),
  mailboxes: z.array(
    z.object({
      id: z.uuid(),
      inboxConnectionId: z.uuid(),
      version: z.number().int(),
      account: z.email(),
      provider: z.enum(["gmail", "microsoft"]),
      configuration: mailboxConfigurationSchema,
      incrementalSince: z.iso.datetime({ offset: true }),
      visibility: z.enum(["unsafe", "current", "recovering", "limited"]),
      lastSyncedAt: z.string().nullable(),
      pendingManualReplies: z.number().int().nonnegative(),
      pendingIncomingReplies: z.number().int().nonnegative(),
      incomingReplyReview: z.array(
        z.object({
          id: z.uuid(),
          subject: z.string(),
          text: z.string(),
          occurredAt: z.string(),
          inReplyTo: z.string().nullable(),
        }),
      ),
      manualReplyReview: z.array(
        z.object({
          id: z.uuid(),
          subject: z.string(),
          text: z.string(),
          occurredAt: z.string(),
          inReplyTo: z.string().nullable(),
        }),
      ),
      grant: mailboxGrantSchema
        .pick({
          read: true,
          send: true,
          observedAt: true,
          validUntil: true,
          folders: true,
          threads: true,
        })
        .nullable(),
      jobs: z.array(jobStateSchema),
    }),
  ),
});
