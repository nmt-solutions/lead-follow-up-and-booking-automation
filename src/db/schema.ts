import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BusinessRole, Invitation } from "../models/team";
import type { SavedConfiguration } from "../models/configuration";
import type { FileState } from "../models/files";
import type { KnowledgeConfiguration } from "../models/knowledge";
import type { CommercialPolicy } from "../models/commercial-authority";
import type {
  DiscoveryPolicy,
  DiscoveryBrief,
  RunStatus,
  StopReason,
  DiscoveryProspect,
  ObservationOutcome,
  DiscoveryCommand,
  SearchResult,
} from "../models/discovery";

import type {
  Dispatch,
  SaveSchedule,
  ScheduleFailure,
} from "../models/discovery-schedules";

export const appRuntime = pgRole("app_runtime").existing();

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    mfaFactorId: text("mfa_factor_id"),
    mfaFactorVersion: text("mfa_factor_version"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failed_verification_count")
    .notNull()
    .default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("account_user_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const business = pgTable(
  "business",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    offering: text("offering").notNull(),
    homeMarket: text("home_market").notNull(),
    website: text("website").notNull(),
    configuration: jsonb("configuration").$type<SavedConfiguration>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "business_name_length",
      sql`char_length(btrim(${table.name})) between 1 and 120`,
    ),
    check(
      "business_offering_length",
      sql`char_length(btrim(${table.offering})) between 1 and 4000`,
    ),
    pgPolicy("business_access", {
      for: "all",
      to: appRuntime,
      using: sql`${table.id} = nullif(current_setting('app.business_id', true), '')::uuid
        and public.current_business_role() is not null`,
      withCheck: sql`${table.id} = nullif(current_setting('app.business_id', true), '')::uuid
        and public.current_business_role() in ('owner', 'admin')`,
    }),
  ],
).enableRLS();

export const membership = pgTable(
  "membership",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role").$type<BusinessRole>().notNull().default("owner"),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.userId] }),
    uniqueIndex("one_owner_per_business")
      .on(table.businessId)
      .where(sql`${table.role} = 'owner'`),
    index("membership_user_idx").on(table.userId),
    check(
      "membership_role",
      sql`${table.role} in ('owner', 'admin', 'salesperson')`,
    ),
    pgPolicy("membership_read", {
      for: "select",
      to: appRuntime,
      using: sql`${table.userId} = nullif(current_setting('app.actor_id', true), '')
        or (${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
          and public.current_business_role() in ('owner', 'admin'))`,
    }),
    // Only the table owner can use this policy. Definer helpers filter their
    // reads themselves; the non-owner runtime cannot use it or assume that role.
    pgPolicy("membership_owner_read", {
      for: "select",
      to: "public",
      using: sql`current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.membership'::regclass)`,
    }),
    pgPolicy("membership_create", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`${table.userId} = nullif(current_setting('app.actor_id', true), '')
        and ${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
        and (${table.role} = 'owner' or exists (
          select 1 from public.invitation i where i.business_id = ${table.businessId}
          and i.token_hash = current_setting('app.invitation_hash', true)
          and i.status = 'pending' and i.role = ${table.role}
          and i.expires_at > nullif(current_setting('app.at', true), '')::timestamptz
          and public.inviter_authorized(i.created_by, i.role)
        ))`,
    }),
    pgPolicy("membership_change", {
      for: "update",
      to: appRuntime,
      using: sql`${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
        and ${table.role} <> 'owner' and (public.current_business_role() = 'owner'
          or (public.current_business_role() = 'admin' and ${table.role} = 'salesperson'))`,
      withCheck: sql`${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
        and ${table.role} <> 'owner' and (public.current_business_role() = 'owner'
          or (public.current_business_role() = 'admin' and ${table.role} = 'salesperson'))`,
    }),
    pgPolicy("membership_remove", {
      for: "delete",
      to: appRuntime,
      using: sql`${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
        and ${table.role} <> 'owner' and (public.current_business_role() = 'owner'
          or (public.current_business_role() = 'admin' and ${table.role} = 'salesperson'))`,
    }),
  ],
).enableRLS();

const managerScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid
  and public.current_business_role() in ('owner', 'admin')`;
export const commercialAuthorityRevision = pgTable(
  "commercial_authority_revision",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    version: integer("version").notNull(),
    policy: jsonb("policy").$type<CommercialPolicy>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("commercial_authority_business_version").on(
      table.businessId,
      table.version,
    ),
    check("commercial_authority_version_positive", sql`${table.version} > 0`),
    pgPolicy("commercial_authority_read", {
      for: "select",
      to: appRuntime,
      using: sql`${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null`,
    }),
    pgPolicy("commercial_authority_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope}) and ${table.actorId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();
export const knowledgeRevision = pgTable(
  "knowledge_revision",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    version: integer("version").notNull(),
    action: text("action").$type<"draft" | "approved" | "retired">().notNull(),
    configuration: jsonb("configuration")
      .$type<KnowledgeConfiguration>()
      .notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("knowledge_business_version").on(
      table.businessId,
      table.version,
    ),
    check("knowledge_version_positive", sql`${table.version} > 0`),
    check(
      "knowledge_action",
      sql`${table.action} in ('draft', 'approved', 'retired')`,
    ),
    pgPolicy("knowledge_read", {
      for: "select",
      to: appRuntime,
      using: sql`${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null`,
    }),
    pgPolicy("knowledge_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope}) and ${table.actorId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();
const recipientScope = sql`token_hash = current_setting('app.invitation_hash', true)
  and email = (select lower(u.email) from public."user" u
    where u.id = current_setting('app.actor_id', true) and u.email_verified)`;

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    email: text("email").notNull(),
    businessName: text("business_name").notNull(),
    role: text("role").$type<Invitation["role"]>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status")
      .$type<Invitation["status"]>()
      .notNull()
      .default("pending"),
    delivery: text("delivery")
      .$type<Invitation["delivery"]>()
      .notNull()
      .default("pending"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedBy: text("accepted_by").references(() => user.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    deliveryStartedAt: timestamp("delivery_started_at", { withTimezone: true }),
  },
  (table) => [
    index("invitation_business_idx").on(table.businessId),
    uniqueIndex("one_pending_invitation")
      .on(table.businessId, table.email)
      .where(sql`${table.status} = 'pending'`),
    check("invitation_role", sql`${table.role} in ('admin', 'salesperson')`),
    check(
      "invitation_status",
      sql`${table.status} in ('pending', 'accepted', 'revoked', 'expired')`,
    ),
    check(
      "invitation_delivery",
      sql`${table.delivery} in ('pending', 'sending', 'sent', 'unconfirmed')`,
    ),
    pgPolicy("invitation_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${managerScope}) or (${recipientScope})`,
    }),
    pgPolicy("invitation_create", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope})
    and ${table.createdBy} = current_setting('app.actor_id', true)
    and (public.current_business_role() = 'owner' or ${table.role} = 'salesperson')`,
    }),
    pgPolicy("invitation_change", {
      for: "update",
      to: appRuntime,
      using: sql`((${managerScope}) and (public.current_business_role() = 'owner' or ${table.role} = 'salesperson')) or (${recipientScope})`,
      withCheck: sql`((${managerScope}) and (public.current_business_role() = 'owner' or ${table.role} = 'salesperson')) or (${recipientScope})`,
    }),
    // Expiration grants no access. Admins may persist it for every invitation
    // without gaining authority to grant or revoke an unexpired Admin invitation.
    pgPolicy("invitation_expire", {
      for: "update",
      to: appRuntime,
      using: sql`(${managerScope}) and ${table.status} = 'pending'
        and ${table.expiresAt} <= nullif(current_setting('app.at', true), '')::timestamptz`,
      withCheck: sql`(${managerScope}) and ${table.status} = 'expired'
        and ${table.expiresAt} <= nullif(current_setting('app.at', true), '')::timestamptz`,
    }),
  ],
).enableRLS();

export const teamAudit = pgTable(
  "team_audit",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    action: text("action").notNull(),
    subjectId: text("subject_id").notNull(),
    detail: text("detail").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("team_audit_business_idx").on(table.businessId, table.at),
    pgPolicy("team_audit_read", {
      for: "select",
      to: appRuntime,
      using: managerScope,
    }),
    pgPolicy("team_audit_create", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
      and ${table.actorId} = current_setting('app.actor_id', true) and public.current_business_role() is not null`,
    }),
  ],
).enableRLS();

// Provisioned by a trusted operator with the schema-owner connection; Business admins cannot grant this.
export const platformOperator = pgTable(
  "platform_operator",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id),
    tax: boolean("tax").notNull().default(false),
    reconciliation: boolean("reconciliation").notNull().default(false),
  },
  (table) => [
    pgPolicy("operator_read", {
      for: "select",
      to: appRuntime,
      using: sql`${table.userId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

const fileBusinessScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null`;
const fileOwnerScope = sql`current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.business_file'::regclass)`;
export const businessFile = pgTable(
  "business_file",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    accountScope: text("account_scope").notNull(),
    state: text("state").$type<FileState>().notNull(),
    uploadHash: text("upload_hash").notNull(),
    uploadExpiresAt: timestamp("upload_expires_at", {
      withTimezone: true,
    }).notNull(),
    retentionUntil: timestamp("retention_until", {
      withTimezone: true,
    }).notNull(),
    recordRetentionSeconds: integer("record_retention_seconds").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    cleanupAfter: timestamp("cleanup_after", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    operationId: uuid("operation_id"),
    sha256: text("sha256"),
    failure: text("failure"),
  },
  (table) => [
    index("business_file_scope_idx").on(table.businessId, table.createdAt),
    index("business_file_cleanup_idx").on(
      table.accountScope,
      table.cleanupAfter,
    ),
    check("business_file_size", sql`${table.size} > 0`),
    check(
      "business_file_state",
      sql`${table.state} in ('pending','uploading','ready','failed','deleting','deleted')`,
    ),
    pgPolicy("file_read", {
      for: "select",
      to: appRuntime,
      using: fileBusinessScope,
    }),
    pgPolicy("file_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope}) and ${table.ownerId} = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("file_update", {
      for: "update",
      to: appRuntime,
      using: managerScope,
      withCheck: managerScope,
    }),
    // Narrow definer cleanup functions can operate after a member leaves; the runtime cannot assume the table owner.
    pgPolicy("file_system", {
      for: "all",
      to: "public",
      using: fileOwnerScope,
      withCheck: fileOwnerScope,
    }),
  ],
).enableRLS();
export const fileAccess = pgTable(
  "file_access",
  {
    tokenHash: text("token_hash").primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => businessFile.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("file_access_expiry_idx").on(table.expiresAt),
    pgPolicy("file_access_scope", {
      for: "all",
      to: appRuntime,
      using: sql`(${fileBusinessScope}) and ${table.actorId} = current_setting('app.actor_id', true)`,
      withCheck: sql`(${fileBusinessScope}) and ${table.actorId} = current_setting('app.actor_id', true) and exists (select 1 from public.business_file f where f.id = ${table.fileId} and f.business_id = ${table.businessId})`,
    }),
    pgPolicy("file_access_system", {
      for: "all",
      to: "public",
      using: fileOwnerScope,
      withCheck: fileOwnerScope,
    }),
  ],
).enableRLS();
export const fileUsage = pgTable(
  "file_usage",
  {
    id: uuid("id").primaryKey(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => businessFile.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    accountScope: text("account_scope").notNull(),
    action: text("action").$type<"put" | "get" | "delete">().notNull(),
    outcome: text("outcome").$type<"uncertain" | "succeeded">().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("file_usage_business_idx").on(table.businessId, table.at),
    pgPolicy("file_usage_scope", {
      for: "all",
      to: appRuntime,
      using: fileBusinessScope,
      withCheck: sql`(${fileBusinessScope}) and exists (select 1 from public.business_file f where f.id = ${table.fileId} and f.business_id = ${table.businessId} and f.account_scope = ${table.accountScope})`,
    }),
    pgPolicy("file_usage_system", {
      for: "all",
      to: "public",
      using: fileOwnerScope,
      withCheck: fileOwnerScope,
    }),
  ],
).enableRLS();

const discoveryScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null`;
const discoveryWrite = sql`(${discoveryScope}) and public.current_business_role() in ('owner', 'admin')`;
const discoveryOwner = sql`current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.discovery_run'::regclass)`;

export const discoveryConfiguration = pgTable(
  "discovery_configuration",
  {
    businessId: uuid("business_id")
      .primaryKey()
      .references(() => business.id),
    policy: jsonb("policy").$type<DiscoveryPolicy>().notNull(),
  },
  () => [
    pgPolicy("discovery_configuration_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
  ],
).enableRLS();

export const discoveryRun = pgTable(
  "discovery_run",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    brief: jsonb("brief").$type<DiscoveryBrief>().notNull(),
    policy: jsonb("policy").$type<DiscoveryPolicy>().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    executionId: uuid("execution_id").notNull(),
    executionUserId: text("execution_user_id"),
    attempt: integer("attempt").notNull().default(0),
    scheduleId: uuid("schedule_id"),
    scheduleRevision: integer("schedule_revision"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    durableRunId: text("durable_run_id"),
    durableAttempt: integer("durable_attempt").notNull().default(0),
    attemptStartedAt: timestamp("attempt_started_at", { withTimezone: true }),
    completedSearchKeys: jsonb("completed_search_keys")
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text("status").$type<RunStatus>().notNull(),
    stopReason: text("stop_reason").$type<StopReason>(),
    budget: integer("budget").notNull(),
    used: integer("used").notNull().default(0),
    completedSteps: integer("completed_steps").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("discovery_request_key").on(table.businessId, table.requestKey),
    uniqueIndex("discovery_schedule_occurrence").on(
      table.businessId,
      table.scheduleId,
      table.scheduleRevision,
      table.scheduledFor,
    ),
    index("discovery_run_business_idx").on(table.businessId, table.createdAt),
    check(
      "discovery_budget_bound",
      sql`${table.budget} > 0 and ${table.used} >= 0 and ${table.used} <= ${table.budget}`,
    ),
    pgPolicy("discovery_run_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_run_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and created_by = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("discovery_run_update", {
      for: "update",
      to: appRuntime,
      using: discoveryWrite,
      withCheck: discoveryWrite,
    }),
    pgPolicy("discovery_run_system", {
      for: "all",
      to: "public",
      using: discoveryOwner,
      withCheck: discoveryOwner,
    }),
  ],
).enableRLS();

export const discoveryProspect = pgTable(
  "discovery_prospect",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    canonicalUrl: text("canonical_url").notNull(),
  },
  (table) => [
    index("discovery_prospect_source").on(table.businessId, table.canonicalUrl),
    pgPolicy("discovery_prospect_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_prospect_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: discoveryWrite,
    }),
  ],
).enableRLS();

// Immutable aliases and observations share the Business lock with run reservations.
export const discoveryProspectAlias = pgTable(
  "discovery_prospect_alias",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    key: text("key").notNull(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => discoveryProspect.id),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.key] }),
    pgPolicy("discovery_alias_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_alias_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and exists (select 1 from public.discovery_prospect p where p.id = prospect_id and p.business_id = ${table.businessId})`,
    }),
  ],
).enableRLS();

export const discoveryObservation = pgTable(
  "discovery_observation",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => discoveryUsage.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRun.id),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => discoveryProspect.id),
    data: jsonb("data").$type<Omit<DiscoveryProspect, "id">>().notNull(),
    outcome: text("outcome").$type<ObservationOutcome>().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("discovery_observation_history").on(
      table.businessId,
      table.prospectId,
      table.checkedAt,
    ),
    pgPolicy("discovery_observation_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_observation_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = ${table.businessId}) and exists (select 1 from public.discovery_prospect p where p.id = prospect_id and p.business_id = ${table.businessId}) and exists (select 1 from public.discovery_usage u where u.id = ${table.id} and u.run_id = ${table.runId} and u.business_id = ${table.businessId} and u.kind = 'review' and u.outcome = 'reserved')`,
    }),
  ],
).enableRLS();

export const discoveryResult = pgTable(
  "discovery_result",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRun.id),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => discoveryProspect.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    data: jsonb("data").$type<Omit<DiscoveryProspect, "id">>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.prospectId] }),
    pgPolicy("discovery_result_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_result_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = ${table.businessId}) and exists (select 1 from public.discovery_prospect p where p.id = prospect_id and p.business_id = ${table.businessId})`,
    }),
  ],
).enableRLS();

export const discoveryUsage = pgTable(
  "discovery_usage",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRun.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    kind: text("kind").$type<"search" | "review">().notNull(),
    units: integer("units").notNull(),
    position: integer("position").notNull(),
    outcome: text("outcome")
      .$type<"reserved" | "succeeded" | "failed" | "uncertain">()
      .notNull(),
    query: text("query"),
    returnedResults: integer("returned_results"),
    stepKey: text("step_key"),
    executionId: uuid("execution_id"),
    sources: jsonb("sources").$type<SearchResult[]>(),
    sourceUrl: text("source_url"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    checkOrder: bigint("check_order", { mode: "number" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("discovery_usage_step_attempt").on(
      table.runId,
      table.stepKey,
      table.executionId,
    ),
    index("discovery_usage_run_idx").on(table.businessId, table.runId),
    uniqueIndex("discovery_check_order").on(table.businessId, table.checkOrder),
    check("discovery_usage_positive", sql`${table.units} > 0`),
    check(
      "discovery_returned_results_nonnegative",
      sql`${table.returnedResults} >= 0`,
    ),
    pgPolicy("discovery_usage_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_usage_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = ${table.businessId})`,
    }),
    pgPolicy("discovery_usage_update", {
      for: "update",
      to: appRuntime,
      using: discoveryWrite,
      withCheck: discoveryWrite,
    }),
    pgPolicy("discovery_usage_system", {
      for: "all",
      to: "public",
      using: discoveryOwner,
      withCheck: discoveryOwner,
    }),
  ],
).enableRLS();

// Append-only approvals and execution commands; capabilities stay off public views.
export const discoveryCommand = pgTable(
  "discovery_command",
  {
    id: uuid("id").notNull(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRun.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    executionId: uuid("execution_id").notNull(),
    input: jsonb("input").$type<DiscoveryCommand>().notNull(),
    position: integer("position").notNull(),
    budgetBefore: integer("budget_before").notNull(),
    budgetAfter: integer("budget_after").notNull(),
    stopReason: text("stop_reason").$type<StopReason>(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.businessId, table.id] }),
    index("discovery_command_run_idx").on(table.businessId, table.runId),
    pgPolicy("discovery_command_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_command_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and actor_id = current_setting('app.actor_id', true) and exists (select 1 from public.discovery_run r where r.id = run_id and r.business_id = ${table.businessId})`,
    }),
  ],
).enableRLS();

export const discoverySchedule = pgTable(
  "discovery_schedule",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    revision: integer("revision").notNull(),
    dispatchKey: uuid("dispatch_key").notNull(),
    input: jsonb("input").$type<SaveSchedule>().notNull(),
    brief: jsonb("brief").$type<DiscoveryBrief>().notNull(),
    policy: jsonb("policy").$type<DiscoveryPolicy>().notNull(),
    lastCommand: jsonb("last_command").$type<unknown>().notNull(),
    status: text("status").$type<"active" | "paused">().notNull(),
    nextDueAt: timestamp("next_due_at", { withTimezone: true }),
    failure: text("failure").$type<ScheduleFailure>(),
    lastRunId: uuid("last_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  () => [
    pgPolicy("discovery_schedule_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_schedule_write", {
      for: "all",
      to: appRuntime,
      using: discoveryWrite,
      withCheck: discoveryWrite,
    }),
    pgPolicy("discovery_schedule_system", {
      for: "all",
      to: "public",
      using: discoveryOwner,
      withCheck: discoveryOwner,
    }),
  ],
).enableRLS();

// Transactional outbox: identifiers and scoped capabilities only, never briefs.
export const discoveryDispatch = pgTable(
  "discovery_dispatch",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    payload: jsonb("payload").$type<Dispatch>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    state: text("state")
      .$type<"pending" | "enqueued">()
      .notNull()
      .default("pending"),
    failure: text("failure").$type<"queue_unavailable">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  () => [
    pgPolicy("discovery_dispatch_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_dispatch_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${discoveryWrite}) and payload->'work'->>'businessId' = business_id::text and payload->'work'->>'userId' = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("discovery_dispatch_system", {
      for: "all",
      to: "public",
      using: discoveryOwner,
      withCheck: discoveryOwner,
    }),
  ],
).enableRLS();
