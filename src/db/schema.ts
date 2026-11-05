import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
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

export const appRuntime = pgRole("app_runtime").existing();

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
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
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);

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
