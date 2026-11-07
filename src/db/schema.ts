import type { CapacityRoute } from "../models/discovery-capacity";
import type { CapacityPolicy } from "../models/discovery-capacity";
import type { MailAcceptance } from "../models/mail-dispatch";
import type { ReconciliationEntry } from "../models/reconciliation";
import type {
  FilingPolicyDefinition,
  FilingTarget,
  FilingPolicy,
  FilingEvidence,
} from "../models/tax-filings";
import type {
  ObligationDefinition,
  ReportingPeriod,
  LiabilitySnapshot,
  LiabilityReport,
  TaxReminder,
} from "../models/tax-periods";
import type { ReachSnapshot, ReachFact } from "../models/reach-changes";
import type { DataPolicy, OffboardInput } from "../models/data-governance";
import type {
  OperationSnapshot,
  DiagnosticRetention,
} from "../models/operations";
import type {
  SubscriptionLifecycle,
  LifecycleEvent,
} from "../models/subscription-lifecycle";
import type {
  MailboxConfiguration,
  MailboxGrant,
  MailboxJobState,
  MailboxMetadata,
} from "../models/mailboxes";
import type { WorkIdentity, DiscoveryProviderCost } from "../models/discovery";
import type { CostSource, CostPlanning, CostBudget } from "../models/costs";
import type { HealthPayload } from "../models/sender-health";
import type { MetaActivity } from "../models/whatsapp-intake";
import type { MetaOutboundData } from "../models/whatsapp-sending";
import type { TaxRule, TaxCalculation } from "../models/tax";
import type {
  IssuerConfiguration,
  DocumentSnapshot,
} from "../models/seller-documents";
import type {
  PaymentSnapshot,
  CheckoutReference,
  PaymentObservation,
  PaymentAction,
} from "../models/subscription-payments";
import type { MailboxAuthorizationStatus } from "../models/mailbox-authorization";
import type { MailManual } from "../models/mail-native";
import type {
  MicrosoftCalendarStatus,
  MicrosoftIdentity,
} from "../models/microsoft-calendar";
import { sql } from "drizzle-orm";
import type {
  AdjustmentIntent,
  AdjustmentObservation,
  FinancialReceipt,
} from "../models/financial-adjustments";
import type { CampaignSnapshot } from "../models/campaigns";
import type {
  SequencePolicy,
  SequenceActionState,
  SequenceReceipt,
  SequenceEventKind,
  SequenceEnvelope,
} from "../models/email-sequences";
import type { HandoffSource } from "../models/email-handoffs";
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
import type {
  WhatsAppConfiguration,
  WhatsAppStatus,
  WhatsAppReason,
  MetaObservation,
  MetaAssets,
  MetaEvidenceReview,
  MetaEvidenceRevocation,
} from "../models/whatsapp";
import {
  bigint,
  boolean,
  bigserial,
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
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { BusinessRole, Invitation } from "../models/team";
import type { SavedConfiguration } from "../models/configuration";
import type { FileState } from "../models/files";
import type {
  BillingProfile,
  BillingRevision,
  BillingReview,
} from "../models/billing";
import type {
  SubscriptionOffer,
  SubscriptionQuote,
} from "../models/subscription-quotes";
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
import type { OpportunityMail } from "../models/opportunity-mail";
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
    pgPolicy("business_owner_read", {
      for: "select",
      to: "public",
      using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.business'::regclass)`,
    }),
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
const pricingOperatorScope = sql`exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.pricing)`;
export const subscriptionPricingRevision = pgTable(
  "subscription_pricing_revision",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    offers: jsonb("offers").$type<SubscriptionOffer[]>().notNull(),
    note: text("note").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("subscription_pricing_version").on(t.version),
    check(
      "subscription_pricing_version_positive",
      sql`${t.version} > 0 and ${t.effectiveFrom} >= ${t.at}`,
    ),
    pgPolicy("subscription_pricing_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${pricingOperatorScope}) or public.current_business_role() in ('owner','admin')`,
    }),
    pgPolicy("subscription_pricing_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${pricingOperatorScope}) and ${t.actorId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

const taxOperatorScope = sql`exists (select 1 from public.platform_operator o where o.user_id = current_setting('app.actor_id', true) and o.tax)`;
const billingOperatorScope = sql`current_setting('app.billing_review', true) = 'true' and (${taxOperatorScope})`;
const taxRuleReadScope = sql`(${billingOperatorScope}) or (current_setting('app.tax_calculation', true) = 'true' and public.current_business_role() in ('owner','admin'))`;
export const taxRuleRevision = pgTable(
  "tax_rule_revision",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    rule: jsonb("rule").$type<TaxRule>().notNull(),
    note: text("note").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("tax_rule_key_version").on(table.key, table.version),
    check("tax_rule_version_positive", sql`${table.version}>0`),
    pgPolicy("tax_rule_read", {
      for: "select",
      to: appRuntime,
      using: taxRuleReadScope,
    }),
    pgPolicy("tax_rule_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${billingOperatorScope}) and ${table.actorId}=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const taxRuleDecision = pgTable(
  "tax_rule_decision",
  {
    id: uuid("id").primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => taxRuleRevision.id),
    version: integer("version").notNull(),
    outcome: text("outcome").$type<"approved" | "withdrawn">().notNull(),
    note: text("note").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("tax_decision_revision_version").on(
      table.revisionId,
      table.version,
    ),
    check("tax_decision_version_positive", sql`${table.version}>0`),
    check(
      "tax_decision_outcome",
      sql`${table.outcome} in ('approved','withdrawn')`,
    ),
    pgPolicy("tax_decision_read", {
      for: "select",
      to: appRuntime,
      using: taxRuleReadScope,
    }),
    pgPolicy("tax_decision_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${billingOperatorScope}) and ${table.actorId}=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const taxCalculation = pgTable(
  "tax_calculation",
  {
    version: integer("version").notNull(),
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    requestKey: uuid("request_key").notNull(),
    resolvesId: uuid("resolves_id"),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    snapshot: jsonb("snapshot").$type<TaxCalculation>().notNull(),
  },
  (table) => [
    uniqueIndex("tax_calculation_business_version").on(
      table.businessId,
      table.version,
    ),
    check("tax_calculation_version_positive", sql`${table.version}>0`),
    uniqueIndex("tax_calculation_request").on(
      table.businessId,
      table.requestKey,
    ),
    uniqueIndex("tax_calculation_resolution").on(table.resolvesId),
    uniqueIndex("tax_calculation_business_id").on(table.businessId, table.id),
    check(
      "tax_calculation_snapshot_scope",
      sql`${table.snapshot}->>'id'=${table.id}::text and ${table.snapshot}->>'businessId'=${table.businessId}::text and ${table.snapshot}->>'actorId'=${table.actorId} and ${table.snapshot}->>'requestKey'=${table.requestKey}::text`,
    ),
    pgPolicy("tax_calculation_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${managerScope}) or (${billingOperatorScope})`,
    }),
    pgPolicy("tax_calculation_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`((${managerScope}) or (${billingOperatorScope})) and ${table.businessId}=nullif(current_setting('app.business_id',true),'')::uuid and ${table.actorId}=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const taxScopeForeignKeys = [
  new ForeignKey(
    taxCalculation,
    foreignKey({
      name: "tax_calculation_resolution_scope",
      columns: [taxCalculation.businessId, taxCalculation.resolvesId],
      foreignColumns: [taxCalculation.businessId, taxCalculation.id],
    }),
  ),
];
export const billingProfileRevision = pgTable(
  "billing_profile_revision",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    version: integer("version").notNull(),
    profile: jsonb("profile").$type<BillingProfile>().notNull(),
    evidence: jsonb("evidence").$type<BillingRevision["evidence"]>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  (table) => [
    uniqueIndex("billing_profile_business_version").on(
      table.businessId,
      table.version,
    ),
    check("billing_profile_version_positive", sql`${table.version} > 0`),
    pgPolicy("billing_profile_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${managerScope}) or (${billingOperatorScope})`,
    }),
    pgPolicy("billing_profile_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope}) and ${table.actorId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

export const billingProfileReview = pgTable(
  "billing_profile_review",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => billingProfileRevision.id),
    profileVersion: integer("profile_version").notNull(),
    version: integer("version").notNull(),
    outcome: text("outcome").$type<BillingReview["outcome"]>().notNull(),
    findings: jsonb("findings").$type<string[]>().notNull(),
    note: text("note").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("billing_review_business_version").on(
      table.businessId,
      table.version,
    ),
    check(
      "billing_review_version_positive",
      sql`${table.version} > 0 and ${table.profileVersion} > 0`,
    ),
    check(
      "billing_review_outcome",
      sql`${table.outcome} in ('reviewed','missing','conflicting')`,
    ),
    pgPolicy("billing_review_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${managerScope}) or (${billingOperatorScope})`,
    }),
    pgPolicy("billing_review_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${billingOperatorScope}) and ${table.actorId} = current_setting('app.actor_id', true)
        and ${table.businessId} = nullif(current_setting('app.business_id', true), '')::uuid
        and exists (select 1 from public.billing_profile_revision p where p.id = ${table.profileId} and p.business_id = ${table.businessId} and p.version = ${table.profileVersion})`,
    }),
  ],
).enableRLS();

export const subscriptionQuote = pgTable(
  "subscription_quote",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    requestKey: uuid("request_key").notNull(),
    pricingId: uuid("pricing_id")
      .notNull()
      .references(() => subscriptionPricingRevision.id),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => billingProfileRevision.id),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => billingProfileReview.id),
    snapshot: jsonb("snapshot").$type<SubscriptionQuote>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("subscription_quote_request_once").on(
      t.businessId,
      t.requestKey,
    ),
    unique("subscription_quote_scope").on(t.id, t.businessId),
    pgPolicy("subscription_quote_read", {
      for: "select",
      to: appRuntime,
      using: managerScope,
    }),
    pgPolicy("subscription_quote_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope}) and ${t.actorId} = current_setting('app.actor_id', true)
    and exists (select 1 from public.billing_profile_revision p join public.billing_profile_review r on r.profile_id=p.id and r.business_id=p.business_id where p.id=${t.profileId} and p.business_id=${t.businessId} and r.id=${t.reviewId} and r.outcome='reviewed')
    and ${t.snapshot}->>'businessId'=${t.businessId}::text and ${t.snapshot}->>'id'=${t.id}::text`,
    }),
  ],
).enableRLS();

const refundOperator = sql`exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.refunds)`;
const paymentOperator = sql`exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)`;
const paymentOwner = sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.subscription_payment'::regclass)`;
function paymentHistoryPolicies(name: string, action: ReturnType<typeof sql>) {
  const scope = sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid`;
  const worker = sql`public.payment_worker_authorized(${action},business_id)`;
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: sql`(${paymentOperator}) ${name === "subscription_period" ? sql`or exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and (o.documents or o.refunds))` : sql``} or ((${scope}) and (public.current_business_role() in ('owner','admin') or (${worker})))`,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${scope}) and (${worker})`,
    }),
    pgPolicy(`${name}_system`, {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ];
}
export const subscriptionPayment = pgTable(
  "subscription_payment",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    requestKey: uuid("request_key").notNull(),
    operationKey: uuid("operation_key").notNull(),
    recoveryKey: uuid("recovery_key").notNull(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => subscriptionQuote.id),
    snapshot: jsonb("snapshot").$type<PaymentSnapshot>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    state: text("state").$type<PaymentAction["state"]>().notNull(),
    started: boolean("started").notNull().default(false),
    reason: text("reason"),
    checkout: jsonb("checkout").$type<CheckoutReference>(),
    observation: jsonb("observation").$type<PaymentObservation>(),
    recovery: jsonb("recovery").$type<PaymentAction["recovery"]>(),
    lifecycle: jsonb("lifecycle").$type<SubscriptionLifecycle>(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciliationPending: boolean("reconciliation_pending")
      .notNull()
      .default(false),
  },
  (t) => [
    uniqueIndex("subscription_payment_request").on(t.businessId, t.requestKey),
    uniqueIndex("subscription_payment_operation").on(t.operationKey),
    unique("subscription_payment_scope").on(t.id, t.businessId),
    check(
      "subscription_payment_snapshot_scope",
      sql`${t.snapshot}->'quote'->>'businessId'=${t.businessId}::text and ${t.snapshot}->'quote'->>'id'=${t.quoteId}::text`,
    ),
    pgPolicy("subscription_payment_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${paymentOperator}) or (${managerScope}) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.payment_worker_authorized(id,business_id))`,
    }),
    pgPolicy("subscription_payment_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`((${managerScope}) and ${t.actorId}=current_setting('app.actor_id',true) and exists(select 1 from public.subscription_quote q where q.id=${t.quoteId} and q.business_id=${t.businessId})) or public.reach_payment_insert(${t.id},${t.businessId},${t.snapshot},${t.actorId})`,
    }),
    pgPolicy("subscription_payment_update", {
      for: "update",
      to: appRuntime,
      using: sql`(${managerScope}) or public.payment_worker_authorized(id,business_id)`,
      withCheck: sql`(${managerScope}) or public.payment_worker_authorized(id,business_id)`,
    }),
    pgPolicy("subscription_payment_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();
export const subscriptionLifecycleEvent = pgTable(
  "subscription_lifecycle_event",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    actionId: uuid("action_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    actorId: text("actor_id").references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    lifecycle: jsonb("lifecycle").$type<SubscriptionLifecycle>().notNull(),
    notice: jsonb("notice").$type<LifecycleEvent["notice"]>(),
  },
  (t) => [
    uniqueIndex("subscription_lifecycle_event_identity").on(t.actionId, t.key),
    ...paymentHistoryPolicies(
      "subscription_lifecycle_event",
      sql`${t.actionId}`,
    ),
  ],
).enableRLS();
export const subscriptionPaymentEvent = pgTable(
  "subscription_payment_event",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id"),
    actionId: uuid("action_id"),
    provider: text("provider").notNull(),
    account: text("account").notNull(),
    eventId: text("event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    observation: jsonb("observation").$type<PaymentObservation>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("subscription_payment_event_identity").on(
      t.provider,
      t.account,
      t.eventId,
    ),
    check(
      "subscription_payment_event_optional_scope",
      sql`(${t.businessId} is null)=(${t.actionId} is null)`,
    ),
    ...paymentHistoryPolicies("subscription_payment_event", sql`${t.actionId}`),
  ],
).enableRLS();
export const subscriptionPaymentHistory = pgTable(
  "subscription_payment_history",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    actionId: uuid("action_id").notNull(),
    kind: text("kind").notNull(),
    actorId: text("actor_id").references(() => user.id),
    detail: jsonb("detail")
      .$type<{
        state: PaymentAction["state"];
        reason: string | null;
        observation: PaymentObservation | null;
      }>()
      .notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    ...paymentHistoryPolicies(
      "subscription_payment_history",
      sql`${t.actionId}`,
    ),
  ],
).enableRLS();
export const subscriptionPeriod = pgTable(
  "subscription_period",
  {
    id: uuid("id").primaryKey(),
    actionId: uuid("action_id").notNull(),
    businessId: uuid("business_id").notNull(),
    provider: text("provider").notNull(),
    account: text("account").notNull(),
    paymentId: text("payment_id").notNull(),
    start: timestamp("start", { withTimezone: true }).notNull(),
    end: timestamp("end", { withTimezone: true }).notNull(),
    snapshot: jsonb("snapshot").$type<PaymentSnapshot>().notNull(),
    charge: jsonb("charge").$type<PaymentObservation>(),
  },
  (t) => [
    uniqueIndex("subscription_period_window_once").on(
      t.actionId,
      t.start,
      t.end,
    ),
    uniqueIndex("subscription_period_payment_once").on(
      t.provider,
      t.account,
      t.paymentId,
    ),
    unique("subscription_period_scope").on(t.id, t.businessId),
    check("subscription_period_window", sql`${t.end}>${t.start}`),
    ...paymentHistoryPolicies("subscription_period", sql`${t.actionId}`),
  ],
).enableRLS();
export const subscriptionUsage = pgTable(
  "subscription_usage",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    periodId: uuid("period_id").notNull(),
    kind: text("kind").$type<"discovery" | "automation">().notNull(),
    operationId: uuid("operation_id").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("subscription_usage_operation").on(
      t.businessId,
      t.kind,
      t.operationId,
    ),
    check("subscription_usage_positive", sql`${t.quantity}>0`),
    pgPolicy("subscription_usage_read", {
      for: "select",
      to: appRuntime,
      using: sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null`,
    }),
    pgPolicy("subscription_usage_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null`,
    }),
  ],
).enableRLS();

const reachOperator = sql`exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.reconciliation)`;
const reachWorker = sql`public.reach_worker_authorized(id,business_id)`;
export const reachChange = pgTable(
  "reach_change",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    periodId: uuid("period_id").notNull(),
    actionId: uuid("action_id").notNull(),
    quoteId: uuid("quote_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    recoveryKey: uuid("recovery_key").notNull(),
    snapshot: jsonb("snapshot").$type<ReachSnapshot>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("reach_change_scope").on(t.id, t.businessId),
    uniqueIndex("reach_change_request").on(t.businessId, t.requestKey),
    check(
      "reach_change_snapshot_scope",
      sql`${t.snapshot}->'original'->>'id'=${t.periodId}::text and ${t.snapshot}->'original'->>'businessId'=${t.businessId}::text and ${t.snapshot}->'action'->>'id'=${t.actionId}::text and ${t.snapshot}->'target'->'quote'->>'id'=${t.quoteId}::text`,
    ),
    pgPolicy("reach_change_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${managerScope}) or (${reachOperator}) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and (${reachWorker}))`,
    }),
    pgPolicy("reach_change_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${managerScope}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const reachChangeEvent = pgTable(
  "reach_change_event",
  {
    position: bigserial("position", { mode: "number" }).notNull(),
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    changeId: uuid("change_id").notNull(),
    key: text("key").notNull(),
    actorId: text("actor_id").references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    fact: jsonb("fact").$type<ReachFact>().notNull(),
  },
  (t) => [
    uniqueIndex("reach_change_event_identity").on(t.changeId, t.key),
    uniqueIndex("reach_change_request_identity")
      .on(t.businessId, t.key)
      .where(sql`${t.key} like 'request:%'`),
    pgPolicy("reach_change_event_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${managerScope}) or (${reachOperator}) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.reach_worker_authorized(change_id,business_id))`,
    }),
    pgPolicy("reach_change_event_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.reach_worker_authorized(change_id,business_id) or (((${managerScope}) or (${reachOperator})) and actor_id=current_setting('app.actor_id',true)))`,
    }),
  ],
).enableRLS();
export const reachChangeScopeForeignKeys = [
  new ForeignKey(
    reachChange,
    foreignKey({
      name: "reach_change_period_scope",
      columns: [reachChange.periodId, reachChange.businessId],
      foreignColumns: [subscriptionPeriod.id, subscriptionPeriod.businessId],
    }),
  ),
  new ForeignKey(
    reachChange,
    foreignKey({
      name: "reach_change_action_scope",
      columns: [reachChange.actionId, reachChange.businessId],
      foreignColumns: [subscriptionPayment.id, subscriptionPayment.businessId],
    }),
  ),
  new ForeignKey(
    reachChange,
    foreignKey({
      name: "reach_change_quote_scope",
      columns: [reachChange.quoteId, reachChange.businessId],
      foreignColumns: [subscriptionQuote.id, subscriptionQuote.businessId],
    }),
  ),
  new ForeignKey(
    reachChangeEvent,
    foreignKey({
      name: "reach_change_event_scope",
      columns: [reachChangeEvent.changeId, reachChangeEvent.businessId],
      foreignColumns: [reachChange.id, reachChange.businessId],
    }),
  ),
];

// Reconcile these composite keys after the pinned push replaces referenced
// UNIQUE constraints, while financial runtime access remains paused.
export const subscriptionPaymentScopeForeignKeys = [
  new ForeignKey(
    subscriptionLifecycleEvent,
    foreignKey({
      name: "subscription_lifecycle_event_scope",
      columns: [
        subscriptionLifecycleEvent.actionId,
        subscriptionLifecycleEvent.businessId,
      ],
      foreignColumns: [subscriptionPayment.id, subscriptionPayment.businessId],
    }),
  ),
  new ForeignKey(
    subscriptionPaymentEvent,
    foreignKey({
      name: "subscription_payment_event_scope",
      columns: [
        subscriptionPaymentEvent.actionId,
        subscriptionPaymentEvent.businessId,
      ],
      foreignColumns: [subscriptionPayment.id, subscriptionPayment.businessId],
    }),
  ),
  new ForeignKey(
    subscriptionPaymentHistory,
    foreignKey({
      name: "subscription_payment_history_scope",
      columns: [
        subscriptionPaymentHistory.actionId,
        subscriptionPaymentHistory.businessId,
      ],
      foreignColumns: [subscriptionPayment.id, subscriptionPayment.businessId],
    }),
  ),
  new ForeignKey(
    subscriptionPeriod,
    foreignKey({
      name: "subscription_period_action_scope",
      columns: [subscriptionPeriod.actionId, subscriptionPeriod.businessId],
      foreignColumns: [subscriptionPayment.id, subscriptionPayment.businessId],
    }),
  ),
  new ForeignKey(
    subscriptionUsage,
    foreignKey({
      name: "subscription_usage_period_scope",
      columns: [subscriptionUsage.periodId, subscriptionUsage.businessId],
      foreignColumns: [subscriptionPeriod.id, subscriptionPeriod.businessId],
    }),
  ),
];

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
    refunds: boolean("refunds").notNull().default(false),
    ai: boolean("ai").notNull().default(false),
    discovery: boolean("discovery").notNull().default(false),
    emailPolicy: boolean("email_policy").notNull().default(false),
    pricing: boolean("pricing").notNull().default(false),
    whatsAppReview: boolean("whatsapp_review").notNull().default(false),
    senderHealth: boolean("sender_health").notNull().default(false),
    documents: boolean("documents").notNull().default(false),
    operations: boolean("operations").notNull().default(false),
    recovery: boolean("recovery").notNull().default(false),
    costs: boolean("costs").notNull().default(false),
    notifications: boolean("notifications").notNull().default(false),
  },
  (table) => [
    pgPolicy("operator_owner_read", {
      for: "select",
      to: "public",
      using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.platform_operator'::regclass)`,
    }),
    pgPolicy("operator_read", {
      for: "select",
      to: appRuntime,
      using: sql`${table.userId} = current_setting('app.actor_id', true)`,
    }),
  ],
).enableRLS();

const operationsOperator = sql`exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.operations)`;
const operationsScope = sql`(${operationsOperator}) or (business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() is not null)`;
const operationsOwner = sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.operation_event'::regclass)`;
export const operationEvent = pgTable(
  "operation_event",
  {
    id: uuid("id").primaryKey(),
    position: bigserial("position", { mode: "number" }).notNull(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    source: text("source").notNull(),
    targetId: uuid("target_id").notNull(),
    snapshot: jsonb("snapshot").$type<OperationSnapshot>().notNull(),
    actorId: text("actor_id").references(() => user.id),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    requestKey: uuid("request_key"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("operation_request_once").on(
      t.businessId,
      t.requestKey,
      t.outcome,
    ),
    index("operation_source_history").on(
      t.businessId,
      t.source,
      t.targetId,
      t.position,
    ),
    check(
      "operation_snapshot_scope",
      sql`${t.snapshot}->>'businessId'=${t.businessId}::text and ${t.snapshot}->>'targetId'=${t.targetId}::text and ${t.snapshot}->>'source'=${t.source}`,
    ),
    pgPolicy("operation_event_read", {
      for: "select",
      to: appRuntime,
      using: operationsScope,
    }),
    pgPolicy("operation_event_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${operationsScope}) and actor_id=current_setting('app.actor_id',true) and action in ('retry','reconcile','escalate','acknowledge') and outcome in ('requested','queued','checked','escalated','acknowledged','blocked','unavailable')`,
    }),
    pgPolicy("operation_event_system", {
      for: "all",
      to: "public",
      using: operationsOwner,
      withCheck: operationsOwner,
    }),
  ],
).enableRLS();
export const operationRetention = pgTable(
  "operation_retention",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull(),
    policy: jsonb("policy").$type<DiagnosticRetention>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("operation_retention_version").on(t.version),
    check(
      "operation_retention_positive",
      sql`${t.version}>0 and (${t.policy}->>'diagnosticSeconds')::integer>0 and (${t.policy}->>'auditDetailSeconds')::integer>0`,
    ),
    pgPolicy("operation_retention_read", {
      for: "select",
      to: appRuntime,
      using: operationsOperator,
    }),
    pgPolicy("operation_retention_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${operationsOperator}) and actor_id=current_setting('app.actor_id',true)`,
    }),
    pgPolicy("operation_retention_system", {
      for: "select",
      to: "public",
      using: operationsOwner,
    }),
  ],
).enableRLS();
export const operationDetail = pgTable(
  "operation_detail",
  {
    id: uuid("id").primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => operationEvent.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => operationRetention.id),
    kind: text("kind").$type<"diagnostic" | "audit">().notNull(),
    requestId: uuid("request_id").notNull(),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("operation_detail_once").on(t.eventId, t.kind),
    pgPolicy("operation_detail_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${operationsOperator}) and expires_at>statement_timestamp()`,
    }),
    pgPolicy("operation_detail_system", {
      for: "all",
      to: "public",
      using: operationsOwner,
      withCheck: operationsOwner,
    }),
    check(
      "operation_detail_kind",
      sql`${t.kind} in ('diagnostic','audit') and ${t.code} ~ '^[A-Z_]{1,80}$'`,
    ),
  ],
).enableRLS();

const documentOperator = sql`exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.documents)`;
// All access goes through bounded definer commands. Runtime cannot read private
// payloads or author acceptance/status facts by inserting into these ledgers.
const notificationPolicies = (prefix: string) => [
  pgPolicy(`${prefix}_read`, {
    for: "select",
    to: appRuntime,
    using: sql`false`,
  }),
  pgPolicy(`${prefix}_insert`, {
    for: "insert",
    to: appRuntime,
    withCheck: sql`false`,
  }),
];
export const notificationPreference = pgTable(
  "notification_preference",
  {
    id: uuid("id").primaryKey(),
    account: text("account").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    businessId: uuid("business_id").references(() => business.id),
    purpose: text("purpose").notNull(),
    enabled: boolean("enabled").notNull(),
    version: integer("version").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => notificationPolicies("notification_preference"),
).enableRLS();
export const notificationTerms = pgTable(
  "notification_terms",
  {
    id: uuid("id").primaryKey(),
    account: text("account").notNull(),
    terms: jsonb("terms")
      .$type<import("../models/notifications").NotificationTerms>()
      .notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    authBootstrap: boolean("auth_bootstrap").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => notificationPolicies("notification_terms"),
).enableRLS();
export const notificationSetup = pgTable(
  "notification_setup",
  {
    id: uuid("id").primaryKey(),
    account: text("account").notNull(),
    binding: jsonb("binding").notNull(),
    setup:
      jsonb("setup").$type<
        import("../models/notifications").NotificationSetup
      >(),
    capability: uuid("capability").notNull().defaultRandom(),
    actorId: text("actor_id").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => notificationPolicies("notification_setup"),
).enableRLS();
export const notificationNotice = pgTable(
  "notification_notice",
  {
    id: uuid("id").primaryKey(),
    account: text("account").notNull(),
    purpose: text("purpose")
      .$type<import("../models/notifications").NoticePurpose>()
      .notNull(),
    sourceId: text("source_id").notNull(),
    sourceStage: text("source_stage").notNull(),
    businessId: uuid("business_id").references(() => business.id),
    actorId: text("actor_id"),
    authority: text("authority").notNull(),
    authUserId: text("auth_user_id"),
    recipientDigest: text("recipient_digest"),
    capability: uuid("capability").notNull(),
    key: text("key").notNull(),
    keyRef: text("key_ref").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state").notNull().default("pending"),
    uncertain: boolean("uncertain").notNull().default(false),
    priorUncertain: boolean("prior_uncertain").notNull().default(false),
    providerId: text("provider_id"),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    retryUntil: timestamp("retry_until", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lease: uuid("lease"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    binding: jsonb("binding").notNull(),
    terms: jsonb("terms"),
    reason: text("reason").notNull().default("pending"),
  },
  (t) => [
    uniqueIndex("notification_source_identity").on(
      t.account,
      t.purpose,
      t.sourceId,
    ),
    uniqueIndex("notification_provider_identity").on(t.account, t.providerId),
    check(
      "notification_purpose",
      sql`${t.purpose} in ('authentication','invitation','cost_alert','sender_health','handoff','operations','subscription','tax_period')`,
    ),
    check(
      "notification_state",
      sql`${t.state} in ('pending','sending','accepted','uncertain','rate_limited','rejected','held','expired')`,
    ),
    ...notificationPolicies("notification_notice"),
  ],
).enableRLS();
export const notificationPayload = pgTable(
  "notification_payload",
  {
    noticeId: uuid("notice_id")
      .primaryKey()
      .references(() => notificationNotice.id),
    sealed: text("sealed").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  () => notificationPolicies("notification_payload"),
).enableRLS();
export const notificationEvent = pgTable(
  "notification_event",
  {
    id: uuid("id").primaryKey(),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notificationNotice.id),
    kind: text("kind").notNull(),
    lease: uuid("lease"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => notificationPolicies("notification_event"),
).enableRLS();
export const notificationReceipt = pgTable(
  "notification_receipt",
  {
    id: uuid("id").primaryKey(),
    account: text("account").notNull(),
    eventId: text("event_id").notNull(),
    providerId: text("provider_id").notNull(),
    stage: text("stage").notNull(),
    rawHash: text("raw_hash").notNull(),
    recipientDigest: text("recipient_digest").notNull(),
    senderDigest: text("sender_digest").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_receipt_identity").on(t.account, t.eventId),
    ...notificationPolicies("notification_receipt"),
  ],
).enableRLS();
const costOperator = sql`nullif(current_setting('app.business_id',true),'') is null and nullif(current_setting('app.cost_budget',true),'') is null and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.costs)`;
const costRead = sql`(${costOperator}) or public.cost_worker_authorized(month)`;
export const costRecord = pgTable(
  "operator_cost_record",
  {
    id: uuid("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    version: integer("version").notNull(),
    month: text("month").notNull(),
    origin: text("origin").$type<"native" | "operator">().notNull(),
    source: jsonb("source").$type<CostSource>().notNull(),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("operator_cost_source_version").on(t.sourceId, t.version),
    check(
      "operator_cost_bounds",
      sql`${t.version}>0 and ${t.source}->>'month'=${t.month} and ${t.origin} in ('native','operator') and ${t.retainUntil}>${t.at}`,
    ),
    pgPolicy("operator_cost_record_read", {
      for: "select",
      to: appRuntime,
      using: costRead,
    }),
    pgPolicy("operator_cost_record_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`((${costOperator}) or (origin='native' and public.cost_worker_authorized(month))) and actor_id=current_setting('app.actor_id',true) and public.cost_attribution_valid(source->>'businessId',source->>'runId')`,
    }),
  ],
).enableRLS();
export const costPlanningRevision = pgTable(
  "operator_cost_planning",
  {
    id: uuid("id").primaryKey(),
    month: text("month").notNull(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration").$type<CostPlanning>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("operator_cost_planning_version").on(t.month, t.version),
    check(
      "operator_cost_planning_bounds",
      sql`${t.version}>0 and ${t.configuration}->>'month'=${t.month} and ${t.retainUntil}>${t.at}`,
    ),
    pgPolicy("operator_cost_planning_read", {
      for: "select",
      to: appRuntime,
      using: costRead,
    }),
    pgPolicy("operator_cost_planning_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${costOperator}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const costScan = pgTable(
  "operator_cost_scan",
  {
    id: uuid("id").primaryKey(),
    month: text("month").notNull(),
    sourceCount: integer("source_count").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy("operator_cost_scan_read", {
      for: "select",
      to: appRuntime,
      using: costRead,
    }),
    pgPolicy("operator_cost_scan_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${costRead}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const costBudgetRevision = pgTable(
  "operator_cost_budget",
  {
    id: uuid("id").primaryKey(),
    month: text("month").notNull(),
    category: text("category").notNull(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration").$type<CostBudget>().notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    workerKey: uuid("worker_key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("operator_cost_budget_version").on(
      t.month,
      t.category,
      t.version,
    ),
    check(
      "operator_cost_budget_bounds",
      sql`${t.version}>0 and ${t.configuration}->>'month'=${t.month} and ${t.configuration}->>'category'=${t.category} and ${t.configuration}->>'ownerId'=${t.ownerId} and ${t.retainUntil}>${t.at}`,
    ),
    pgPolicy("operator_cost_budget_read", {
      for: "select",
      to: appRuntime,
      using: costRead,
    }),
    pgPolicy("operator_cost_budget_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${costOperator}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const costAlert = pgTable(
  "operator_cost_alert",
  {
    id: uuid("id").primaryKey(),
    month: text("month").notNull(),
    category: text("category").notNull(),
    threshold: integer("threshold").notNull(),
    measure: text("measure").$type<"actual" | "forecast">().notNull(),
    budgetId: uuid("budget_id")
      .notNull()
      .references(() => costBudgetRevision.id),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id),
    valueMicros: text("value_micros").notNull(),
    limitMicros: text("limit_micros").notNull(),
    summary: text("summary").notNull(),
    email: text("email"),
    emailState: text("email_state")
      .$type<
        "in_app" | "pending" | "sending" | "accepted" | "uncertain" | "held"
      >()
      .notNull(),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    leaseUntil: timestamp("lease_until", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseKey: uuid("lease_key"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("operator_cost_threshold_once").on(
      t.month,
      t.category,
      t.threshold,
      t.measure,
    ),
    pgPolicy("operator_cost_alert_read", {
      for: "select",
      to: appRuntime,
      using: costRead,
    }),
    pgPolicy("operator_cost_alert_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${costRead}) and exists(select 1 from public.operator_cost_budget b where b.id=${t.budgetId} and b.month=${t.month} and b.category=${t.category} and b.owner_id=${t.ownerId})`,
    }),
  ],
).enableRLS();
export const costNotificationEvent = pgTable(
  "operator_cost_notification_event",
  {
    id: uuid("id").primaryKey(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => costAlert.id),
    kind: text("kind")
      .$type<"sending" | "accepted" | "uncertain" | "held" | "acknowledged">()
      .notNull(),
    detail: text("detail").notNull(),
    actorId: text("actor_id").references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy("operator_cost_notification_event_read", {
      for: "select",
      to: appRuntime,
      using: sql`exists(select 1 from public.operator_cost_alert a where a.id=${t.alertId})`,
    }),
    pgPolicy("operator_cost_notification_event_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${costOperator}) and actor_id=current_setting('app.actor_id',true) and kind='acknowledged' and exists(select 1 from public.operator_cost_alert a where a.id=${t.alertId})`,
    }),
  ],
).enableRLS();
const documentScope = sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and (public.current_business_role() in ('owner','admin') or (${documentOperator}))`;
const documentWorker = sql`public.seller_artifact_worker_authorized(id,business_id)`;
export const issuerRevision = pgTable(
  "seller_issuer_revision",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration")
      .$type<IssuerConfiguration>()
      .notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  (t) => [
    uniqueIndex("seller_issuer_version").on(t.version),
    pgPolicy("seller_issuer_revision_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${documentOperator}) or public.current_business_role() in ('owner','admin')`,
    }),
    pgPolicy("seller_issuer_revision_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${documentOperator}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const issuerDecision = pgTable(
  "seller_issuer_decision",
  {
    id: uuid("id").primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => issuerRevision.id),
    version: integer("version").notNull(),
    outcome: text("outcome").$type<"approved" | "withdrawn">().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    note: text("note").notNull(),
  },
  (t) => [
    uniqueIndex("seller_issuer_decision_version").on(t.revisionId, t.version),
    pgPolicy("seller_issuer_decision_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${documentOperator}) or public.current_business_role() in ('owner','admin')`,
    }),
    pgPolicy("seller_issuer_decision_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${documentOperator}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();

export const sellerDocument = pgTable(
  "seller_document",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    periodId: uuid("period_id").notNull(),
    originalId: uuid("original_id"),
    adjustmentId: uuid("adjustment_id"),
    adjustmentSource: text("adjustment_source"),
    recoveryKey: uuid("recovery_key").notNull(),
    retryAfter: timestamp("retry_after", { withTimezone: true })
      .notNull()
      .defaultNow(),
    kind: text("kind").$type<"invoice" | "credit_note">().notNull(),
    seriesKey: text("series_key").notNull(),
    ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
    number: text("number").notNull(),
    snapshot: jsonb("snapshot").$type<DocumentSnapshot>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
    accountScope: text("account_scope").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    artifactState: text("artifact_state")
      .$type<"pending" | "ready" | "failed">()
      .notNull(),
    failure: text("failure"),
  },
  (t) => [
    unique("seller_document_scope").on(t.id, t.businessId),
    uniqueIndex("seller_document_number").on(t.number),
    uniqueIndex("seller_document_series_ordinal").on(t.seriesKey, t.ordinal),
    uniqueIndex("seller_document_invoice_once")
      .on(t.periodId)
      .where(sql`${t.kind}='invoice'`),
    uniqueIndex("seller_document_adjustment_once").on(
      t.businessId,
      t.adjustmentId,
    ),
    uniqueIndex("seller_document_adjustment_source_once").on(
      t.originalId,
      t.adjustmentSource,
    ),
    check(
      "seller_document_binding",
      sql`${t.snapshot}->'source'->>'periodId'=${t.periodId}::text and ((${t.kind}='invoice' and ${t.originalId} is null) or (${t.kind}='credit_note' and ${t.originalId} is not null))`,
    ),
    pgPolicy("seller_document_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${documentScope}) or (${documentWorker}) or ((${refundOperator}) and business_id=nullif(current_setting('app.business_id',true),'')::uuid)`,
    }),
    pgPolicy("seller_document_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${documentScope}) and actor_id=current_setting('app.actor_id',true) and (kind='invoice' or (${documentOperator}))`,
    }),
    pgPolicy("seller_document_update", {
      for: "update",
      to: appRuntime,
      using: sql`(${documentScope}) or (${documentWorker})`,
      withCheck: sql`(${documentScope}) or (${documentWorker})`,
    }),
    pgPolicy("seller_document_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();
export const sellerDocumentRequest = pgTable(
  "seller_document_request",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    documentId: uuid("document_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("seller_document_request_once").on(t.businessId, t.requestKey),
    pgPolicy("seller_document_request_read", {
      for: "select",
      to: appRuntime,
      using: documentScope,
    }),
    pgPolicy("seller_document_request_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${documentScope}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const sellerDocumentScopeForeignKeys = [
  new ForeignKey(
    sellerDocument,
    foreignKey({
      name: "seller_document_period_scope",
      columns: [sellerDocument.periodId, sellerDocument.businessId],
      foreignColumns: [subscriptionPeriod.id, subscriptionPeriod.businessId],
    }),
  ),
  new ForeignKey(
    sellerDocument,
    foreignKey({
      name: "seller_document_original_scope",
      columns: [sellerDocument.originalId, sellerDocument.businessId],
      foreignColumns: [sellerDocument.id, sellerDocument.businessId],
    }),
  ),
  new ForeignKey(
    sellerDocumentRequest,
    foreignKey({
      name: "seller_document_request_scope",
      columns: [
        sellerDocumentRequest.documentId,
        sellerDocumentRequest.businessId,
      ],
      foreignColumns: [sellerDocument.id, sellerDocument.businessId],
    }),
  ),
];
export const sellerDocumentAccess = pgTable(
  "seller_document_access",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    documentId: uuid("document_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("seller_document_access_hash").on(t.tokenHash),
    pgPolicy("seller_document_access_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${documentScope}) and actor_id=current_setting('app.actor_id',true)`,
    }),
    pgPolicy("seller_document_access_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${documentScope}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();
export const sellerDocumentStorage = pgTable(
  "seller_document_storage",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    documentId: uuid("document_id").notNull(),
    actorId: text("actor_id").references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    action: text("action").$type<"put" | "get">().notNull(),
    outcome: text("outcome").$type<"uncertain" | "confirmed">().notNull(),
  },
  () => [
    pgPolicy("seller_document_storage_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${documentScope}) or public.seller_artifact_worker_authorized(document_id,business_id)`,
    }),
    pgPolicy("seller_document_storage_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`((${documentScope}) and actor_id=current_setting('app.actor_id',true)) or (actor_id is null and public.seller_artifact_worker_authorized(document_id,business_id))`,
    }),
    pgPolicy("seller_document_storage_update", {
      for: "update",
      to: appRuntime,
      using: sql`(${documentScope}) or public.seller_artifact_worker_authorized(document_id,business_id)`,
      withCheck: sql`(${documentScope}) or public.seller_artifact_worker_authorized(document_id,business_id)`,
    }),
  ],
).enableRLS();
sellerDocumentScopeForeignKeys.push(
  new ForeignKey(
    sellerDocumentAccess,
    foreignKey({
      name: "seller_document_access_scope",
      columns: [
        sellerDocumentAccess.documentId,
        sellerDocumentAccess.businessId,
      ],
      foreignColumns: [sellerDocument.id, sellerDocument.businessId],
    }),
  ),
  new ForeignKey(
    sellerDocumentStorage,
    foreignKey({
      name: "seller_document_storage_scope",
      columns: [
        sellerDocumentStorage.documentId,
        sellerDocumentStorage.businessId,
      ],
      foreignColumns: [sellerDocument.id, sellerDocument.businessId],
    }),
  ),
);

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

const fileBusinessScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and (public.current_business_role() is not null or (${billingOperatorScope}))`;
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
    purpose: text("purpose")
      .$type<"general" | "billing">()
      .notNull()
      .default("general"),
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
      "business_file_purpose",
      sql`${table.purpose} in ('general', 'billing')`,
    ),
    check(
      "business_file_state",
      sql`${table.state} in ('pending','uploading','ready','failed','deleting','deleted')`,
    ),
    pgPolicy("file_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${fileBusinessScope}) and ((${table.purpose} = 'general' and public.current_business_role() is not null) or (${table.purpose} = 'billing' and (public.current_business_role() in ('owner','admin') or (${billingOperatorScope}))))`,
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
      using: sql`(${fileBusinessScope}) and ${table.actorId} = current_setting('app.actor_id', true) and exists (select 1 from public.business_file f where f.id = ${table.fileId} and f.business_id = ${table.businessId})`,
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
      using: sql`(${fileBusinessScope}) and exists (select 1 from public.business_file f where f.id = ${table.fileId} and f.business_id = ${table.businessId})`,
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

const capacityOperator = sql`coalesce(current_setting('app.business_id',true),'')='' and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id',true) and o.discovery)`;
export const discoveryCapacityPolicy = pgTable(
  "discovery_capacity_policy",
  {
    id: uuid("id").primaryKey(),
    version: integer("version").notNull().unique(),
    requestKey: uuid("request_key").notNull().unique(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    policy: jsonb("policy").$type<CapacityPolicy>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  () => [
    pgPolicy("discovery_capacity_policy_owner_read", {
      for: "select",
      to: "public",
      using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.discovery_capacity_policy'::regclass)`,
    }),
    pgPolicy("discovery_capacity_policy_read", {
      for: "select",
      to: appRuntime,
      using: capacityOperator,
    }),
    pgPolicy("discovery_capacity_policy_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: capacityOperator,
    }),
  ],
).enableRLS();

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

export const discoveryCapacityBinding = pgTable(
  "discovery_capacity_binding",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => discoveryRun.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => discoveryCapacityPolicy.id),
    route: jsonb("route").$type<CapacityRoute>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  () => [
    pgPolicy("discovery_capacity_binding_owner_read", {
      for: "select",
      to: "public",
      using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid='public.discovery_capacity_binding'::regclass)`,
    }),
    pgPolicy("discovery_capacity_binding_read", {
      for: "select",
      to: appRuntime,
      using: discoveryScope,
    }),
    pgPolicy("discovery_capacity_binding_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: discoveryWrite,
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
    providerCost: jsonb("provider_cost").$type<DiscoveryProviderCost>(),
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
      using: [
        "sender_identity",
        "sender_connection",
        "sender_reply_route",
        "mailbox_policy",
      ].includes(name)
        ? sql`(${inboxScope}) or (business_id = nullif(current_setting('app.business_id', true), '')::uuid and exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health))`
        : inboxScope,
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

const senderHealthOperator = sql`exists(select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.sender_health)`;
export const senderHealthRecord = pgTable(
  "sender_health_record",
  {
    position: bigserial("position", { mode: "number" }).notNull(),
    ...inboxColumns(),
    identityId: uuid("identity_id").notNull(),
    kind: text("kind").$type<HealthPayload["kind"]>().notNull(),
    eventKey: text("event_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    payload: jsonb("payload").$type<HealthPayload>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("sender_health_record_scope").on(t.id, t.businessId),
    uniqueIndex("sender_health_record_event").on(
      t.businessId,
      t.identityId,
      t.kind,
      t.eventKey,
    ),
    check(
      "sender_health_record_kind",
      sql`${t.kind} in ('policy','evidence','incident','failure','repair','alert','acknowledgement') and ${t.kind}=${t.payload}->>'kind'`,
    ),
    pgPolicy("sender_health_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${inboxScope} and (${t.kind}<>'alert' or ${t.payload}->>'audience'='business')) or ${senderHealthOperator}`,
    }),
    pgPolicy("sender_health_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`${t.businessId}=nullif(current_setting('app.business_id', true),'')::uuid and ${t.actorId}=current_setting('app.actor_id',true) and (${senderHealthOperator} or (public.current_business_role() is not null and ${t.kind} in ('incident','failure','alert','acknowledgement')))`,
    }),
  ],
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
      .$type<"normalized_import" | "mailbox" | "meta">()
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
    stage: text("stage").$type<"inquiry" | "prospect">().notNull(),
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
    check("inbox_initial_stage", sql`${table.stage} in ('inquiry','prospect')`),
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
    nativeSyncGeneration: integer("native_sync_generation"),
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
    senderHealthRecord,
    foreignKey({
      name: "sender_health_identity_scope",
      columns: [senderHealthRecord.identityId, senderHealthRecord.businessId],
      foreignColumns: [senderIdentity.id, senderIdentity.businessId],
    }),
  ),
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
    messageId: uuid("message_id"),
    connectionId: uuid("connection_id").notNull(),
    conversationId: uuid("conversation_id"),
    whatsappPlanId: uuid("whatsapp_plan_id"),
    whatsappStep: integer("whatsapp_step"),
    whatsappPeer: text("whatsapp_peer"),
    metaRecoveryAt: timestamp("meta_recovery_at", { withTimezone: true }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    controlVersion: integer("control_version").notNull(),
    associationVersion: integer("association_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    inquiryRunId: uuid("inquiry_run_id"),
    email: jsonb("email").$type<OpportunityMail>(),
    evaluation: jsonb("evaluation").$type<
      QueueOpportunityAction["evaluation"] | null
    >(),
    state: text("state").$type<DueAction["state"]>().notNull(),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("opportunity_due_action_scope").on(t.id, t.businessId),
    uniqueIndex("whatsapp_plan_action").on(
      t.whatsappPlanId,
      t.whatsappPeer,
      t.whatsappStep,
    ),
    check(
      "opportunity_action_origin",
      sql`(${t.whatsappPlanId} IS NULL AND ${t.whatsappStep} IS NULL AND ${t.whatsappPeer} IS NULL AND ${t.messageId} IS NOT NULL AND ${t.conversationId} IS NOT NULL) OR (${t.whatsappPlanId} IS NOT NULL AND ${t.whatsappStep} IS NOT NULL AND ${t.whatsappPeer} IS NOT NULL AND ${t.whatsappStep}>=0 AND ${t.whatsappPeer} ~ '^[1-9][0-9]{6,14}$' AND ${t.messageId} IS NULL AND ${t.conversationId} IS NULL AND ${t.inquiryRunId} IS NULL)`,
    ),
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
const whatsAppReviewer = sql`exists (select 1 from public.platform_operator o where o.user_id=current_setting('app.actor_id', true) and o.whatsapp_review)`;
function metaIntakePolicies(name: string) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: inboxWrite,
    }),
    pgPolicy(`${name}_update`, {
      for: "update",
      to: appRuntime,
      using: inboxWrite,
      withCheck: inboxWrite,
    }),
  ];
}
export const whatsAppOutbound = pgTable(
  "whatsapp_outbound",
  {
    ...inboxColumns(),
    position: bigserial("position", { mode: "number" }).notNull(),
    connectionId: uuid("connection_id").notNull(),
    key: text("key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<MetaOutboundData>().notNull(),
  },
  (t) => [
    uniqueIndex("whatsapp_outbound_scope").on(t.id, t.businessId),
    uniqueIndex("whatsapp_outbound_key").on(t.businessId, t.key),
    pgPolicy("whatsapp_outbound_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("whatsapp_outbound_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and ${t.actorId}=current_setting('app.actor_id',true) and (${t.data}->>'kind' NOT IN ('decision','permission','revoke_permission','template','cancel_plan','estimate') OR public.current_business_role() IN ('owner','admin')) and (${t.data}->>'kind'<>'decision' OR public.current_business_role()='owner')`,
    }),
  ],
).enableRLS();
export const whatsAppIntake = pgTable(
  "whatsapp_intake",
  {
    ...inboxColumns(),
    connectionVersion: integer("connection_version").notNull(),
    accountKey: text("account_key").notNull(),
    inboxConnectionId: uuid("inbox_connection_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull(),
    receiptRetentionSeconds: integer("receipt_retention_seconds").notNull(),
    inboundAt: timestamp("inbound_at", { withTimezone: true }),
    echoAt: timestamp("echo_at", { withTimezone: true }),
    gap: text("gap"),
  },
  (t) => [
    uniqueIndex("whatsapp_intake_scope").on(t.id, t.businessId),
    check(
      "whatsapp_intake_bounds",
      sql`${t.connectionVersion}>0 and ${t.receiptRetentionSeconds}>=60`,
    ),
    ...metaIntakePolicies("whatsapp_intake"),
  ],
).enableRLS();
export const whatsAppReceipt = pgTable(
  "whatsapp_receipt",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    connectionVersion: integer("connection_version").notNull(),
    accountKey: text("account_key").notNull(),
    eventKey: text("event_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    activity: jsonb("activity").$type<MetaActivity>(),
    kind: text("kind").notNull(),
    messageRef: text("message_ref"),
    peer: text("peer"),
    replyTo: text("reply_to"),
    status: text("provider_status"),
    statusEvidence:
      jsonb("status_evidence").$type<MetaActivity["statusEvidence"]>(),
    state: text("state")
      .$type<"pending" | "processed" | "historical" | "review" | "expired">()
      .notNull(),
    conversationId: uuid("conversation_id"),
    opportunityId: uuid("opportunity_id"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("whatsapp_receipt_identity").on(
      t.connectionId,
      t.accountKey,
      t.eventKey,
    ),
    check(
      "whatsapp_receipt_state",
      sql`${t.state} in ('pending','processed','historical','review','expired') and ${t.kind} in ('incoming','app_echo','status','gap') and ${t.connectionVersion}>0`,
    ),
    ...metaIntakePolicies("whatsapp_receipt"),
  ],
).enableRLS();
const whatsAppEvidenceScope = sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid and ((${inboxWrite}) or (${whatsAppReviewer}))`;
export const whatsAppConnection = pgTable(
  "whatsapp_connection",
  {
    ...inboxColumns(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration")
      .$type<WhatsAppConfiguration>()
      .notNull(),
    status: text("status").$type<WhatsAppStatus>().notNull(),
    reason: text("reason").$type<WhatsAppReason>(),
    termsActorId: text("terms_actor_id")
      .notNull()
      .references(() => user.id),
    termsAcceptedAt: timestamp("terms_accepted_at", {
      withTimezone: true,
    }).notNull(),
    credentials: text("credentials"),
    providerKey: text("provider_key"),
    observation: jsonb("observation").$type<MetaObservation>(),
    operationId: uuid("operation_id"),
    assets: jsonb("assets").$type<MetaAssets>(),
    coexistenceFinished: boolean("coexistence_finished")
      .notNull()
      .default(false),
    phoneNumberId: text("phone_number_id"),
  },
  (t) => [
    uniqueIndex("whatsapp_business").on(t.businessId),
    uniqueIndex("whatsapp_connection_scope").on(t.id, t.businessId),
    uniqueIndex("whatsapp_number_exclusive").on(t.phoneNumberId),
    check("whatsapp_version", sql`${t.version} > 0`),
    pgPolicy("whatsapp_connection_read", {
      for: "select",
      to: appRuntime,
      using: whatsAppEvidenceScope,
    }),
    pgPolicy("whatsapp_connection_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxWrite}) and terms_actor_id = current_setting('app.actor_id', true)`,
    }),
    pgPolicy("whatsapp_connection_update", {
      for: "update",
      to: appRuntime,
      using: inboxWrite,
      withCheck: inboxWrite,
    }),
  ],
).enableRLS();
export const whatsAppIntakeScopeForeignKeys = [
  new ForeignKey(
    whatsAppReceipt,
    foreignKey({
      name: "whatsapp_receipt_conversation_scope",
      columns: [whatsAppReceipt.conversationId, whatsAppReceipt.businessId],
      foreignColumns: [inboxConversation.id, inboxConversation.businessId],
    }),
  ),
  new ForeignKey(
    whatsAppReceipt,
    foreignKey({
      name: "whatsapp_receipt_opportunity_scope",
      columns: [whatsAppReceipt.opportunityId, whatsAppReceipt.businessId],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),

  new ForeignKey(
    whatsAppIntake,
    foreignKey({
      name: "whatsapp_intake_connection_scope",
      columns: [whatsAppIntake.id, whatsAppIntake.businessId],
      foreignColumns: [whatsAppConnection.id, whatsAppConnection.businessId],
    }),
  ),
  new ForeignKey(
    whatsAppIntake,
    foreignKey({
      name: "whatsapp_intake_inbox_scope",
      columns: [whatsAppIntake.inboxConnectionId, whatsAppIntake.businessId],
      foreignColumns: [inboxConnection.id, inboxConnection.businessId],
    }),
  ),
  new ForeignKey(
    whatsAppReceipt,
    foreignKey({
      name: "whatsapp_receipt_connection_scope",
      columns: [whatsAppReceipt.connectionId, whatsAppReceipt.businessId],
      foreignColumns: [whatsAppIntake.id, whatsAppIntake.businessId],
    }),
  ),
];
export const whatsAppOauth = pgTable(
  "whatsapp_oauth",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    version: integer("version").notNull(),
    stateHash: text("state_hash").notNull(),
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
    uniqueIndex("whatsapp_oauth_state").on(t.stateHash),
    ...integrationPolicies("whatsapp_oauth", true),
  ],
).enableRLS();
export const whatsAppEvent = pgTable(
  "whatsapp_event",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    terms: jsonb("terms").$type<WhatsAppConfiguration>(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  () =>
    integrationPolicies("whatsapp_event", true).filter(
      (p) => p.for !== "update",
    ),
).enableRLS();
export const whatsAppEvidence = pgTable(
  "whatsapp_evidence",
  {
    ...inboxColumns(),
    connectionId: uuid("connection_id").notNull(),
    version: integer("version").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    review: jsonb("review").$type<MetaEvidenceReview>(),
    revocation: jsonb("revocation").$type<MetaEvidenceRevocation>(),
  },
  (t) => [
    uniqueIndex("whatsapp_evidence_version").on(t.businessId, t.version),
    check(
      "whatsapp_evidence_decision",
      sql`(${t.review} is null) <> (${t.revocation} is null)`,
    ),
    check("whatsapp_evidence_positive_version", sql`${t.version} > 0`),
    pgPolicy("whatsapp_evidence_read", {
      for: "select",
      to: appRuntime,
      using: whatsAppEvidenceScope,
    }),
    pgPolicy("whatsapp_evidence_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`business_id = nullif(current_setting('app.business_id', true), '')::uuid
        and (${whatsAppReviewer}) and actor_id=current_setting('app.actor_id', true)
        and not exists (select 1 from public.membership m where m.business_id=whatsapp_evidence.business_id and m.user_id=current_setting('app.actor_id', true))
        and exists (select 1 from public.session s join public."user" u on u.id=s.user_id join public.two_factor f on f.user_id=u.id
          where s.id=whatsapp_evidence.session_id and s.user_id=current_setting('app.actor_id', true)
            and s.expires_at>whatsapp_evidence.at and u.two_factor_enabled and f.verified
            and s.mfa_verified_at<=whatsapp_evidence.at and s.mfa_verified_at>whatsapp_evidence.at-interval '15 minutes'
            and s.mfa_factor_id=f.id and s.mfa_factor_version=encode(sha256(convert_to(f.secret,'UTF8')),'hex'))`,
    }),
  ],
).enableRLS();
export const whatsAppScopeForeignKeys = [
  new ForeignKey(
    whatsAppOutbound,
    foreignKey({
      name: "whatsapp_outbound_connection_scope",
      columns: [whatsAppOutbound.connectionId, whatsAppOutbound.businessId],
      foreignColumns: [whatsAppConnection.id, whatsAppConnection.businessId],
    }),
  ),
  new ForeignKey(
    opportunityDueAction,
    foreignKey({
      name: "whatsapp_action_plan_scope",
      columns: [
        opportunityDueAction.whatsappPlanId,
        opportunityDueAction.businessId,
      ],
      foreignColumns: [whatsAppOutbound.id, whatsAppOutbound.businessId],
    }),
  ),
  new ForeignKey(
    whatsAppEvidence,
    foreignKey({
      name: "whatsapp_evidence_connection_scope",
      columns: [whatsAppEvidence.connectionId, whatsAppEvidence.businessId],
      foreignColumns: [whatsAppConnection.id, whatsAppConnection.businessId],
    }),
  ),
  new ForeignKey(
    whatsAppOauth,
    foreignKey({
      name: "whatsapp_oauth_connection_scope",
      columns: [whatsAppOauth.connectionId, whatsAppOauth.businessId],
      foreignColumns: [whatsAppConnection.id, whatsAppConnection.businessId],
    }),
  ),
  new ForeignKey(
    whatsAppEvent,
    foreignKey({
      name: "whatsapp_event_connection_scope",
      columns: [whatsAppEvent.connectionId, whatsAppEvent.businessId],
      foreignColumns: [whatsAppConnection.id, whatsAppConnection.businessId],
    }),
  ),
];
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
    nativeSyncGeneration: integer("native_sync_generation"),
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

export const emailHandoff = pgTable(
  "email_handoff",
  {
    ...emailRecordColumns(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => campaignRevision.id),
    payloadHash: text("payload_hash").notNull(),
    contactId: text("contact_id").notNull(),
  },
  (t) => [
    uniqueIndex("email_handoff_recipient").on(t.revisionId, t.contactId),
    pgPolicy("email_handoff_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("email_handoff_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and actor_id = current_setting('app.actor_id',true) and exists (select 1 from public.campaign_revision r join public.campaign_decision d on d.revision_id=r.id and d.business_id=r.business_id where r.id=${t.revisionId} and r.business_id=${t.businessId} and r.payload_hash=${t.payloadHash} and d.decision='approved')`,
    }),
  ],
).enableRLS();
export const emailHandoffEvidence = pgTable(
  "email_handoff_evidence",
  {
    ...emailRecordColumns(),
    handoffId: uuid("handoff_id")
      .notNull()
      .references(() => emailHandoff.id),
    kind: text("kind")
      .$type<
        | "prepared"
        | "user_marked_sent"
        | "sent_folder_observed"
        | "reply_observed"
      >()
      .notNull(),
    sourceKey: text("source_key").notNull(),
    source: jsonb("source").$type<HandoffSource>(),
  },
  (t) => [
    uniqueIndex("email_handoff_evidence_once").on(
      t.handoffId,
      t.kind,
      t.sourceKey,
    ),
    uniqueIndex("email_handoff_native_once")
      .on(t.businessId, t.sourceKey)
      .where(sql`${t.source} is not null`),
    check(
      "email_handoff_evidence_kind",
      sql`(${t.kind} in ('prepared','user_marked_sent') and ${t.source} is null) or (${t.kind} in ('sent_folder_observed','reply_observed') and ${t.source} is not null)`,
    ),
    pgPolicy("email_handoff_evidence_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("email_handoff_evidence_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and actor_id = current_setting('app.actor_id',true) and (${t.source} is null or public.current_business_role() in ('owner','admin')) and exists (select 1 from public.email_handoff h where h.id=${t.handoffId} and h.business_id=${t.businessId})`,
    }),
  ],
).enableRLS();

export const emailSequencePolicy = pgTable(
  "email_sequence_policy",
  {
    ...emailRecordColumns(),
    version: integer("version").notNull(),
    configuration: jsonb("configuration").$type<SequencePolicy>().notNull(),
  },
  (t) => [
    uniqueIndex("email_sequence_policy_version").on(t.businessId, t.version),
    pgPolicy("email_sequence_policy_read", {
      for: "select",
      to: appRuntime,
      using: inboxScope,
    }),
    pgPolicy("email_sequence_policy_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${inboxScope}) and (${emailPolicyOperator}) and actor_id=current_setting('app.actor_id',true)`,
    }),
  ],
).enableRLS();

export const emailSequenceRun = pgTable(
  "email_sequence_run",
  {
    ...emailRecordColumns(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => campaignRevision.id),
    payloadHash: text("payload_hash").notNull(),
    identity: jsonb("identity").$type<WorkIdentity>().notNull(),
    state: text("state")
      .$type<"active" | "paused" | "cancelled" | "completed">()
      .notNull(),
    version: integer("version").notNull(),
    reason: text("reason"),
  },
  (t) => [
    uniqueIndex("email_sequence_run_revision").on(t.revisionId),
    uniqueIndex("email_sequence_run_scope").on(t.id, t.businessId),
    ...emailRecordPolicies("email_sequence_run"),
    pgPolicy("email_sequence_run_update", {
      for: "update",
      to: appRuntime,
      using: inboxScope,
      withCheck: inboxScope,
    }),
    pgPolicy("email_sequence_run_system", {
      for: "select",
      to: "public",
      using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.email_sequence_run'::regclass)`,
    }),
  ],
).enableRLS();

export const emailSequenceAction = pgTable(
  "email_sequence_action",
  {
    ...emailRecordColumns(),
    runId: uuid("run_id").notNull(),
    contactId: text("contact_id").notNull(),
    opportunityId: uuid("opportunity_id").notNull(),
    stepIndex: integer("step_index").notNull(),
    identity: jsonb("identity").$type<WorkIdentity>().notNull(),
    controlVersion: integer("control_version").notNull(),
    state: text("state").$type<SequenceActionState>().notNull(),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    generation: integer("generation").notNull(),
    key: uuid("execution_key").notNull(),
    recoveryAt: timestamp("recovery_at", { withTimezone: true }),
    attemptId: uuid("attempt_id"),
    receipt: jsonb("receipt").$type<SequenceReceipt>(),
    processingAcceptance: jsonb(
      "processing_acceptance",
    ).$type<MailAcceptance>(),
    queueState: text("queue_state")
      .$type<"none" | "pending" | "enqueued" | "failed">()
      .notNull(),
    queueRunId: text("queue_run_id"),
  },
  (t) => [
    uniqueIndex("email_sequence_action_step").on(
      t.runId,
      t.contactId,
      t.stepIndex,
    ),
    uniqueIndex("email_sequence_action_scope").on(t.id, t.businessId, t.runId),
    check(
      "email_sequence_action_bounds",
      sql`${t.stepIndex}>=0 and ${t.generation}>0`,
    ),
    ...emailRecordPolicies("email_sequence_action"),
    pgPolicy("email_sequence_action_update", {
      for: "update",
      to: appRuntime,
      using: inboxScope,
      withCheck: inboxScope,
    }),
    pgPolicy("email_sequence_action_system", {
      for: "all",
      to: "public",
      using: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.email_sequence_action'::regclass)`,
      withCheck: sql`current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.email_sequence_action'::regclass)`,
    }),
  ],
).enableRLS();

export const emailSequenceEvent = pgTable(
  "email_sequence_event",
  {
    ...emailRecordColumns(),
    runId: uuid("run_id").notNull(),
    actionId: uuid("action_id"),
    kind: text("kind").$type<SequenceEventKind>().notNull(),
    reason: text("reason"),
    source: jsonb("source").$type<HandoffSource>(),
    note: text("note"),
    attemptId: uuid("attempt_id"),
    envelope: jsonb("envelope").$type<SequenceEnvelope>(),
    receipt: jsonb("receipt").$type<SequenceReceipt>(),
    processingAcceptance: jsonb(
      "processing_acceptance",
    ).$type<MailAcceptance>(),
  },
  (t) => [
    uniqueIndex("email_sequence_reservation_once")
      .on(t.attemptId)
      .where(sql`${t.kind}='attempt_reserved'`),
    ...emailRecordPolicies("email_sequence_event"),
  ],
).enableRLS();

export const emailSequenceScopeForeignKeys = [
  new ForeignKey(
    emailSequenceAction,
    foreignKey({
      name: "email_sequence_action_run",
      columns: [emailSequenceAction.runId, emailSequenceAction.businessId],
      foreignColumns: [emailSequenceRun.id, emailSequenceRun.businessId],
    }),
  ),
  new ForeignKey(
    emailSequenceAction,
    foreignKey({
      name: "email_sequence_action_opportunity",
      columns: [
        emailSequenceAction.opportunityId,
        emailSequenceAction.businessId,
      ],
      foreignColumns: [inboxOpportunity.id, inboxOpportunity.businessId],
    }),
  ),
  new ForeignKey(
    emailSequenceEvent,
    foreignKey({
      name: "email_sequence_event_run",
      columns: [emailSequenceEvent.runId, emailSequenceEvent.businessId],
      foreignColumns: [emailSequenceRun.id, emailSequenceRun.businessId],
    }),
  ),
  new ForeignKey(
    emailSequenceEvent,
    foreignKey({
      name: "email_sequence_event_action",
      columns: [
        emailSequenceEvent.actionId,
        emailSequenceEvent.businessId,
        emailSequenceEvent.runId,
      ],
      foreignColumns: [
        emailSequenceAction.id,
        emailSequenceAction.businessId,
        emailSequenceAction.runId,
      ],
    }),
  ),
];

// Customer exports are deliberately separate from private uploads and seller artifacts.
const dataScope = sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.current_business_role() in ('owner','admin')`;
const dataOwner = sql`current_user=(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.business_data_request'::regclass)`;
function dataPolicies(name: string, insert = true) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: dataScope,
    }),
    ...(insert
      ? [
          pgPolicy(`${name}_insert`, {
            for: "insert",
            to: appRuntime,
            withCheck: sql`(${dataScope}) and actor_id=current_setting('app.actor_id',true)`,
          }),
        ]
      : []),
    pgPolicy(`${name}_system`, {
      for: "all",
      to: "public",
      using: dataOwner,
      withCheck: dataOwner,
    }),
  ];
}
export const businessDataRequest = pgTable(
  "business_data_request",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    requestKey: uuid("request_key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").$type<"offboard" | "reopen">().notNull(),
    policy: jsonb("policy").$type<DataPolicy>().notNull(),
    input: jsonb("input").$type<OffboardInput | null>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("business_data_request_key").on(t.businessId, t.requestKey),
    uniqueIndex("business_data_request_scope").on(t.id, t.businessId),
    check(
      "business_data_request_policy",
      sql`${t.kind} in ('offboard','reopen') and ${t.policy}->'businessIds' ? ${t.businessId}::text and (${t.policy}->>'version')::integer>0 and (${t.policy}->>'effectiveUntil')::timestamptz>(${t.policy}->>'effectiveFrom')::timestamptz`,
    ),
    ...dataPolicies("business_data_request"),
  ],
).enableRLS();
export const businessDataExport = pgTable(
  "business_data_export",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    requestKey: uuid("request_key").notNull(),
    part: integer("part").notNull().default(1),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    policy: jsonb("policy").$type<DataPolicy>().notNull(),
    state: text("state")
      .$type<"pending" | "ready" | "deleting" | "deleted">()
      .notNull(),
    bytes: integer("bytes"),
    sha256: text("sha256"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    cleanupDueAt: timestamp("cleanup_due_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    cleanupAttempts: integer("cleanup_attempts").notNull().default(0),
    cleanupLease: uuid("cleanup_lease"),
  },
  (t) => [
    uniqueIndex("business_data_export_key").on(t.businessId, t.requestKey),
    uniqueIndex("business_data_export_scope").on(t.id, t.businessId),
    check(
      "business_data_export_state",
      sql`${t.state} in ('pending','ready','deleting','deleted') and ${t.part}>0 and ${t.part}<=1000000 and ${t.cleanupAttempts}>=0 and (${t.state}<>'ready' or (${t.bytes}>0 and ${t.sha256} ~ '^[a-f0-9]{64}$'))`,
    ),
    ...dataPolicies("business_data_export"),
    pgPolicy("business_data_export_update", {
      for: "update",
      to: appRuntime,
      using: sql`(${dataScope}) and actor_id=current_setting('app.actor_id',true)`,
      withCheck: dataScope,
    }),
  ],
).enableRLS();
export const businessDataGrant = pgTable(
  "business_data_grant",
  {
    tokenHash: text("token_hash").primaryKey(),
    businessId: uuid("business_id").notNull(),
    exportId: uuid("export_id").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  () => [
    ...dataPolicies("business_data_grant"),
    pgPolicy("business_data_grant_update", {
      for: "update",
      to: appRuntime,
      using: sql`(${dataScope}) and actor_id=current_setting('app.actor_id',true)`,
      withCheck: dataScope,
    }),
  ],
).enableRLS();
export const businessDataStep = pgTable(
  "business_data_step",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    requestId: uuid("request_id").notNull(),
    kind: text("kind").notNull(),
    targetId: text("target_id").notNull(),
    details: jsonb("details").$type<Record<string, string>>().notNull(),
    secret: jsonb("secret").$type<{
      credentials: string | null;
      rejected: string | null;
    }>(),
    state: text("state").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lease: uuid("lease"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    outcome: text("outcome"),
    tokenWiped: boolean("token_wiped").notNull().default(false),
  },
  (t) => [
    uniqueIndex("business_data_step_target").on(
      t.requestId,
      t.kind,
      t.targetId,
    ),
    uniqueIndex("business_data_step_scope").on(t.id, t.businessId),
    check(
      "business_data_step_state",
      sql`${t.state} in ('pending','working','retry','complete','incomplete') and ${t.attempts}>=0 and ${t.kind} in ('local','gmail','google_calendar','microsoft_mail','microsoft_calendar','meta','file')`,
    ),
    ...dataPolicies("business_data_step", false),
  ],
).enableRLS();
export const businessDataEvent = pgTable(
  "business_data_event",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    stepId: uuid("step_id").notNull(),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome").notNull(),
    actorId: text("actor_id").references(() => user.id),
    evidence: text("evidence"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [...dataPolicies("business_data_event", false)],
).enableRLS();
export const businessDataScopeForeignKeys = [
  new ForeignKey(
    businessDataGrant,
    foreignKey({
      name: "business_data_grant_export_scope",
      columns: [businessDataGrant.exportId, businessDataGrant.businessId],
      foreignColumns: [businessDataExport.id, businessDataExport.businessId],
    }),
  ),
  new ForeignKey(
    businessDataStep,
    foreignKey({
      name: "business_data_step_request_scope",
      columns: [businessDataStep.requestId, businessDataStep.businessId],
      foreignColumns: [businessDataRequest.id, businessDataRequest.businessId],
    }),
  ),
  new ForeignKey(
    businessDataEvent,
    foreignKey({
      name: "business_data_event_step_scope",
      columns: [businessDataEvent.stepId, businessDataEvent.businessId],
      foreignColumns: [businessDataStep.id, businessDataStep.businessId],
    }),
  ),
];
// Financial intents and native facts are append-only. Recovery tokens grant reads/events,
// never creation of another refund or seller document.
const financialWorker = sql`public.financial_worker_authorized(case_id,business_id)`;
export const financialCase = pgTable(
  "financial_case",
  {
    id: uuid("id").primaryKey(),
    position: bigserial("position", { mode: "number" }).notNull(),
    businessId: uuid("business_id").notNull(),
    periodId: uuid("period_id").notNull(),
    invoiceId: uuid("invoice_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    recoveryKey: uuid("recovery_key").notNull(),
    kind: text("kind").$type<"refund" | "dispute">().notNull(),
    nativeDisputeId: text("native_dispute_id"),
    intent: jsonb("intent").$type<AdjustmentIntent>().notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("financial_case_scope").on(t.id, t.businessId),
    uniqueIndex("financial_case_request").on(t.businessId, t.requestKey),
    uniqueIndex("financial_case_dispute").on(
      t.nativeDisputeId,
      sql`(${t.intent}->'period'->'snapshot'->'provider'->>'account')`,
    ),
    check(
      "financial_case_binding",
      sql`${t.intent}->'invoice'->>'id'=${t.invoiceId}::text and ${t.intent}->'period'->>'id'=${t.periodId}::text and ${t.intent}->'period'->>'businessId'=${t.businessId}::text and ${t.intent}->'input'->>'kind'=${t.kind}
        and ${t.intent}->>'key'=${t.id}::text and ${t.intent}->'input'->>'invoiceId'=${t.invoiceId}::text and ${t.intent}->'input'->>'requestKey'=${t.requestKey}::text
        and ${t.intent}->'invoice'->>'periodId'=${t.periodId}::text and ${t.intent}->'invoice'->>'businessId'=${t.businessId}::text
        and ${t.intent}->'invoice'->'snapshot'->'source'->>'paymentId'=${t.intent}->'period'->>'paymentId'
        and ((${t.kind}='refund' and ${t.nativeDisputeId} is null) or (${t.kind}='dispute' and ${t.nativeDisputeId}=${t.intent}->'input'->>'disputeId'))`,
    ),
    pgPolicy("financial_case_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${refundOperator}) or public.financial_worker_authorized(id,business_id)`,
    }),
    pgPolicy("financial_case_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${refundOperator}) and business_id=nullif(current_setting('app.business_id',true),'')::uuid and actor_id=current_setting('app.actor_id',true)`,
    }),
    pgPolicy("financial_case_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();
export const financialCaseEvent = pgTable(
  "financial_case_event",
  {
    id: uuid("id").primaryKey(),
    position: bigserial("position", { mode: "number" }).notNull(),
    caseId: uuid("case_id").notNull(),
    businessId: uuid("business_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    detail: jsonb("detail")
      .$type<{
        observation?: AdjustmentObservation;
        access?: "preserve" | "block_period";
        documentId?: string;
        skip?: number;
        [key: string]: unknown;
      }>()
      .notNull(),
    actorId: text("actor_id").references(() => user.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("financial_case_event_once").on(t.caseId, t.key),
    check(
      "financial_case_event_access",
      sql`not (${t.detail} ? 'access') or ${t.detail}->>'access' in ('preserve','block_period')`,
    ),
    pgPolicy("financial_case_event_read", {
      for: "select",
      to: appRuntime,
      using: sql`(${refundOperator}) or (${financialWorker})`,
    }),
    pgPolicy("financial_case_event_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and (((${refundOperator}) and actor_id=current_setting('app.actor_id',true)) or (${financialWorker}))`,
    }),
    pgPolicy("financial_case_event_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();
export const financialCaseScopeForeignKeys = [
  new ForeignKey(
    financialCase,
    foreignKey({
      name: "financial_case_period_scope",
      columns: [financialCase.periodId, financialCase.businessId],
      foreignColumns: [subscriptionPeriod.id, subscriptionPeriod.businessId],
    }),
  ),
  new ForeignKey(
    financialCase,
    foreignKey({
      name: "financial_case_invoice_scope",
      columns: [financialCase.invoiceId, financialCase.businessId],
      foreignColumns: [sellerDocument.id, sellerDocument.businessId],
    }),
  ),
  new ForeignKey(
    financialCaseEvent,
    foreignKey({
      name: "financial_case_event_scope",
      columns: [financialCaseEvent.caseId, financialCaseEvent.businessId],
      foreignColumns: [financialCase.id, financialCase.businessId],
    }),
  ),
];
export const financialReceipt = pgTable(
  "financial_receipt",
  {
    id: uuid("id").primaryKey(),
    account: text("account").notNull(),
    mode: text("mode").notNull(),
    eventId: text("event_id").notNull(),
    receipt: jsonb("receipt").$type<FinancialReceipt>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("financial_receipt_once").on(t.account, t.mode, t.eventId),
    check(
      "financial_receipt_binding",
      sql`${t.receipt}->>'eventId'=${t.eventId} and ${t.receipt}->>'account'=${t.account} and ${t.receipt}->>'mode'=${t.mode}`,
    ),
    pgPolicy("financial_receipt_read", {
      for: "select",
      to: appRuntime,
      using: refundOperator,
    }),
    pgPolicy("financial_receipt_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();

const recoveryScope = sql`business_id=nullif(current_setting('app.business_id',true),'')::uuid and public.recovery_operator_authorized()`;
const recoveryOwner = sql`current_user=(select pg_get_userbyid(relowner) from pg_class where oid='public.infrastructure_recovery'::regclass)`;
export const infrastructureRecovery = pgTable(
  "infrastructure_recovery",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    sessionId: text("session_id").notNull(),
    authorizedSessionId: text("authorized_session_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    plan: jsonb("plan").notNull(),
    planHash: text("plan_hash").notNull(),
    stage: text("stage").notNull().default("requested"),
    lease: uuid("lease"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("recovery_business_scope").on(t.id, t.businessId),
    unique("recovery_request_once").on(t.requestKey),
    uniqueIndex("recovery_plan_once").on(sql`(${t.plan}->>'id')`),
    check(
      "recovery_plan_scope",
      sql`${t.plan}->>'businessId'=${t.businessId}::text and ${t.planHash}=encode(sha256(convert_to(${t.plan}::text,'UTF8')),'hex')`,
    ),
    pgPolicy("recovery_read", {
      for: "select",
      to: appRuntime,
      using: recoveryScope,
    }),
    pgPolicy("recovery_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`${recoveryScope} and actor_id=current_setting('app.actor_id',true) and session_id=current_setting('app.recovery_session',true) and authorized_session_id=session_id and stage='requested' and lease is null and lease_until is null`,
    }),
    pgPolicy("recovery_owner", {
      for: "all",
      to: "public",
      using: recoveryOwner,
      withCheck: recoveryOwner,
    }),
  ],
).enableRLS();
export const infrastructureRecoveryEvent = pgTable(
  "infrastructure_recovery_event",
  {
    id: uuid("id").primaryKey(),
    position: bigserial("position", { mode: "number" }).notNull(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => business.id),
    operationId: uuid("operation_id").notNull(),
    stage: text("stage").notNull(),
    outcome: text("outcome").notNull(),
    evidence: jsonb("evidence").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy("recovery_event_read", {
      for: "select",
      to: appRuntime,
      using: recoveryScope,
    }),
    pgPolicy("recovery_event_owner", {
      for: "all",
      to: "public",
      using: recoveryOwner,
      withCheck: recoveryOwner,
    }),
  ],
).enableRLS();

const taxReportingScope = sql`public.tax_reporting_operator()`;
function taxReportingPolicies(name: string) {
  return [
    pgPolicy(name + "_read", {
      for: "select",
      to: appRuntime,
      using: taxReportingScope,
    }),
    pgPolicy(name + "_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${taxReportingScope}) and actor_id=current_setting('app.actor_id',true)`,
    }),
    pgPolicy(name + "_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ];
}
const taxAttribution = () => ({
  requestKey: uuid("request_key").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  actorId: text("actor_id")
    .notNull()
    .references(() => user.id),
  actorName: text("actor_name").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  note: text("note").notNull(),
});
export const taxObligationRevision = pgTable(
  "tax_obligation_revision",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<ObligationDefinition>().notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_obligation_key_version").on(t.key, t.version),
    uniqueIndex("tax_obligation_request").on(t.requestKey),
    check("tax_obligation_version", sql`${t.version}>0`),
    ...taxReportingPolicies("tax_obligation_revision"),
  ],
).enableRLS();
export const taxObligationDecision = pgTable(
  "tax_obligation_decision",
  {
    id: uuid("id").primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => taxObligationRevision.id),
    version: integer("version").notNull(),
    outcome: text("outcome").$type<"approved" | "withdrawn">().notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_obligation_decision_version").on(t.revisionId, t.version),
    uniqueIndex("tax_obligation_decision_request").on(t.requestKey),
    check(
      "tax_obligation_decision_outcome",
      sql`${t.outcome} in ('approved','withdrawn') and ${t.version}>0`,
    ),
    ...taxReportingPolicies("tax_obligation_decision"),
  ],
).enableRLS();
export const taxReportingPeriod = pgTable(
  "tax_reporting_period",
  {
    id: uuid("id").primaryKey(),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => taxObligationRevision.id),
    supersedesId: uuid("supersedes_id"),
    definition: jsonb("definition").$type<ReportingPeriod>().notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_reporting_period_request").on(t.requestKey),
    uniqueIndex("tax_reporting_period_successor").on(t.supersedesId),
    foreignKey({
      name: "tax_reporting_period_supersedes_fk",
      columns: [t.supersedesId],
      foreignColumns: [t.id],
    }),
    check(
      "tax_reporting_period_binding",
      sql`${t.definition}->>'id'=${t.id}::text and ${t.definition}->>'obligationId'=${t.obligationId}::text and coalesce(${t.definition}->>'supersedesId','')=coalesce(${t.supersedesId}::text,'') and ${t.supersedesId} is distinct from ${t.id} and (${t.definition}->>'end')::timestamptz>(${t.definition}->>'start')::timestamptz`,
    ),
    ...taxReportingPolicies("tax_reporting_period"),
  ],
).enableRLS();
export const taxLiabilityReport = pgTable(
  "tax_liability_report",
  {
    id: uuid("id").primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => taxReportingPeriod.id),
    revision: integer("revision").notNull(),
    snapshot: jsonb("snapshot").$type<LiabilitySnapshot>().notNull(),
    digest: text("digest").notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_liability_report_revision").on(t.periodId, t.revision),
    uniqueIndex("tax_liability_report_request").on(t.requestKey),
    check(
      "tax_liability_report_binding",
      sql`${t.snapshot}->'period'->>'id'=${t.periodId}::text and ${t.digest} ~ '^[a-f0-9]{64}$' and ${t.revision}>0`,
    ),
    ...taxReportingPolicies("tax_liability_report"),
  ],
).enableRLS();
export const taxReportAction = pgTable(
  "tax_report_action",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => taxLiabilityReport.id),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    detail: jsonb("detail")
      .$type<{ issueId: string | null; evidence: string[] }>()
      .notNull(),
    ...taxAttribution(),
    actorId: text("actor_id").references(() => user.id),
  },
  (t) => [
    uniqueIndex("tax_report_action_version").on(t.reportId, t.version),
    uniqueIndex("tax_report_action_request").on(t.requestKey),
    check(
      "tax_report_action_kind",
      sql`${t.kind} in ('review','raise_issue','resolve_issue','approve','invalidated') and ${t.version}>0`,
    ),
    ...taxReportingPolicies("tax_report_action"),
  ],
).enableRLS();
export const taxPeriodReminder = pgTable(
  "tax_period_reminder",
  {
    id: uuid("id").primaryKey(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => taxReportingPeriod.id),
    stage: text("stage").notNull(),
    stageAt: timestamp("stage_at", { withTimezone: true }).notNull(),
    source: jsonb("source").$type<TaxReminder["source"]>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tax_period_reminder_stage").on(t.periodId, t.stage),
    pgPolicy("tax_period_reminder_read", {
      for: "select",
      to: appRuntime,
      using: taxReportingScope,
    }),
    pgPolicy("tax_period_reminder_insert", {
      for: "insert",
      to: appRuntime,
      withCheck: sql`false`,
    }),
    pgPolicy("tax_period_reminder_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();

export const taxFilingExport = pgTable(
  "tax_filing_export",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => taxLiabilityReport.id),
    report: jsonb("report").$type<LiabilityReport>().notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_filing_export_request").on(t.requestKey),
    check(
      "tax_filing_export_binding",
      sql`coalesce(${t.report}->>'id'=${t.reportId}::text and ${t.report}->>'status'='approved' and (${t.report}->>'current')::boolean,false)`,
    ),
    ...taxReportingPolicies("tax_filing_export"),
  ],
).enableRLS();

export const taxFilingPolicy = pgTable(
  "tax_filing_policy",
  {
    id: uuid("id").primaryKey(),
    obligationId: uuid("obligation_id")
      .notNull()
      .references(() => taxObligationRevision.id),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<FilingPolicyDefinition>().notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_filing_policy_request").on(t.requestKey),
    uniqueIndex("tax_filing_policy_version").on(t.obligationId, t.version),
    check("tax_filing_policy_positive_version", sql`${t.version}>0`),
    ...taxReportingPolicies("tax_filing_policy"),
  ],
).enableRLS();
export const taxFilingPolicyDecision = pgTable(
  "tax_filing_policy_decision",
  {
    id: uuid("id").primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => taxFilingPolicy.id),
    version: integer("version").notNull(),
    outcome: text("outcome").$type<"approved" | "withdrawn">().notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_filing_policy_decision_request").on(t.requestKey),
    uniqueIndex("tax_filing_policy_decision_version").on(t.policyId, t.version),
    check(
      "tax_filing_policy_decision_valid",
      sql`${t.version}>0 and ${t.outcome} in ('approved','withdrawn')`,
    ),
    ...taxReportingPolicies("tax_filing_policy_decision"),
  ],
).enableRLS();
export const taxFilingIntent = pgTable(
  "tax_filing_intent",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => taxLiabilityReport.id),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => taxFilingPolicy.id),
    policyDecisionId: uuid("policy_decision_id")
      .notNull()
      .references(() => taxFilingPolicyDecision.id),
    reportApprovalId: uuid("report_approval_id")
      .notNull()
      .references(() => taxReportAction.id),
    kind: text("kind").$type<"submission" | "remittance">().notNull(),
    target: jsonb("target").$type<FilingTarget>().notNull(),
    report: jsonb("report").$type<LiabilityReport>().notNull(),
    policy: jsonb("policy").$type<FilingPolicy>().notNull(),
    amountMinor: text("amount_minor").notNull(),
    basisDigest: text("basis_digest").notNull(),
    amendmentOf: uuid("amendment_of"),
    supersedesId: uuid("supersedes_id"),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_filing_intent_request").on(t.requestKey),
    foreignKey({
      name: "tax_filing_amendment_fk",
      columns: [t.amendmentOf],
      foreignColumns: [t.id],
    }),
    foreignKey({
      name: "tax_filing_supersedes_fk",
      columns: [t.supersedesId],
      foreignColumns: [t.id],
    }),
    uniqueIndex("tax_filing_amendment_child").on(t.amendmentOf),
    uniqueIndex("tax_filing_supersedes_child").on(t.supersedesId),
    check(
      "tax_filing_basis_digest",
      sql`${t.basisDigest} ~ '^[a-f0-9]{64}$' and ${t.supersedesId} is distinct from ${t.id}`,
    ),
    check(
      "tax_filing_intent_binding",
      sql`coalesce(${t.kind} in ('submission','remittance') and ${t.report}->>'id'=${t.reportId}::text and ${t.target}->>'reportId'=${t.reportId}::text and ${t.policy}->>'id'=${t.policyId}::text and ${t.amountMinor} ~ '^-?(0|[1-9][0-9]{0,59})$' and (${t.kind}='submission' or ${t.amountMinor} not like '-%') and ${t.amendmentOf} is distinct from ${t.id},false)`,
    ),
    ...taxReportingPolicies("tax_filing_intent"),
  ],
).enableRLS();
export const taxFilingEvent = pgTable(
  "tax_filing_event",
  {
    id: uuid("id").primaryKey(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => taxFilingIntent.id),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    confirmationKey: text("confirmation_key"),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_filing_event_request").on(t.requestKey),
    uniqueIndex("tax_filing_event_version").on(t.intentId, t.version),
    uniqueIndex("tax_filing_confirmation_reference").on(t.confirmationKey),
    uniqueIndex("tax_filing_attempt_once")
      .on(t.intentId)
      .where(sql`${t.kind}='attempt'`),
    uniqueIndex("tax_filing_confirm_once")
      .on(t.intentId)
      .where(sql`${t.kind}='confirm'`),
    check(
      "tax_filing_confirmation_key",
      sql`coalesce((${t.kind}='confirm' and ${t.confirmationKey} ~ '^[a-f0-9]{64}$') or (${t.kind}<>'confirm' and ${t.confirmationKey} is null),false)`,
    ),
    check(
      "tax_filing_event_valid",
      sql`${t.version}>0 and ${t.kind} in ('approve','attempt','acknowledge','confirm','raise_issue','resolve_issue','supersede')`,
    ),
    ...taxReportingPolicies("tax_filing_event"),
  ],
).enableRLS();

export const taxFilingEvidence = pgTable(
  "tax_filing_evidence",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => taxLiabilityReport.id),
    target: jsonb("target").$type<FilingEvidence["target"]>(),
    metadata: jsonb("metadata")
      .$type<
        Omit<
          FilingEvidence,
          "id" | "reportId" | "target" | "actorId" | "actorName" | "at" | "note"
        >
      >()
      .notNull(),
    storageDatabase: text("storage_database")
      .notNull()
      .default(sql`current_database()`),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_filing_evidence_request").on(t.requestKey),
    ...taxReportingPolicies("tax_filing_evidence"),
  ],
).enableRLS();
export const taxFilingBytes = pgTable(
  "tax_filing_bytes",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => taxFilingEvidence.id),
    body: text("body").notNull(),
  },
  () => [
    pgPolicy("tax_filing_bytes_system", {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ],
).enableRLS();
export const taxFilingAccess = pgTable(
  "tax_filing_access",
  {
    id: uuid("id").primaryKey(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => taxFilingEvidence.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    accessHash: text("access_hash").notNull(),
    sessionId: text("session_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("tax_filing_access_hash").on(t.accessHash),
    check(
      "tax_filing_access_expiry",
      sql`${t.expiresAt}>${t.at} and ${t.expiresAt}<=${t.at}+interval '30 seconds'`,
    ),
    ...taxReportingPolicies("tax_filing_access"),
  ],
).enableRLS();
export const taxRemittanceAllocation = pgTable(
  "tax_remittance_allocation",
  {
    id: uuid("id").primaryKey(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => taxFilingIntent.id),
    confirmationId: uuid("confirmation_id")
      .notNull()
      .references(() => taxFilingEvent.id),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => taxFilingEvidence.id),
    reportId: uuid("report_id")
      .notNull()
      .references(() => taxLiabilityReport.id),
    referenceKey: text("reference_key").notNull(),
    amountMinor: text("amount_minor").notNull(),
    currency: text("currency").notNull(),
    ...taxAttribution(),
  },
  (t) => [
    uniqueIndex("tax_remittance_confirmation").on(t.confirmationId),
    uniqueIndex("tax_remittance_evidence").on(t.evidenceId),
    uniqueIndex("tax_remittance_reference").on(t.referenceKey),
    uniqueIndex("tax_remittance_intent").on(t.intentId),
    check(
      "tax_remittance_amount",
      sql`${t.amountMinor} ~ '^(0|[1-9][0-9]{0,59})$' and ${t.currency} in ('INR','USD')`,
    ),
    ...taxReportingPolicies("tax_remittance_allocation"),
  ],
).enableRLS();
export const taxRemittanceReview = pgTable(
  "tax_remittance_review",
  {
    id: uuid("id").primaryKey(),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => taxRemittanceAllocation.id),
    reportId: uuid("report_id")
      .notNull()
      .references(() => taxLiabilityReport.id),
    version: integer("version").notNull(),
    ...taxAttribution(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => taxFilingPolicy.id),
    policyDecisionId: uuid("policy_decision_id")
      .notNull()
      .references(() => taxFilingPolicyDecision.id),
    reportApprovalId: uuid("report_approval_id")
      .notNull()
      .references(() => taxReportAction.id),
  },
  (t) => [
    uniqueIndex("tax_remittance_review_request").on(t.requestKey),
    uniqueIndex("tax_remittance_review_version").on(t.allocationId, t.version),
    check("tax_remittance_review_positive_version", sql`${t.version}>0`),
    ...taxReportingPolicies("tax_remittance_review"),
  ],
).enableRLS();

const reconciliationAuthority = sql`coalesce(current_setting('app.business_id',true),'')='' and (${paymentOperator})`;
function reconciliationPolicies(name: string) {
  return [
    pgPolicy(`${name}_read`, {
      for: "select",
      to: appRuntime,
      using: reconciliationAuthority,
    }),
    pgPolicy(`${name}_insert`, {
      for: "insert",
      to: appRuntime,
      withCheck: sql`(${reconciliationAuthority}) and actor_id=current_setting('app.actor_id',true)`,
    }),
    pgPolicy(`${name}_system`, {
      for: "all",
      to: "public",
      using: paymentOwner,
      withCheck: paymentOwner,
    }),
  ];
}
export const reconciliationEvidence = pgTable(
  "reconciliation_evidence",
  {
    id: uuid("id").primaryKey(),
    requestKey: uuid("request_key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    source: text("source").notNull(),
    reference: text("reference").notNull(),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    contentBase64: text("content_base64").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    note: text("note").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reconciliation_evidence_request").on(t.requestKey),
    check(
      "reconciliation_evidence_bounds",
      sql`${t.bytes}>0 and ${t.bytes}<=262144 and length(${t.contentBase64})<=350000 and ${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.source} in ('provider_statement','bank_statement','conversion_confirmation') and octet_length(decode(${t.contentBase64},'base64'))=${t.bytes} and encode(sha256(decode(${t.contentBase64},'base64')),'hex')=${t.sha256}`,
    ),
    ...reconciliationPolicies("reconciliation_evidence"),
  ],
).enableRLS();
export const reconciliationRecord = pgTable(
  "reconciliation_record",
  {
    id: uuid("id").primaryKey(),
    requestKey: uuid("request_key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => reconciliationEvidence.id),
    supersedes: uuid("supersedes"),
    identity: text("identity").notNull(),
    data: jsonb("data").$type<ReconciliationEntry>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reconciliation_record_request").on(t.requestKey),
    uniqueIndex("reconciliation_record_correction").on(t.supersedes),
    foreignKey({
      name: "reconciliation_record_predecessor",
      columns: [t.supersedes],
      foreignColumns: [t.id],
    }),
    check(
      "reconciliation_record_binding",
      sql`coalesce((${t.data}->>'requestKey'=${t.requestKey}::text and ${t.data}->>'evidenceId'=${t.evidenceId}::text and (${t.data}->>'supersedes') is not distinct from ${t.supersedes}::text and ${t.data}->>'kind' in ('settlement','bank_receipt') and octet_length(${t.data}::text)<=1048576),false)`,
    ),
    ...reconciliationPolicies("reconciliation_record"),
  ],
).enableRLS();
export const reconciliationReview = pgTable(
  "reconciliation_review",
  {
    id: uuid("id").primaryKey(),
    requestKey: uuid("request_key").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    recordId: uuid("record_id")
      .notNull()
      .references(() => reconciliationRecord.id),
    reportHash: text("report_hash").notNull(),
    outcome: text("outcome").notNull(),
    note: text("note").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    discrepancy: jsonb("discrepancy")
      .$type<Record<string, unknown>>()
      .notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("reconciliation_review_request").on(t.requestKey),
    check(
      "reconciliation_review_outcome",
      sql`${t.outcome} in ('acknowledged','resolved') and ${t.reportHash} ~ '^[a-f0-9]{64}$'`,
    ),
    ...reconciliationPolicies("reconciliation_review"),
  ],
).enableRLS();
export const reconciliationAccess = pgTable(
  "reconciliation_access",
  {
    id: uuid("id").primaryKey(),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => reconciliationEvidence.id),
    tokenHash: text("token_hash").notNull(),
    at: timestamp("at", { withTimezone: true })
      .notNull()
      .default(sql`statement_timestamp()`),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`(statement_timestamp()+interval '60 seconds')`),
  },
  (t) => [
    uniqueIndex("reconciliation_access_token").on(t.tokenHash),
    check(
      "reconciliation_access_expiry",
      sql`${t.expiresAt}>${t.at} and ${t.expiresAt}<=${t.at}+interval '60 seconds'`,
    ),
    ...reconciliationPolicies("reconciliation_access"),
  ],
).enableRLS();
