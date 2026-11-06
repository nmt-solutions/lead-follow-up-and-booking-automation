import type {
  MailboxConfiguration,
  MailboxGrant,
  MailboxJobState,
  MailboxMetadata,
} from "../models/mailboxes";
import type { WorkIdentity } from "../models/discovery";
import type { MailboxAuthorizationStatus } from "../models/mailbox-authorization";
import type { MailManual } from "../models/mail-native";
import type {
  MicrosoftCalendarStatus,
  MicrosoftIdentity,
} from "../models/microsoft-calendar";
import { sql } from "drizzle-orm";
import type { CampaignSnapshot } from "../models/campaigns";
import type {
  EmailMarketPolicy,
  RecipientFacts,
  EmailEligibility,
  AddEmailSuppression,
  EmailContentReview,
  IncomingOptOutEvidence,
} from "../models/email-eligibility";
import type {
  SenderConnectionConfiguration,
  ReplyRouteConfiguration,
  SenderIdentityConfiguration,
  SenderEvidence,
  SenderInspection,
} from "../models/senders";
import type { GoogleCalendarStatus } from "../models/google-calendar";
import {
  bigint,
  boolean,
  check,
  ForeignKey,
  foreignKey,
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
import type {
  AiProfile,
  AiSample,
  AiOutput,
  AiFailure,
  AiRoute,
  AiMetrics,
} from "../models/ai";
import type { KnowledgeConfiguration } from "../models/knowledge";
import type { InquirySnapshot, InquiryResult } from "../models/inquiries";
import type { RfqRecord } from "../models/rfq";
import type {
  BookingConfiguration,
  CalendarDescriptor,
  BookingIntent,
  CalendarEvent,
  AppointmentView,
} from "../models/appointments";
import type {
  CommercialPayload,
  CommercialActionView,
  CommercialEvidence,
} from "../models/commercial-actions";
import type { CommercialPolicy } from "../models/commercial-authority";
import type {
  ControlSnapshot,
  PolicyReview,
  ControlHistory,
  QueueOpportunityAction,
  DueAction,
} from "../models/opportunity-control";
import type {
  AddInboxConnection,
  IncomingInquiry,
  AssociationChange,
  OpportunityHistoryEntry,
} from "../models/inbox";

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
    ai: boolean("ai").notNull().default(false),
    discovery: boolean("discovery").notNull().default(false),
    emailPolicy: boolean("email_policy").notNull().default(false),
  },
  (table) => [
    pgPolicy("operator_read", {
      for: "select",
      to: appRuntime,
      using: sql`${table.userId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

const aiOperatorScope = sql`exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.ai)`;
const aiMemberScope = sql`public.current_business_role() is not null`;
const aiBusinessScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and (${aiMemberScope})`;
export const aiProfile = pgTable(
  "ai_profile",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull(),
    profile: jsonb("profile").$type<AiProfile>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
    usedAttempts: integer("used_attempts").notNull().default(0),
    usedFallbackAttempts: integer("used_fallback_attempts")
      .notNull()
      .default(0),
  },
  (table) => [
    uniqueIndex("ai_profile_version").on(table.version),
    check(
      "ai_profile_counters",
      sql`${table.version} > 0 and ${table.usedAttempts} >= 0 and ${table.usedFallbackAttempts} >= 0 and ${table.usedFallbackAttempts} <= ${table.usedAttempts}`,
    ),
    pgPolicy("ai_profile_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${aiOperatorScope}) or (${aiMemberScope})`,
    }),
    pgPolicy("ai_profile_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${aiOperatorScope}) and public.current_business_role() in ('owner','admin') and actor_id = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("ai_profile_update", {
      for: "update",
      to: appRuntime,
      using: aiMemberScope,
      withCheck: aiMemberScope,
    }),
  ],
).enableRLS();
export const aiActivation = pgTable(
  "ai_activation",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => aiProfile.id),
  },
  (table) => [
    uniqueIndex("ai_activation_version").on(table.version),
    pgPolicy("ai_activation_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${aiOperatorScope}) or (${aiMemberScope})`,
    }),
    pgPolicy("ai_activation_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${aiOperatorScope}) and public.current_business_role() in ('owner','admin')`,
    }),
  ],
).enableRLS();
export const aiActivationAudit = pgTable(
  "ai_activation_audit",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => aiActivation.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  () => [
    pgPolicy("ai_activation_audit_read", {
      for: "select",
      to: appRuntime,
      using: aiBusinessScope,
    }),
    pgPolicy("ai_activation_audit_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${aiBusinessScope}) and (${aiOperatorScope}) and public.current_business_role() in ('owner','admin') and actor_id = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();
export const aiExecution = pgTable(
  "ai_execution",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => aiProfile.id),
    requestKey: uuid("request_key").notNull(),
    requestHash: text("request_hash").notNull(),
    task: text("task").$type<"extraction" | "drafting">().notNull(),
    kind: text("kind").$type<"preview" | "workflow">().notNull(),
    knowledgeVersion: integer("knowledge_version").notNull(),
    sample: jsonb("sample").$type<AiSample>().notNull(),
    input: text("input").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    status: text("status")
      .$type<
        "running" | "succeeded" | "failed" | "uncertain" | "setup_required"
      >()
      .notNull(),
    failure: text("failure").$type<AiFailure>(),
    output: jsonb("output").$type<AiOutput>(),
  },
  (table) => [
    uniqueIndex("ai_execution_request").on(table.businessId, table.requestKey),
    uniqueIndex("ai_execution_scope").on(table.id, table.businessId),
    check(
      "ai_execution_values",
      sql`${table.task} in ('extraction','drafting') and ${table.kind} in ('preview','workflow') and ${table.status} in ('running','succeeded','failed','uncertain','setup_required') and ${table.knowledgeVersion} > 0`,
    ),
    pgPolicy("ai_execution_read", {
      for: "select",
      to: appRuntime,
      using: aiBusinessScope,
    }),
    pgPolicy("ai_execution_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${aiBusinessScope}) and actor_id = current_setting('app.actor_id', true) and (kind = 'workflow' or (${aiOperatorScope}))`,
    }),
    pgPolicy("ai_execution_update", {
      for: "update",
      to: appRuntime,
      using: aiBusinessScope,
      withCheck: aiBusinessScope,
    }),
  ],
).enableRLS();
export const aiAttempt = pgTable(
  "ai_attempt",
  {
    id: uuid("id").primaryKey(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => aiExecution.id),
    number: integer("number").notNull(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    route: text("route").$type<AiRoute>().notNull(),
    outcome: text("outcome")
      .$type<"succeeded" | "failed" | "uncertain">()
      .notNull(),
    failure: text("failure").$type<AiFailure>(),
    metrics: jsonb("metrics").$type<AiMetrics>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    latencyMs: integer("latency_ms"),
    fundingSource: text("funding_source")
      .$type<
        "linked_api_credits" | "purchased_api_credits" | "gateway_credits"
      >()
      .notNull(),
    fundingReference: text("funding_reference").notNull(),
  },
  (table) => [
    index("ai_attempt_execution").on(table.businessId, table.executionId),
    uniqueIndex("ai_attempt_number").on(table.executionId, table.number),
    check(
      "ai_attempt_values",
      sql`${table.number} > 0 and ${table.route} in ('operator_byok','gateway_system') and ${table.outcome} in ('succeeded','failed','uncertain') and (${table.latencyMs} is null or ${table.latencyMs} >= 0)`,
    ),
    pgPolicy("ai_attempt_read", {
      for: "select",
      to: appRuntime,
      using: aiBusinessScope,
    }),
    pgPolicy("ai_attempt_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: aiBusinessScope,
    }),
    pgPolicy("ai_attempt_update", {
      for: "update",
      to: appRuntime,
      using: aiBusinessScope,
      withCheck: aiBusinessScope,
    }),
  ],
).enableRLS();
export const aiReview = pgTable(
  "ai_review",
  {
    id: uuid("id").primaryKey(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => aiExecution.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    accepted: boolean("accepted").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("ai_review_execution").on(table.executionId),
    pgPolicy("ai_review_read", {
      for: "select",
      to: appRuntime,
      using: aiBusinessScope,
    }),
    pgPolicy("ai_review_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${aiBusinessScope}) and (${aiOperatorScope}) and public.current_business_role() in ('owner','admin') and actor_id = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

// The pinned push orders composite foreign keys before unique indexes on fresh
// databases. Keep their typed declarations here; secureDatabase installs and
// validates them after index creation, before restoring restricted access.
export const aiExecutionScopeForeignKeys = [
  new ForeignKey(
    aiAttempt,
    foreignKey({
      name: "ai_attempt_execution_scope",
      columns: [aiAttempt.executionId, aiAttempt.businessId],
      foreignColumns: [aiExecution.id, aiExecution.businessId],
    }),
  ),
  new ForeignKey(
    aiReview,
    foreignKey({
      name: "ai_review_execution_scope",
      columns: [aiReview.executionId, aiReview.businessId],
      foreignColumns: [aiExecution.id, aiExecution.businessId],
    }),
  ),
];

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
    uniqueIndex("discovery_observation_business_scope").on(
      table.id,
      table.businessId,
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
    kind: text("kind").$type<"search" | "contents" | "review">().notNull(),
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

function inboxColumns() {
  return {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
  };
}
const inboxScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and public.current_business_role() is not null`;
const inboxWrite = sql`(${inboxScope}) and public.current_business_role() in ('owner', 'admin')`;
function senderPolicies(name: string, mutable: boolean) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxWrite}) and created_by = current_setting('app.actor_id', true)`,
    }),
    ...(mutable
      ? [
          pgPolicy(`${name}_update`, {
            for: "update",
            to: appRuntime,
            using: inboxWrite,
            withCheck: inboxWrite,
          }),
        ]
      : []),
  ];
}
function senderColumns() {
  return {
    ...inboxColumns(),
    version: integer("version").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  };
}
export const senderConnection = pgTable(
  "sender_connection",
  {
    ...senderColumns(),
    configuration: jsonb("configuration")
      .$type<SenderConnectionConfiguration>()
      .notNull(),
  },
  (t) => [
    uniqueIndex("sender_connection_scope").on(t.id, t.businessId),
    check("sender_connection_version", sql`${t.version} > 0`),
    ...senderPolicies("sender_connection", true),
  ],
).enableRLS();
export const senderReplyRoute = pgTable(
  "sender_reply_route",
  {
    ...senderColumns(),
    configuration: jsonb("configuration")
      .$type<ReplyRouteConfiguration>()
      .notNull(),
    connectionId: uuid("connection_id").notNull(),
    inboxConnectionId: uuid("inbox_connection_id").notNull(),
  },
  (t) => [
    uniqueIndex("sender_reply_route_scope").on(t.id, t.businessId),
    uniqueIndex("sender_reply_route_inbox").on(t.inboxConnectionId),
    ...senderPolicies("sender_reply_route", true),
  ],
).enableRLS();
export const senderIdentity = pgTable(
  "sender_identity",
  {
    ...senderColumns(),
    configuration: jsonb("configuration")
      .$type<SenderIdentityConfiguration>()
      .notNull(),
    connectionId: uuid("connection_id"),
    replyRouteId: uuid("reply_route_id"),
  },
  (t) => [
    uniqueIndex("sender_identity_scope").on(t.id, t.businessId),
    uniqueIndex("sender_identity_reply_selection").on(t.replyRouteId),
    ...senderPolicies("sender_identity", true),
  ],
).enableRLS();
export const senderObservation = pgTable(
  "sender_observation",
  {
    ...inboxColumns(),
    identityId: uuid("identity_id").notNull(),
    evidence: jsonb("evidence").$type<SenderEvidence>().notNull(),
    context: jsonb("context").$type<SenderInspection>().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  },
  () => [...senderPolicies("sender_observation", false)],
).enableRLS();
function inboxPolicies(name: string) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck:
        name === "inbox_connection"
          ? sql`(${inboxWrite}) and created_by = current_setting('app.actor_id', true)`
          : name === "inbox_opportunity"
            ? inboxScope
            : inboxWrite,
    }),
    ...(["inbox_connection", "inbox_conversation", "inbox_message"].includes(
      name,
    )
      ? [
          pgPolicy(`${name}_update`, {
            for: "update",
            to: appRuntime,
            using: inboxWrite,
            withCheck: inboxWrite,
          }),
        ]
      : []),
  ];
}

export const inboxConnection = pgTable(
  "inbox_connection",
  {
    ...inboxColumns(),
    label: text("label").notNull(),
    channel: text("channel").$type<AddInboxConnection["channel"]>().notNull(),
    conversationRefs: jsonb("conversation_refs").$type<string[]>().notNull(),
    active: boolean("active").notNull(),
    mode: text("mode")
      .$type<"normalized_import" | "mailbox">()
      .notNull()
      .default("normalized_import"),
    manualRepliesObservable: boolean("manual_replies_observable")
      .notNull()
      .default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_connection_scope").on(table.id, table.businessId),
    check("inbox_channel", sql`${table.channel} in ('email','whatsapp')`),
    ...inboxPolicies("inbox_connection"),
  ],
).enableRLS();

export const mailboxPolicy = pgTable(
  "mailbox_policy",
  {
    ...senderColumns(),
    connectionId: uuid("connection_id").notNull(),
    connectionVersion: integer("connection_version").notNull(),
    provider: text("provider").$type<"gmail" | "microsoft">().notNull(),
    account: text("account").notNull(),
    configuration: jsonb("configuration")
      .$type<MailboxConfiguration>()
      .notNull(),
    incrementalSince: timestamp("incremental_since", {
      withTimezone: true,
    }).notNull(),
    cursor: text("cursor"),
    grant: jsonb("permission_observation").$type<MailboxGrant>(),
    visibility: text("visibility")
      .$type<"unsafe" | "current" | "recovering" | "limited">()
      .notNull()
      .default("unsafe"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    completeReplyCapture: boolean("complete_reply_capture")
      .notNull()
      .default(false),
  },
  (t) => [
    uniqueIndex("mailbox_policy_scope").on(t.id, t.businessId),
    uniqueIndex("mailbox_policy_connection").on(t.connectionId),
    check("mailbox_policy_version", sql`${t.version} > 0`),
    ...senderPolicies("mailbox_policy", true),
  ],
).enableRLS();
export const mailboxJob = pgTable(
  "mailbox_job",
  {
    ...inboxColumns(),
    mailboxId: uuid("mailbox_id").notNull(),
    successorId: uuid("successor_id"),
    policyVersion: integer("policy_version").notNull(),
    identity: jsonb("identity").$type<WorkIdentity>().notNull(),
    state: jsonb("state").$type<MailboxJobState>().notNull(),
    cursor: text("cursor"),
    seen: jsonb("seen").$type<string[]>().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("mailbox_job_scope").on(t.id, t.businessId, t.mailboxId),
    ...senderPolicies("mailbox_job", true),
  ],
).enableRLS();

export const inboxBuyer = pgTable(
  "inbox_buyer",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    senderRef: text("sender_ref").notNull(),
    name: text("name").notNull(),
    geography: text("geography"),
    engagedAt: timestamp("engaged_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_buyer_identity").on(table.connectionId, table.senderRef),
    uniqueIndex("inbox_buyer_business_scope").on(table.id, table.businessId),
    uniqueIndex("inbox_buyer_scope").on(
      table.id,
      table.businessId,
      table.connectionId,
    ),
    ...inboxPolicies("inbox_buyer"),
  ],
).enableRLS();

export const inboxConversation = pgTable(
  "inbox_conversation",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    buyerId: uuid("buyer_id").notNull(),
    providerRef: text("provider_ref").notNull(),
    subject: text("subject").notNull(),
    lastReceivedAt: timestamp("last_received_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_conversation_identity").on(
      table.connectionId,
      table.providerRef,
    ),
    uniqueIndex("inbox_conversation_business_scope").on(
      table.id,
      table.businessId,
    ),
    uniqueIndex("inbox_conversation_scope").on(
      table.id,
      table.businessId,
      table.connectionId,
    ),
    ...inboxPolicies("inbox_conversation"),
  ],
).enableRLS();

export const inboxOpportunity = pgTable(
  "inbox_opportunity",
  {
    ...inboxColumns(),
    // Original intake references are immutable; explicitly created needs have no initial intake row.
    connectionId: uuid("connection_id"),
    conversationId: uuid("conversation_id"),
    buyerId: uuid("buyer_id"),
    title: text("title").notNull().default("Purchasing need"),
    stage: text("stage").$type<"inquiry">().notNull(),
    ownerId: text("owner_id").references(() => user.id),
    handoffReason: text("handoff_reason").notNull(),
    nextAction: text("next_action").notNull(),
    controlState: text("control_state")
      .$type<ControlSnapshot["state"]>()
      .notNull()
      .default("human"),
    controlVersion: integer("control_version").notNull().default(0),
    policyVersion: integer("policy_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_initial_opportunity").on(table.conversationId),
    uniqueIndex("inbox_opportunity_business_scope").on(
      table.id,
      table.businessId,
    ),
    uniqueIndex("inbox_opportunity_buyer_identity").on(
      table.id,
      table.businessId,
      table.buyerId,
    ),
    check("inbox_initial_stage", sql`${table.stage} = 'inquiry'`),
    check(
      "opportunity_control_state",
      sql`${table.controlState} in ('human','automation') and ${table.controlVersion} >= 0`,
    ),
    ...inboxPolicies("inbox_opportunity"),
    pgPolicy("inbox_opportunity_control_update", {
      for: "update",
      to: appRuntime,
      using: inboxScope,
      withCheck: inboxScope,
    }),
  ],
).enableRLS();

export const inboxMessage = pgTable(
  "inbox_message",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    messageRef: text("message_ref").notNull(),
    content: jsonb("content").$type<IncomingInquiry>().notNull(),
    mailboxMetadata: jsonb("mailbox_metadata").$type<MailboxMetadata>(),
    mailboxCurrentMetadata: jsonb(
      "mailbox_current_metadata",
    ).$type<MailboxMetadata>(),
    fingerprint: text("fingerprint").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_message_identity").on(
      table.connectionId,
      table.messageRef,
    ),
    uniqueIndex("inbox_message_mailbox_scope").on(
      table.id,
      table.businessId,
      table.connectionId,
    ),
    uniqueIndex("inbox_message_scope").on(
      table.id,
      table.businessId,
      table.conversationId,
    ),
    ...inboxPolicies("inbox_message"),
  ],
).enableRLS();

export const inboxEvent = pgTable(
  "inbox_event",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    eventRef: text("event_ref").notNull(),
    fingerprint: text("fingerprint").notNull(),
    conversationId: uuid("conversation_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("inbox_event_identity").on(table.connectionId, table.eventRef),
    ...inboxPolicies("inbox_event"),
  ],
).enableRLS();

function associationPolicies(name: string, mutable = false) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: [
        "inbox_association_history",
        "inquiry_run",
        "rfq_request",
        "rfq_revision",
      ].includes(name)
        ? sql`(${inboxScope}) and actor_id = current_setting('app.actor_id', true)`
        : inboxScope,
    }),
    ...(mutable
      ? [
          pgPolicy(`${name}_update`, {
            for: "update",
            to: appRuntime,
            using: inboxScope,
            withCheck: inboxScope,
          }),
        ]
      : []),
  ];
}
export const inboxAssociation = pgTable(
  "inbox_association",
  {
    ...inboxColumns(),
    buyerId: uuid("buyer_id").notNull(),
    initialOpportunityId: uuid("initial_opportunity_id").notNull(),
    defaultOpportunityId: uuid("default_opportunity_id"),
    version: integer("version").notNull(),
    reviewReason: text("review_reason"),
    reviewOwnerId: text("review_owner_id")
      .notNull()
      .references(() => user.id),
    nextAction: text("next_action").notNull(),
  },
  (table) => [
    uniqueIndex("inbox_association_scope").on(table.id, table.businessId),
    ...associationPolicies("inbox_association", true),
  ],
).enableRLS();
export const inboxMessageLink = pgTable(
  "inbox_message_link",
  {
    ...inboxColumns(),
    sequence: integer("sequence").notNull().default(0),
    conversationId: uuid("conversation_id").notNull(),
    opportunityId: uuid("opportunity_id"),
  },
  () => associationPolicies("inbox_message_link", true),
).enableRLS();
export const inboxAssociationHistory = pgTable(
  "inbox_association_history",
  {
    ...inboxColumns(),
    version: integer("version").notNull().default(0),
    conversationId: uuid("conversation_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    sourceEventId: text("source_event_id"),
    discoveryObservationId: uuid("discovery_observation_id"),
    before: jsonb("before").$type<AssociationChange>().notNull(),
    after: jsonb("after").$type<AssociationChange>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  () => associationPolicies("inbox_association_history"),
).enableRLS();

// Association reads existing history; later ownership/outcome workflows own writes.
export const inboxOpportunityHistory = pgTable(
  "inbox_opportunity_history",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    kind: text("kind").$type<OpportunityHistoryEntry["kind"]>().notNull(),
    detail: text("detail").notNull(),
    actorId: text("actor_id").references(() => user.id),
    sourceRef: text("source_ref"),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "inbox_opportunity_history_kind",
      sql`${table.kind} in ('ownership','booking_request','confirmed_appointment','attended_appointment','quotation_request','issued_quote','sale')`,
    ),
    pgPolicy("inbox_opportunity_history_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
  ],
).enableRLS();

// Installed after unique indexes by secureDatabase, matching the pinned push contract.
export const mailboxScopeForeignKeys = [
  new ForeignKey(
    mailboxJob,
    foreignKey({
      name: "mailbox_job_successor_scope",
      columns: [
        mailboxJob.successorId,
        mailboxJob.businessId,
        mailboxJob.mailboxId,
      ],
      foreignColumns: [
        mailboxJob.id,
        mailboxJob.businessId,
        mailboxJob.mailboxId,
      ],
    }),
  ),
  new ForeignKey(
    mailboxPolicy,
    foreignKey({
      name: "mailbox_policy_inbox_scope",
      columns: [mailboxPolicy.id, mailboxPolicy.businessId],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    mailboxPolicy,
    foreignKey({
      name: "mailbox_policy_connection_scope",
      columns: [mailboxPolicy.connectionId, mailboxPolicy.businessId],
      foreignColumns: [senderConnection.id, senderConnection.businessId],
    }),
  ),
  new ForeignKey(
    mailboxJob,
    foreignKey({
      name: "mailbox_job_policy_scope",
      columns: [mailboxJob.mailboxId, mailboxJob.businessId],
      foreignColumns: [mailboxPolicy.id, mailboxPolicy.businessId],
    }),
  ),
];
export const senderScopeForeignKeys = [
  new ForeignKey(
    senderReplyRoute,
    foreignKey({
      name: "sender_route_connection_scope",
      columns: [senderReplyRoute.connectionId, senderReplyRoute.businessId],
      foreignColumns: [senderConnection.id, senderConnection.businessId],
    }),
  ),
  new ForeignKey(
    senderReplyRoute,
    foreignKey({
      name: "sender_route_inbox_scope",
      columns: [
        senderReplyRoute.inboxConnectionId,
        senderReplyRoute.businessId,
      ],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    senderIdentity,
    foreignKey({
      name: "sender_identity_connection_scope",
      columns: [senderIdentity.connectionId, senderIdentity.businessId],
      foreignColumns: [senderConnection.id, senderConnection.businessId],
    }),
  ),
  new ForeignKey(
    senderIdentity,
    foreignKey({
      name: "sender_identity_route_scope",
      columns: [senderIdentity.replyRouteId, senderIdentity.businessId],
      foreignColumns: [senderReplyRoute.id, senderReplyRoute.businessId],
    }),
  ),
  new ForeignKey(
    senderObservation,
    foreignKey({
      name: "sender_observation_identity_scope",
      columns: [senderObservation.identityId, senderObservation.businessId],
      foreignColumns: [senderIdentity.id, senderIdentity.businessId],
    }),
  ),
];
export const inboxScopeForeignKeys = [
  new ForeignKey(
    inboxAssociationHistory,
    foreignKey({
      name: "inbox_association_discovery_scope",
      columns: [
        inboxAssociationHistory.discoveryObservationId,
        inboxAssociationHistory.businessId,
      ],
      foreignColumns: [
        discoveryObservation.id,
        discoveryObservation.businessId,
      ],
    }),
  ),
  new ForeignKey(
    inboxAssociation,
    foreignKey({
      name: "inbox_association_initial_need_scope",
      columns: [
        inboxAssociation.initialOpportunityId,
        inboxAssociation.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    inboxOpportunityHistory,
    foreignKey({
      name: "inbox_opportunity_history_need_scope",
      columns: [
        inboxOpportunityHistory.opportunityId,
        inboxOpportunityHistory.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    inboxOpportunity,
    foreignKey({
      name: "inbox_opportunity_buyer_scope",
      columns: [inboxOpportunity.buyerId, inboxOpportunity.businessId],
      foreignColumns: [inboxBuyer.id, inboxBuyer.businessId],
    }),
  ),
  new ForeignKey(
    inboxAssociation,
    foreignKey({
      name: "inbox_association_conversation_scope",
      columns: [inboxAssociation.id, inboxAssociation.businessId],
      foreignColumns: [inboxConversation.id, inboxConversation.businessId],
    }),
  ),
  new ForeignKey(
    inboxAssociation,
    foreignKey({
      name: "inbox_association_buyer_scope",
      columns: [inboxAssociation.buyerId, inboxAssociation.businessId],
      foreignColumns: [inboxBuyer.id, inboxBuyer.businessId],
    }),
  ),
  new ForeignKey(
    inboxAssociation,
    foreignKey({
      name: "inbox_association_need_scope",
      columns: [
        inboxAssociation.defaultOpportunityId,
        inboxAssociation.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    inboxMessageLink,
    foreignKey({
      name: "inbox_message_link_source_scope",
      columns: [
        inboxMessageLink.id,
        inboxMessageLink.businessId,
        inboxMessageLink.conversationId,
      ],
      foreignColumns: [
        inboxMessage.id,
        inboxMessage.businessId,
        inboxMessage.conversationId,
      ],
    }),
  ),
  new ForeignKey(
    inboxMessageLink,
    foreignKey({
      name: "inbox_message_link_need_scope",
      columns: [inboxMessageLink.opportunityId, inboxMessageLink.businessId],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    inboxAssociationHistory,
    foreignKey({
      name: "inbox_association_history_scope",
      columns: [
        inboxAssociationHistory.conversationId,
        inboxAssociationHistory.businessId,
      ],
      foreignColumns: [inboxAssociation.id, inboxAssociation.businessId],
    }),
  ),
  new ForeignKey(
    inboxBuyer,
    foreignKey({
      name: "inbox_buyer_connection_scope",
      columns: [inboxBuyer.connectionId, inboxBuyer.businessId],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    inboxConversation,
    foreignKey({
      name: "inbox_conversation_buyer_scope",
      columns: [
        inboxConversation.buyerId,
        inboxConversation.businessId,
        inboxConversation.connectionId,
      ],
      foreignColumns: [
        inboxBuyer.id,
        inboxBuyer.businessId,
        inboxBuyer.connectionId,
      ],
    }),
  ),
  new ForeignKey(
    inboxOpportunity,
    foreignKey({
      name: "inbox_opportunity_conversation_scope",
      columns: [
        inboxOpportunity.conversationId,
        inboxOpportunity.businessId,
        inboxOpportunity.connectionId,
      ],
      foreignColumns: [
        inboxConversation.id,
        inboxConversation.businessId,
        inboxConversation.connectionId,
      ],
    }),
  ),
  new ForeignKey(
    inboxMessage,
    foreignKey({
      name: "inbox_message_conversation_scope",
      columns: [
        inboxMessage.conversationId,
        inboxMessage.businessId,
        inboxMessage.connectionId,
      ],
      foreignColumns: [
        inboxConversation.id,
        inboxConversation.businessId,
        inboxConversation.connectionId,
      ],
    }),
  ),
  new ForeignKey(
    inboxEvent,
    foreignKey({
      name: "inbox_event_connection_scope",
      columns: [inboxEvent.connectionId, inboxEvent.businessId],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    inboxEvent,
    foreignKey({
      name: "inbox_event_conversation_scope",
      columns: [
        inboxEvent.conversationId,
        inboxEvent.businessId,
        inboxEvent.connectionId,
      ],
      foreignColumns: [
        inboxConversation.id,
        inboxConversation.businessId,
        inboxConversation.connectionId,
      ],
    }),
  ),
];

export const opportunityControlHistory = pgTable(
  "opportunity_control_history",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    command: text("command").$type<ControlHistory["command"]>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    before: jsonb("before").$type<ControlSnapshot>().notNull(),
    after: jsonb("after").$type<ControlSnapshot>().notNull(),
    sourceRef: text("source_ref"),
    policy: jsonb("policy").$type<PolicyReview>(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  () => [
    pgPolicy("opportunity_control_history_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("opportunity_control_history_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and actor_id = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

export const opportunityManualEvent = pgTable(
  "opportunity_manual_event",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    opportunityId: uuid("opportunity_id").notNull(),
    eventRef: text("event_ref").notNull(),
    messageRef: text("message_ref").notNull(),
    fingerprint: text("fingerprint").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("opportunity_manual_event_identity").on(
      t.connectionId,
      t.eventRef,
    ),
    uniqueIndex("opportunity_manual_message_identity").on(
      t.connectionId,
      t.messageRef,
    ),
    pgPolicy("opportunity_manual_event_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("opportunity_manual_event_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and actor_id = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

export const opportunityDueAction = pgTable(
  "opportunity_due_action",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    messageId: uuid("message_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    controlVersion: integer("control_version").notNull(),
    associationVersion: integer("association_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    inquiryRunId: uuid("inquiry_run_id"),
    evaluation: jsonb("evaluation").$type<
      QueueOpportunityAction["evaluation"] | null
    >(),
    state: text("state").$type<DueAction["state"]>().notNull(),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  () => [
    pgPolicy("opportunity_due_action_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("opportunity_due_action_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and actor_id = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("opportunity_due_action_update", {
      for: "update",
      to: appRuntime,
      using: inboxScope,
      withCheck: inboxScope,
    }),
  ],
).enableRLS();

const emailPolicyOperator = sql`exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.email_policy)`;
export const emailMarketPolicy = pgTable(
  "email_market_policy",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    policy: jsonb("policy").$type<EmailMarketPolicy>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("email_market_policy_version").on(t.key, t.version),
    pgPolicy("email_market_policy_read", {
      for: "select",
      to: appRuntime,
      using: sql`nullif(current_setting('app.actor_id', true), '') is not null`,
    }),
    pgPolicy("email_market_policy_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${emailPolicyOperator}) and actor_id = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

function emailRecordColumns() {
  return {
    ...inboxColumns(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  };
}
function emailRecordPolicies(name: string, manager = false) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${manager ? managerScope : inboxScope}) and actor_id = current_setting('app.actor_id', true)`,
    }),
  ];
}
export const emailRecipientRevision = pgTable(
  "email_recipient_revision",
  {
    ...emailRecordColumns(),
    recipient: text("recipient").notNull(),
    version: integer("version").notNull(),
    facts: jsonb("facts").$type<RecipientFacts>().notNull(),
  },
  (t) => [
    uniqueIndex("email_recipient_version").on(
      t.businessId,
      t.recipient,
      t.version,
    ),
    ...emailRecordPolicies("email_recipient_revision", true),
  ],
).enableRLS();
export const emailSuppression = pgTable(
  "email_suppression",
  {
    ...emailRecordColumns(),
    recipient: text("recipient").notNull(),
    requestKey: uuid("request_key").notNull(),
    suppression: jsonb("suppression").$type<AddEmailSuppression>().notNull(),
    evidence: jsonb("evidence").$type<IncomingOptOutEvidence>(),
    source: text("source").$type<"business" | "incoming_opt_out">().notNull(),
  },
  (t) => [
    uniqueIndex("email_suppression_request").on(t.businessId, t.requestKey),
    ...emailRecordPolicies("email_suppression"),
  ],
).enableRLS();
export const emailEligibilityEvaluation = pgTable(
  "email_eligibility_evaluation",
  {
    ...emailRecordColumns(),
    actionId: uuid("action_id").notNull(),
    sequence: integer("sequence").notNull(),
    result: jsonb("result").$type<EmailEligibility>().notNull(),
  },
  (t) => [
    uniqueIndex("email_eligibility_business_sequence").on(
      t.businessId,
      t.sequence,
    ),
    ...emailRecordPolicies("email_eligibility_evaluation"),
  ],
).enableRLS();
export const emailActionReview = pgTable(
  "email_action_review",
  {
    ...emailRecordColumns(),
    actionId: uuid("action_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    review: jsonb("review").$type<EmailContentReview>().notNull(),
  },
  () => emailRecordPolicies("email_action_review", true),
).enableRLS();

export const inquiryRun = pgTable(
  "inquiry_run",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    messageId: uuid("message_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    sequence: integer("sequence").notNull(),
    requestKey: text("request_key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    snapshot: jsonb("snapshot").$type<InquirySnapshot>().notNull(),
    result: jsonb("result").$type<InquiryResult>().notNull(),
    executionId: uuid("execution_id"),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("inquiry_run_scope").on(t.id, t.businessId),
    uniqueIndex("inquiry_run_request").on(t.businessId, t.requestKey),
    ...associationPolicies("inquiry_run", true),
  ],
).enableRLS();

export const callActivity = pgTable(
  "call_activity",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    buyerId: uuid("buyer_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("call_activity_scope").on(
      t.id,
      t.businessId,
      t.opportunityId,
      t.buyerId,
    ),
    ...commercialPolicies("call_activity"),
  ],
).enableRLS();

export const callRevision = pgTable(
  "call_revision",
  {
    ...inboxColumns(),
    callId: uuid("call_id").notNull(),
    opportunityId: uuid("opportunity_id").notNull(),
    buyerId: uuid("buyer_id").notNull(),
    version: integer("version").notNull(),
    requestKey: uuid("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    responsibleId: text("responsible_id")
      .notNull()
      .references(() => user.id),
    responsibleName: text("responsible_name").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    notes: text("notes").notNull(),
    outcome: text("outcome").notNull(),
    nextAction: text("next_action").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("call_revision_version").on(t.callId, t.version),
    uniqueIndex("call_revision_command").on(t.businessId, t.requestKey),
    check("call_revision_positive", sql`${t.version} > 0`),
    check("call_revision_occurred", sql`${t.occurredAt} <= ${t.at}`),
    ...commercialPolicies("call_revision"),
  ],
).enableRLS();

export const rfqRequest = pgTable(
  "rfq_request",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("rfq_request_need").on(t.businessId, t.opportunityId),
    uniqueIndex("rfq_request_scope").on(t.id, t.businessId, t.opportunityId),
    ...associationPolicies("rfq_request"),
  ],
).enableRLS();

export const rfqRevision = pgTable(
  "rfq_revision",
  {
    ...inboxColumns(),
    requestId: uuid("request_id").notNull(),
    opportunityId: uuid("opportunity_id").notNull(),
    version: integer("version").notNull(),
    requestKey: uuid("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    record: jsonb("record").$type<RfqRecord>().notNull(),
    note: text("note").notNull(),
    nextAction: text("next_action").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("rfq_revision_version").on(t.requestId, t.version),
    uniqueIndex("rfq_revision_command").on(t.businessId, t.requestKey),
    check("rfq_revision_positive", sql`${t.version} > 0`),
    ...associationPolicies("rfq_revision"),
  ],
).enableRLS();

function commercialPolicies(name: string, privileged = false, mutable = false) {
  const write = privileged ? sql`(${inboxWrite})` : inboxScope;
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${write}) and actor_id = current_setting('app.actor_id', true)`,
    }),
    ...(mutable
      ? [
          pgPolicy(`${name}_update`, {
            for: "update",
            to: appRuntime,
            using: inboxScope,
            withCheck: inboxScope,
          }),
        ]
      : []),
  ];
}
export const commercialProposal = pgTable(
  "commercial_proposal",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    sequence: integer("sequence").notNull(),
    seriesId: uuid("series_id").notNull(),
    version: integer("version").notNull(),
    requestKey: uuid("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    payload: jsonb("payload").$type<CommercialPayload>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    contextKey: text("context_key").notNull(),
    policyVersion: integer("policy_version").notNull(),
    evaluation: jsonb("evaluation")
      .$type<CommercialActionView["evaluation"]>()
      .notNull(),
    note: text("note").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("commercial_proposal_scope").on(
      t.id,
      t.businessId,
      t.opportunityId,
    ),
    uniqueIndex("commercial_proposal_version").on(t.seriesId, t.version),
    uniqueIndex("commercial_proposal_request").on(t.businessId, t.requestKey),
    uniqueIndex("commercial_proposal_sequence").on(
      t.businessId,
      t.opportunityId,
      t.sequence,
    ),
    check("commercial_proposal_positive", sql`${t.version}>0`),
    ...commercialPolicies("commercial_proposal"),
  ],
).enableRLS();
export const commercialDecision = pgTable(
  "commercial_decision",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    actionId: uuid("action_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    decision: text("decision").$type<"approved" | "rejected">().notNull(),
    payloadHash: text("payload_hash").notNull(),
    policyVersion: integer("policy_version").notNull(),
    contextKey: text("context_key").notNull(),
    note: text("note").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("commercial_decision_once").on(t.actionId),
    check(
      "commercial_decision_value",
      sql`${t.decision} in ('approved','rejected')`,
    ),
    ...commercialPolicies("commercial_decision", true),
  ],
).enableRLS();
export const commercialExecution = pgTable(
  "commercial_execution",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    actionId: uuid("action_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    state: text("state")
      .$type<NonNullable<CommercialActionView["execution"]>["state"]>()
      .notNull(),
    reason: text("reason"),
    reference: text("reference"),
    provider: text("provider").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("commercial_execution_once").on(t.actionId),
    check(
      "commercial_execution_state",
      sql`${t.state} in ('committed','completed','failed','ambiguous','blocked')`,
    ),
    ...commercialPolicies("commercial_execution", false, true),
  ],
).enableRLS();
export const commercialOutcome = pgTable(
  "commercial_outcome",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    actionId: uuid("action_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    kind: text("kind").$type<CommercialEvidence["kind"]>().notNull(),
    source: text("source").notNull(),
    reference: text("reference").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    note: text("note").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("commercial_outcome_identity").on(
      t.businessId,
      t.source,
      t.kind,
      t.reference,
    ),
    uniqueIndex("commercial_outcome_once").on(t.actionId, t.kind),
    check(
      "commercial_outcome_kind",
      sql`${t.kind} in ('issued_quote','accepted_order','confirmed_sale')`,
    ),
    ...commercialPolicies("commercial_outcome"),
  ],
).enableRLS();

export const commercialScopeForeignKeys = [
  new ForeignKey(
    commercialProposal,
    foreignKey({
      columns: [
        commercialProposal.opportunityId,
        commercialProposal.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  ...[commercialDecision, commercialExecution, commercialOutcome].map(
    (t) =>
      new ForeignKey(
        t,
        foreignKey({
          columns: [t.actionId, t.businessId, t.opportunityId],
          foreignColumns: [
            commercialProposal.id,
            commercialProposal.businessId,
            commercialProposal.opportunityId,
          ],
        }),
      ),
  ),
];

function integrationPolicies(name: string, privileged: boolean) {
  const access = privileged ? inboxWrite : inboxScope;
  return [
    pgPolicy(`${name}_read`, { for: "select", to: appRuntime, using: access }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxWrite}) and actor_id = current_setting('app.actor_id', true)`,
    }),
    pgPolicy(`${name}_update`, {
      for: "update",
      to: appRuntime,
      using: access,
      withCheck: access,
    }),
  ];
}
export const mailboxAppMessage = pgTable(
  "mailbox_app_message",
  {
    ...inboxColumns(),
    mailboxId: uuid("mailbox_id").notNull(),
    messageRef: text("message_ref").notNull(),
    internetMessageId: text("internet_message_id").notNull(),
    replyToMessageId: uuid("reply_to_message_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("mailbox_app_message_ref").on(t.mailboxId, t.messageRef),
    uniqueIndex("mailbox_app_message_internet_ref").on(
      t.mailboxId,
      t.internetMessageId,
    ),
    ...integrationPolicies("mailbox_app_message", false).filter(
      (policy) => policy.for !== "update",
    ),
  ],
).enableRLS();
export const mailboxAppMessageScopeForeignKeys = [
  new ForeignKey(
    mailboxAppMessage,
    foreignKey({
      name: "mailbox_app_message_mailbox_scope",
      columns: [mailboxAppMessage.mailboxId, mailboxAppMessage.businessId],
      foreignColumns: [mailboxPolicy.id, mailboxPolicy.businessId],
    }),
  ),
  new ForeignKey(
    mailboxAppMessage,
    foreignKey({
      name: "mailbox_app_message_reply_scope",
      columns: [
        mailboxAppMessage.replyToMessageId,
        mailboxAppMessage.businessId,
        mailboxAppMessage.mailboxId,
      ],
      foreignColumns: [
        inboxMessage.id,
        inboxMessage.businessId,
        inboxMessage.connectionId,
      ],
    }),
  ),
];
export const microsoftMailGrant = pgTable(
  "microsoft_mail_grant",
  {
    ...inboxColumns(),
    generation: integer("generation").notNull(),
    status: text("status").$type<MailboxAuthorizationStatus>().notNull(),
    reason: text("reason"),
    accountSubject: text("account_subject"),
    credentials: text("credentials"),
    rejectedCredentials: text("rejected_credentials"),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    uniqueIndex("microsoft_mail_grant_scope").on(t.id, t.businessId),
    check("microsoft_mail_generation", sql`${t.generation} > 0`),
    check(
      "microsoft_mail_status",
      sql`${t.status} in ('connecting','connected','reconnect_required','insufficient','revocation_pending','disconnected')`,
    ),
    ...integrationPolicies("microsoft_mail_grant", true),
  ],
).enableRLS();
export const microsoftMailOauth = pgTable(
  "microsoft_mail_oauth",
  {
    ...inboxColumns(),
    mailboxId: uuid("mailbox_id").notNull(),
    generation: integer("generation").notNull(),
    policyVersion: integer("policy_version").notNull(),
    stateHash: text("state_hash").notNull(),
    verifier: text("verifier").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("microsoft_mail_oauth_state").on(t.stateHash),
    ...integrationPolicies("microsoft_mail_oauth", true),
  ],
).enableRLS();
export const microsoftMailScopeForeignKeys = [
  new ForeignKey(
    microsoftMailGrant,
    foreignKey({
      name: "microsoft_mail_grant_mailbox_scope",
      columns: [microsoftMailGrant.id, microsoftMailGrant.businessId],
      foreignColumns: [mailboxPolicy.id, mailboxPolicy.businessId],
    }),
  ),
  new ForeignKey(
    microsoftMailOauth,
    foreignKey({
      name: "microsoft_mail_oauth_grant_scope",
      columns: [microsoftMailOauth.mailboxId, microsoftMailOauth.businessId],
      foreignColumns: [microsoftMailGrant.id, microsoftMailGrant.businessId],
    }),
  ),
];
export const gmailGrant = pgTable(
  "gmail_grant",
  {
    ...inboxColumns(),
    generation: integer("generation").notNull(),
    status: text("status").$type<MailboxAuthorizationStatus>().notNull(),
    reason: text("reason"),
    accountSubject: text("account_subject"),
    credentials: text("credentials"),
    rejectedCredentials: text("rejected_credentials"),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    uniqueIndex("gmail_grant_scope").on(t.id, t.businessId),
    check("gmail_generation", sql`${t.generation} > 0`),
    check(
      "gmail_status",
      sql`${t.status} in ('connecting','connected','reconnect_required','insufficient','revocation_pending','disconnected')`,
    ),
    ...integrationPolicies("gmail_grant", true),
  ],
).enableRLS();
export const gmailOauth = pgTable(
  "gmail_oauth",
  {
    ...inboxColumns(),
    mailboxId: uuid("mailbox_id").notNull(),
    generation: integer("generation").notNull(),
    policyVersion: integer("policy_version").notNull(),
    stateHash: text("state_hash").notNull(),
    verifier: text("verifier").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("gmail_oauth_state").on(t.stateHash),
    ...integrationPolicies("gmail_oauth", true),
  ],
).enableRLS();
export const gmailScopeForeignKeys = [
  new ForeignKey(
    gmailGrant,
    foreignKey({
      name: "gmail_grant_mailbox_scope",
      columns: [gmailGrant.id, gmailGrant.businessId],
      foreignColumns: [mailboxPolicy.id, mailboxPolicy.businessId],
    }),
  ),
  new ForeignKey(
    gmailOauth,
    foreignKey({
      name: "gmail_oauth_grant_scope",
      columns: [gmailOauth.mailboxId, gmailOauth.businessId],
      foreignColumns: [gmailGrant.id, gmailGrant.businessId],
    }),
  ),
];
export const gmailManualMessage = pgTable(
  "gmail_manual_message",
  {
    ...inboxColumns(),
    mailboxId: uuid("mailbox_id").notNull(),
    messageRef: text("message_ref").notNull(),
    policyVersion: integer("policy_version").notNull(),
    metadata: jsonb("metadata").$type<MailboxMetadata>().notNull(),
    content: jsonb("content").$type<MailManual | IncomingInquiry>().notNull(),
    currentMetadata: jsonb("current_metadata").$type<MailboxMetadata>(),
    fingerprint: text("fingerprint").notNull(),
    conversationId: uuid("conversation_id"),
    opportunityId: uuid("opportunity_id"),
    state: text("state")
      .$type<"pending" | "applied" | "historical">()
      .notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("gmail_manual_message_ref").on(t.mailboxId, t.messageRef),
    pgPolicy("gmail_manual_message_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("gmail_manual_message_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxWrite}) and actor_id = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("gmail_manual_message_update", {
      for: "update",
      to: appRuntime,
      using: inboxWrite,
      withCheck: inboxWrite,
    }),
  ],
).enableRLS();
export const gmailMessageScopeForeignKeys = [
  new ForeignKey(
    gmailManualMessage,
    foreignKey({
      name: "gmail_manual_mailbox_scope",
      columns: [gmailManualMessage.mailboxId, gmailManualMessage.businessId],
      foreignColumns: [mailboxPolicy.id, mailboxPolicy.businessId],
    }),
  ),
  new ForeignKey(
    gmailManualMessage,
    foreignKey({
      name: "gmail_manual_conversation_scope",
      columns: [
        gmailManualMessage.conversationId,
        gmailManualMessage.businessId,
      ],
      foreignColumns: [inboxConversation.id, inboxConversation.businessId],
    }),
  ),
  new ForeignKey(
    gmailManualMessage,
    foreignKey({
      name: "gmail_manual_opportunity_scope",
      columns: [
        gmailManualMessage.opportunityId,
        gmailManualMessage.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
];
export const googleCalendarGrant = pgTable(
  "google_calendar_grant",
  {
    ...inboxColumns(),
    generation: integer("generation").notNull(),
    status: text("status").$type<GoogleCalendarStatus>().notNull(),
    reason: text("reason"),
    accountSubject: text("account_subject"),
    accountEmail: text("account_email"),
    selectedCalendarId: text("selected_calendar_id"),
    credentials: text("credentials"),
    rejectedCredentials: text("rejected_credentials"),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("google_calendar_active_business")
      .on(t.businessId)
      .where(sql`${t.status} <> 'disconnected'`),
    uniqueIndex("google_calendar_grant_scope").on(t.id, t.businessId),
    check("google_calendar_generation", sql`${t.generation} > 0`),
    check(
      "google_calendar_status",
      sql`${t.status} in ('connecting','selection_required','ready','reconnect_required','insufficient','revocation_pending','disconnected')`,
    ),
    ...integrationPolicies("google_calendar_grant", false),
  ],
).enableRLS();
export const googleCalendarOauth = pgTable(
  "google_calendar_oauth",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    generation: integer("generation").notNull(),
    stateHash: text("state_hash").notNull(),
    verifier: text("verifier").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    returnPath: text("return_path").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("google_calendar_oauth_state").on(t.stateHash),
    ...integrationPolicies("google_calendar_oauth", true),
  ],
).enableRLS();
export const googleCalendarScopeForeignKeys = [
  new ForeignKey(
    googleCalendarOauth,
    foreignKey({
      name: "google_calendar_oauth_grant_scope",
      columns: [
        googleCalendarOauth.connectionId,
        googleCalendarOauth.businessId,
      ],
      foreignColumns: [googleCalendarGrant.id, googleCalendarGrant.businessId],
    }),
  ),
];

export const microsoftCalendarGrant = pgTable(
  "microsoft_calendar_grant",
  {
    ...inboxColumns(),
    generation: integer("generation").notNull(),
    status: text("status").$type<MicrosoftCalendarStatus>().notNull(),
    reason: text("reason"),
    accountSubject: text("account_subject"),
    accountEmail: text("account_email"),
    accountKind: text("account_kind").$type<MicrosoftIdentity["accountKind"]>(),
    tenantId: text("tenant_id"),
    selectedCalendarId: text("selected_calendar_id"),
    credentials: text("credentials"),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("microsoft_calendar_active_business")
      .on(t.businessId)
      .where(sql`${t.status} <> 'disconnected'`),
    uniqueIndex("microsoft_calendar_grant_scope").on(t.id, t.businessId),
    check("microsoft_calendar_generation", sql`${t.generation} > 0`),
    check(
      "microsoft_calendar_status",
      sql`${t.status} in ('connecting','selection_required','ready','reconnect_required','insufficient','disconnected')`,
    ),
    ...integrationPolicies("microsoft_calendar_grant", false),
  ],
).enableRLS();
export const microsoftCalendarOauth = pgTable(
  "microsoft_calendar_oauth",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    generation: integer("generation").notNull(),
    stateHash: text("state_hash").notNull(),
    verifier: text("verifier").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id")
      .notNull()
      .references(() => session.id, { onDelete: "cascade" }),
    returnPath: text("return_path").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumed: boolean("consumed").notNull().default(false),
  },
  (t) => [
    uniqueIndex("microsoft_calendar_oauth_state").on(t.stateHash),
    ...integrationPolicies("microsoft_calendar_oauth", true),
  ],
).enableRLS();
export const microsoftCalendarScopeForeignKeys = [
  new ForeignKey(
    microsoftCalendarOauth,
    foreignKey({
      name: "microsoft_calendar_oauth_grant_scope",
      columns: [
        microsoftCalendarOauth.connectionId,
        microsoftCalendarOauth.businessId,
      ],
      foreignColumns: [
        microsoftCalendarGrant.id,
        microsoftCalendarGrant.businessId,
      ],
    }),
  ),
];

export const bookingPolicy = pgTable(
  "booking_policy",
  {
    ...inboxColumns(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration")
      .$type<BookingConfiguration>()
      .notNull(),
    calendar: jsonb("calendar").$type<CalendarDescriptor>(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    note: text("note").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("booking_policy_version").on(t.businessId, t.version),
    uniqueIndex("booking_policy_scope").on(t.id, t.businessId),
    check("booking_policy_positive", sql`${t.version} > 0`),
    ...commercialPolicies("booking_policy", true),
  ],
).enableRLS();

export const appointment = pgTable(
  "appointment",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    policyId: uuid("policy_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    mode: text("mode").$type<"manual" | "automation">().notNull(),
    contextKey: text("context_key").notNull(),
    intent: jsonb("intent").$type<BookingIntent>().notNull(),
    blockedStart: timestamp("blocked_start", { withTimezone: true }).notNull(),
    blockedEnd: timestamp("blocked_end", { withTimezone: true }).notNull(),
    holdExpiresAt: timestamp("hold_expires_at", {
      withTimezone: true,
    }).notNull(),
    status: text("status").$type<AppointmentView["status"]>().notNull(),
    phase: text("phase").$type<AppointmentView["phase"]>().notNull(),
    event: jsonb("event").$type<CalendarEvent>(),
    reason: text("reason"),
    cancellation: jsonb("cancellation").$type<{
      actorId: string;
      contextKey: string;
    }>(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("appointment_request").on(t.businessId, t.requestKey),
    uniqueIndex("appointment_provider_event").on(
      t.businessId,
      sql`(${t.intent}->>'connectionId')`,
      sql`(${t.intent}->>'calendarId')`,
      sql`(${t.event}->>'eventId')`,
    ),
    uniqueIndex("appointment_scope").on(t.id, t.businessId, t.opportunityId),
    check("appointment_interval", sql`${t.blockedStart} < ${t.blockedEnd}`),
    check("appointment_mode", sql`${t.mode} in ('manual', 'automation')`),
    check(
      "appointment_status",
      sql`${t.status} in ('requested', 'confirmed', 'attended', 'cancelled')`,
    ),
    check(
      "appointment_phase",
      sql`${t.phase} in ('held', 'expired', 'blocked', 'committed', 'ambiguous', 'booked', 'conflict', 'failed', 'cancel_committed', 'cancel_ambiguous', 'finished')`,
    ),
    check(
      "appointment_confirmation_evidence",
      sql`${t.status} not in ('confirmed', 'attended') or (${t.event} is not null and ${t.event}->>'status' = 'active')`,
    ),
    ...commercialPolicies("appointment", false, true),
  ],
).enableRLS();

export const appointmentHistory = pgTable(
  "appointment_history",
  {
    ...inboxColumns(),
    opportunityId: uuid("opportunity_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    sequence: integer("sequence").notNull(),
    requestKey: uuid("request_key"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").notNull(),
    source: text("source")
      .$type<"application" | "provider" | "business">()
      .notNull(),
    reference: text("reference"),
    note: text("note").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("appointment_evidence_request").on(t.businessId, t.requestKey),
    uniqueIndex("appointment_history_sequence").on(t.appointmentId, t.sequence),
    ...commercialPolicies("appointment_history"),
  ],
).enableRLS();

export const appointmentScopeForeignKeys = [
  new ForeignKey(
    appointment,
    foreignKey({
      name: "appointment_need_scope",
      columns: [appointment.opportunityId, appointment.businessId],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    appointment,
    foreignKey({
      name: "appointment_policy_scope",
      columns: [appointment.policyId, appointment.businessId],
      foreignColumns: [bookingPolicy.id, bookingPolicy.businessId],
    }),
  ),
  new ForeignKey(
    appointmentHistory,
    foreignKey({
      name: "appointment_history_scope",
      columns: [
        appointmentHistory.appointmentId,
        appointmentHistory.businessId,
        appointmentHistory.opportunityId,
      ],
      foreignColumns: [
        appointment.id,
        appointment.businessId,
        appointment.opportunityId,
      ],
    }),
  ),
];

export const opportunityScopeForeignKeys = [
  new ForeignKey(
    callActivity,
    foreignKey({
      name: "call_activity_need_buyer_scope",
      columns: [
        callActivity.opportunityId,
        callActivity.businessId,
        callActivity.buyerId,
      ],
      foreignColumns: [
        inboxOpportunity.id,
        inboxOpportunity.businessId,
        inboxOpportunity.buyerId,
      ],
    }),
  ),
  new ForeignKey(
    callRevision,
    foreignKey({
      name: "call_revision_activity_scope",
      columns: [
        callRevision.callId,
        callRevision.businessId,
        callRevision.opportunityId,
        callRevision.buyerId,
      ],
      foreignColumns: [
        callActivity.id,
        callActivity.businessId,
        callActivity.opportunityId,
        callActivity.buyerId,
      ],
    }),
  ),
  new ForeignKey(
    rfqRequest,
    foreignKey({
      columns: [rfqRequest.opportunityId, rfqRequest.businessId],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    rfqRevision,
    foreignKey({
      columns: [
        rfqRevision.requestId,
        rfqRevision.businessId,
        rfqRevision.opportunityId,
      ],
      foreignColumns: [
        rfqRequest.id,
        rfqRequest.businessId,
        rfqRequest.opportunityId,
      ],
    }),
  ),
  new ForeignKey(
    inquiryRun,
    foreignKey({
      columns: [
        inquiryRun.messageId,
        inquiryRun.businessId,
        inquiryRun.conversationId,
      ],
      foreignColumns: [
        inboxMessage.id,
        inboxMessage.businessId,
        inboxMessage.conversationId,
      ],
    }),
  ),
  new ForeignKey(
    inquiryRun,
    foreignKey({
      columns: [inquiryRun.opportunityId, inquiryRun.businessId],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    inquiryRun,
    foreignKey({
      columns: [inquiryRun.executionId, inquiryRun.businessId],
      foreignColumns: [aiExecution.id, aiExecution.businessId],
    }),
  ),
  new ForeignKey(
    opportunityDueAction,
    foreignKey({
      columns: [
        opportunityDueAction.inquiryRunId,
        opportunityDueAction.businessId,
      ],
      foreignColumns: [inquiryRun.id, inquiryRun.businessId],
    }),
  ),
  new ForeignKey(
    opportunityControlHistory,
    foreignKey({
      columns: [
        opportunityControlHistory.opportunityId,
        opportunityControlHistory.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    opportunityManualEvent,
    foreignKey({
      columns: [
        opportunityManualEvent.connectionId,
        opportunityManualEvent.businessId,
      ],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    opportunityManualEvent,
    foreignKey({
      columns: [
        opportunityManualEvent.opportunityId,
        opportunityManualEvent.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    opportunityDueAction,
    foreignKey({
      columns: [
        opportunityDueAction.opportunityId,
        opportunityDueAction.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    opportunityDueAction,
    foreignKey({
      columns: [
        opportunityDueAction.connectionId,
        opportunityDueAction.businessId,
      ],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    opportunityDueAction,
    foreignKey({
      columns: [
        opportunityDueAction.messageId,
        opportunityDueAction.businessId,
        opportunityDueAction.conversationId,
      ],
      foreignColumns: [
        inboxMessage.id,
        inboxMessage.businessId,
        inboxMessage.conversationId,
      ],
    }),
  ),
];

// Campaign versions and Owner decisions are append-only. Approval creates no due action or outbox entry.
export const campaignRevision = pgTable(
  "campaign_revision",
  {
    ...emailRecordColumns(),
    campaignId: uuid("campaign_id").notNull(),
    version: integer("version").notNull(),
    requestKey: uuid("request_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    payloadHash: text("payload_hash").notNull(),
    snapshot: jsonb("snapshot").$type<CampaignSnapshot>().notNull(),
    sessionId: text("session_id").notNull(),
    actorName: text("actor_name").notNull(),
    note: text("note").notNull(),
  },
  (t) => [
    uniqueIndex("campaign_revision_version").on(
      t.businessId,
      t.campaignId,
      t.version,
    ),
    uniqueIndex("campaign_revision_request").on(t.businessId, t.requestKey),
    check("campaign_revision_positive", sql`${t.version} > 0`),
    ...emailRecordPolicies("campaign_revision"),
  ],
).enableRLS();
export const campaignDecision = pgTable(
  "campaign_decision",
  {
    ...emailRecordColumns(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => campaignRevision.id),
    payloadHash: text("payload_hash").notNull(),
    decision: text("decision").$type<"approved" | "rejected">().notNull(),
    sessionId: text("session_id").notNull(),
    actorName: text("actor_name").notNull(),
    role: text("role").$type<"owner">().notNull(),
    note: text("note").notNull(),
  },
  (t) => [
    uniqueIndex("campaign_decision_revision").on(t.revisionId),
    check(
      "campaign_decision_value",
      sql`${t.decision} in ('approved','rejected') and ${t.role} = 'owner'`,
    ),
    pgPolicy("campaign_decision_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("campaign_decision_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and public.current_business_role() = 'owner' and actor_id = current_setting('app.actor_id',true) and exists (select 1 from public.campaign_revision r where r.id = revision_id and r.business_id = ${t.businessId} and r.payload_hash = ${t.payloadHash})`,
    }),
  ],
).enableRLS();
