import { bootstrapNotificationSetup } from "../src/application/notification-bootstrap";
import { readySender } from "./support/senders";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createSenderHealthApplication } from "../src/application/sender-health";
import { createSenderHealthRepository } from "../src/db/sender-health-repository";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { createAuth } from "../src/auth/auth";
import { runtimeDatabase } from "../src/db/runtime";
import { createNotificationRepository } from "../src/db/notification-repository";
import { createNotificationApplication } from "../src/application/notifications";
import { createResendProvider } from "../src/notifications/resend";
import { notificationVault } from "../src/notifications/vault";
import { createTeamApplication } from "../src/application/team";
import { createTeamRepository } from "../src/db/team-repository";
import { invitationTokens } from "../src/auth/invitation-tokens";
import { Webhook } from "svix";
import { verifyRuntimeRole } from "../src/db/runtime";
import {
  notificationFunctions,
  notificationTables,
} from "../src/db/notification-security";
import { secureDatabase } from "../src/db/setup";
import { createCostApplication } from "../src/application/costs";
import { createCostRepository } from "../src/db/cost-repository";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { mailboxFixture } from "./support/mailboxes";
import type { NotificationConfiguration } from "../src/models/notifications";
import { createNotificationHttp } from "../src/http/notifications";
import { subscriptionFixture } from "./support/subscription";
import { razorpayFixture } from "./support/razorpay";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { sql } from "drizzle-orm";
import { createOperationsApplication } from "../src/application/operations";
import { createOperationsRepository } from "../src/db/operations-repository";

describe("Transactional notifications at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const wire: { url: string; body: unknown; key: string | null }[] = [];
  const accepted = new Map<string, { id: string; body: unknown }>();
  let loseResponse = false;
  let verifiedSender = true,
    dailyUsed = 10,
    dailyLimit: number | null = 100,
    monthlyUsed = 100,
    rateLimited = false;
  let beforeUsage: (() => Promise<void>) | undefined;
  let beforeSendResult: (() => Promise<void>) | undefined;
  let nativeError: { status: number; name: string } | undefined;
  const config = {
    account: "fixture-team",
    mode: "production" as const,
    from: "auth@platform.example",
    domainId: "c1bcab80-7951-4e78-94ba-3c615069da77",
    apiKey: "fixture-send-key",
    readApiKey: "fixture-full-access-key",
    webhookSecret: `whsec_${Buffer.alloc(32, 7).toString("base64")}`,
    origin: "http://localhost:3000",
  };
  const nativeFetch: typeof fetch = async (url, init) => {
    wire.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      key: new Headers(init?.headers).get("Idempotency-Key"),
    });
    if (String(url).endsWith("/usage")) {
      const hook = beforeUsage;
      beforeUsage = undefined;
      await hook?.();
      return Response.json({
        object: "usage",
        emails: {
          daily: {
            used: dailyUsed,
            sent: dailyUsed - 2,
            received: 2,
            limit: dailyLimit,
            resets_at: "2026-12-01T00:00:00Z",
          },
          monthly: {
            used: monthlyUsed,
            sent: monthlyUsed - 20,
            received: 20,
            limit: 3000,
            resets_at: "2026-12-01T00:00:00Z",
          },
        },
        rate_limit: { limit: 10, duration: "1000ms" },
      });
    }
    if (String(url).includes("/domains/"))
      return Response.json({
        id: String(url).endsWith("ef4e41b4-05ba-4bc7-ad25-ff9b588d5301")
          ? "ef4e41b4-05ba-4bc7-ad25-ff9b588d5301"
          : config.domainId,
        name: String(url).endsWith("ef4e41b4-05ba-4bc7-ad25-ff9b588d5301")
          ? "alerts.platform.example"
          : "platform.example",
        status: "partially_verified",
        capabilities: { sending: "enabled", receiving: "enabled" },
        records: [
          {
            record: "SPF",
            type: "TXT",
            status: verifiedSender ? "verified" : "pending",
          },
          { record: "SPF", type: "MX", status: "verified" },
          { record: "DKIM", type: "TXT", status: "verified" },
          { record: "Receiving", type: "MX", status: "pending" },
        ],
      });
    if (rateLimited)
      return Response.json(
        { name: "rate_limit_exceeded" },
        {
          status: 429,
          headers: {
            "retry-after": "120",
            "ratelimit-remaining": "0",
            "ratelimit-reset": "120",
          },
        },
      );
    if (nativeError)
      return Response.json(
        { name: nativeError.name, message: "private-provider-secret-body" },
        { status: nativeError.status },
      );
    const key = new Headers(init?.headers).get("Idempotency-Key") ?? "missing";
    const previous = accepted.get(key);
    if (previous) expect(JSON.parse(String(init?.body))).toEqual(previous.body);
    const record = previous ?? {
      id:
        accepted.size === 0
          ? "e2ee4284-d207-42e0-9e0f-4104546bddae"
          : randomUUID(),
      body: JSON.parse(String(init?.body)),
    };
    accepted.set(key, record);
    const hook = beforeSendResult;
    beforeSendResult = undefined;
    await hook?.();
    if (loseResponse) throw new Error("fixture-timeout-with-sensitive-body");
    return Response.json({ id: record.id });
  };
  beforeEach(async () => {
    config.account = `fixture-${randomUUID()}`;
    wire.length = 0;
    accepted.clear();
    loseResponse = false;
    verifiedSender = true;
    dailyUsed = 10;
    dailyLimit = 100;
    monthlyUsed = 100;
    rateLimited = false;
    beforeUsage = undefined;
    beforeSendResult = undefined;
    nativeError = undefined;
    const time = await h.admin.query<{ now: Date }>(
      "select clock_timestamp() as now",
    );
    h.clock.set(time.rows[0].now.toISOString());
  });
  const app = (
    overrides: {
      configuration?: NotificationConfiguration;
      vault?: ReturnType<typeof notificationVault>;
    } = {},
  ) =>
    createNotificationApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      authenticate: h.authenticate,
      repository: createNotificationRepository(runtimeDatabase(h.runtime)),
      provider: createResendProvider(
        overrides.configuration ?? config,
        nativeFetch,
      ),
      vault:
        overrides.vault ??
        notificationVault({
          activeKey: "v1",
          keys: { v1: Buffer.alloc(32, 11) },
        }),
      configuration: overrides.configuration ?? config,
    });
  async function prepared(email: string) {
    const headers = await h.signIn(email),
      actor = await h.access.primary(headers);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [actor.user.id],
    );
    const notifications = app();
    await notifications.selectTerms(headers, {
      kind: "free",
      reference: "Reviewed Free plan",
      monthlyLimit: 3000,
      dailyLimit: 100,
      amount: null,
    });
    await notifications.refreshSetup(headers);
    return { headers, notifications };
  }
  function signed(
    type: string,
    recipient: string,
    eventId: string,
    secret = config.webhookSecret,
  ) {
    const raw = Buffer.from(
      JSON.stringify({
        type,
        created_at: h.clock.now().toISOString(),
        data: {
          email_id: "e2ee4284-d207-42e0-9e0f-4104546bddae",
          from: config.from,
          to: [recipient],
          subject: "private bearer subject ignored",
        },
      }),
    );
    const headers = new Headers({
      "svix-id": eventId,
      "svix-timestamp": String(Math.floor(h.clock.now().getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(eventId, h.clock.now(), raw),
    });
    return { raw, headers };
  }
  async function requestLink(
    notifications: ReturnType<typeof app>,
    email: string,
  ) {
    const auth = createAuth({
      database: runtimeDatabase(h.runtime),
      baseURL: config.origin,
      secret: "fixture-gated-authentication-secret",
      mailer: notifications.signInMailer,
    });
    return auth.api.signInMagicLink({
      body: { email },
      headers: new Headers({ origin: config.origin }),
    });
  }

  it("classifies a notifications-only operator centrally and requires current MFA", async () => {
    const headers = await h.signIn("notification-operator@example.com", false);
    const identity = await h.access.primary(headers);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [identity.user.id],
    );
    expect(await h.access.status(headers)).toMatchObject({
      required: true,
      operator: true,
      readiness: "mfa-incomplete",
    });
    await expect(
      h.team.requirePlatformCapability(headers, "notifications.manage"),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const verified = await h.signIn("notification-verified@example.com");
    const actor = await h.access.primary(verified);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [actor.user.id],
    );
    await expect(
      h.team.requirePlatformCapability(verified, "notifications.manage"),
    ).resolves.toEqual({ capability: "notifications.manage" });
  });

  it("takes an actual magic-link action through private persistence and native acceptance with redacted operator visibility", async () => {
    const dbTime = await h.admin.query<{ now: Date }>(
      "select clock_timestamp() as now",
    );
    h.clock.set(dbTime.rows[0].now.toISOString());
    const operator = await h.signIn("notification-auth-reviewer@example.com");
    const identity = await h.access.primary(operator);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [identity.user.id],
    );
    const notifications = app();
    await notifications.selectTerms(operator, {
      kind: "free",
      reference: "Reviewed Resend Free eligibility",
      monthlyLimit: 3000,
      dailyLimit: 100,
      amount: null,
    });
    await notifications.refreshSetup(operator);
    const auth = createAuth({
      database: runtimeDatabase(h.runtime),
      baseURL: config.origin,
      secret: "fixture-authentication-secret-for-notifications",
      mailer: notifications.signInMailer,
    });
    const result = await auth.handler(
      new Request(`${config.origin}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: {
          origin: config.origin,
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.240",
        },
        body: JSON.stringify({
          email: "private-auth@example.com",
          callbackURL: "/businesses",
        }),
      }),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: true });
    const workspace = await notifications.workspace(operator);
    expect(workspace.setup).toMatchObject({
      sendingReady: true,
      receivingReady: false,
      accountIdentity: "configured_credential_set",
      readAccess: "verified",
    });
    expect(workspace.notices).toHaveLength(1);
    expect(workspace.notices[0]).toMatchObject({
      purpose: "authentication",
      state: "accepted",
      providerId: "e2ee4284-d207-42e0-9e0f-4104546bddae",
    });
    expect(JSON.stringify(workspace)).not.toContain("private-auth@example.com");
    expect(JSON.stringify(workspace)).not.toContain("token=");
    const sent = wire.filter((r) => r.url.endsWith("/emails"));
    expect(sent).toHaveLength(1);
    expect(sent[0].key).toMatch(/^authentication\//);
    expect(sent[0].body).toMatchObject({
      from: config.from,
      to: ["private-auth@example.com"],
    });
  });

  it("retries the same frozen invitation after ambiguous native acceptance and Business rename, then denies revoked authority", async () => {
    const owner = await h.signIn("notification-inviter@example.com");
    const actor = await h.access.primary(owner);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [actor.user.id],
    );
    const notifications = app();
    await notifications.selectTerms(owner, {
      kind: "free",
      reference: "Reviewed Free plan",
      monthlyLimit: 3000,
      dailyLimit: 100,
      amount: null,
    });
    await notifications.refreshSetup(owner);
    const team = createTeamApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTeamRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      tokens: invitationTokens("notification-invitation-test-secret"),
      mailer: notifications.invitationMailer,
      origin: config.origin,
    });
    const business = await h.application.createBusiness(owner, {
      name: "Frozen Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    loseResponse = true;
    const invitation = await team.invite(owner, business.id, {
      email: "private-invitation@example.com",
      role: "salesperson",
    });
    expect(invitation.delivery).toBe("unconfirmed");
    expect(
      (await notifications.businessWorkspace(owner, business.id)).notices[0],
    ).toMatchObject({ state: "uncertain", providerId: null });
    await h.application.updateProfile(owner, business.id, {
      name: "Renamed Business",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    // Advance the persisted recovery boundary in this isolated clock fixture.
    await h.admin.query(
      "update notification_notice set next_attempt_at=statement_timestamp()-interval '1 second' where account=$1",
      [config.account],
    );
    loseResponse = false;
    await team.deliverInvitation(owner, business.id, {
      invitationId: invitation.id,
    });
    const visible = await notifications.businessWorkspace(owner, business.id);
    expect(visible.notices[0]).toMatchObject({
      state: "accepted",
      providerId: "e2ee4284-d207-42e0-9e0f-4104546bddae",
    });
    expect(accepted.size).toBe(1);
    expect(
      wire.filter((r) => r.url.endsWith("/emails")).map((r) => r.key),
    ).toEqual([
      `business-invitation/${invitation.id}`,
      `business-invitation/${invitation.id}`,
    ]);
    expect(JSON.stringify(accepted.values().next().value?.body)).toContain(
      "Frozen Business",
    );
    expect(JSON.stringify(visible)).not.toContain(
      "private-invitation@example.com",
    );
    const foreign = await h.signIn("notification-foreign@example.com");
    await expect(
      notifications.businessWorkspace(foreign, business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await team.revokeInvitation(owner, business.id, {
      invitationId: invitation.id,
    });
    await expect(
      team.deliverInvitation(owner, business.id, {
        invitationId: invitation.id,
      }),
    ).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
  });

  it("persists exact raw signed native statuses once and keeps complaints across delayed and out-of-order receipts", async () => {
    const { headers, notifications } = await prepared(
      "notification-status-reviewer@example.com",
    );
    const auth = createAuth({
      database: runtimeDatabase(h.runtime),
      baseURL: config.origin,
      secret: "fixture-authentication-status-secret",
      mailer: notifications.signInMailer,
    });
    await auth.api.signInMagicLink({
      body: { email: "status-private@example.com" },
      headers: new Headers({ origin: config.origin }),
    });
    const event = signed(
      "email.delivered",
      "status-private@example.com",
      "msg_notification_delivered",
    );
    await expect(
      notifications.receiveWebhook(event.raw, event.headers),
    ).resolves.toEqual({ received: true });
    await notifications.receiveWebhook(event.raw, event.headers);
    expect((await notifications.workspace(headers)).notices[0]).toMatchObject({
      state: "accepted",
      stage: "delivered",
    });
    const complained = signed(
      "email.complained",
      "status-private@example.com",
      "msg_notification_complained",
    );
    await notifications.receiveWebhook(complained.raw, complained.headers);
    const sent = signed(
      "email.sent",
      "status-private@example.com",
      "msg_notification_sent",
    );
    await notifications.receiveWebhook(sent.raw, sent.headers);
    const visible = (await notifications.workspace(headers)).notices[0];
    expect(visible.stage).toBe("complained");
    expect(
      visible.history.filter((e) => e.kind === "provider_delivered"),
    ).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain("private bearer");
    await expect(
      notifications.receiveWebhook(
        Buffer.concat([event.raw, Buffer.from(" ")]),
        event.headers,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const forged = signed(
      "email.bounced",
      "status-private@example.com",
      "msg_forged",
      `whsec_${Buffer.alloc(32, 8).toString("base64")}`,
    );
    await expect(
      notifications.receiveWebhook(forged.raw, forged.headers),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = signed(
      "email.bounced",
      "foreign-recipient@example.com",
      "msg_foreign_recipient",
    );
    await notifications.receiveWebhook(foreign.raw, foreign.headers);
    expect((await notifications.workspace(headers)).notices[0].stage).toBe(
      "complained",
    );
  });

  it("holds unverified sending with an executable native refresh and never treats receiving as mailbox sync", async () => {
    verifiedSender = false;
    const { headers, notifications } = await prepared(
      "notification-setup-reviewer@example.com",
    );
    await requestLink(notifications, "setup-private@example.com");
    const blocked = await notifications.workspace(headers);
    expect(blocked.setup).toMatchObject({
      sendingReady: false,
      receivingReady: false,
    });
    expect(blocked.notices[0]).toMatchObject({
      state: "pending",
      reason: "setup_required",
    });
    expect(accepted.size).toBe(0);
    verifiedSender = true;
    await notifications.refreshSetup(headers);
    await notifications.retry(headers, blocked.notices[0].id);
    expect((await notifications.workspace(headers)).notices[0].state).toBe(
      "accepted",
    );
  });

  it("accounts for other-key traffic, receiving and unresolved reservations without counting observed sends twice", async () => {
    dailyUsed = 98;
    const { headers, notifications } = await prepared(
      "notification-quota-reviewer@example.com",
    );
    await requestLink(notifications, "quota-first@example.com");
    dailyUsed = 99;
    await notifications.refreshSetup(headers);
    await requestLink(notifications, "quota-second@example.com");
    await requestLink(notifications, "quota-third@example.com");
    expect(accepted.size).toBe(2);
    expect(
      (await notifications.workspace(headers)).notices.filter(
        (n) => n.reason === "quota_or_observation_exhausted",
      ),
    ).toHaveLength(1);
    dailyLimit = null;
    dailyUsed = 10;
    await notifications.refreshSetup(headers);
    await requestLink(notifications, "paid-unselected@example.com");
    expect(accepted.size).toBe(2);
    expect(
      (await notifications.workspace(headers)).notices.some(
        (n) => n.reason === "selected_paid_terms_required",
      ),
    ).toBe(true);
    await notifications.selectTerms(headers, {
      kind: "selected_paid",
      reference: "Explicit hypothetical fixture subscription terms",
      monthlyLimit: 3000,
      dailyLimit: null,
      amount: { currency: "USD", micros: "20000000" },
    });
    await requestLink(notifications, "paid-selected@example.com");
    expect(accepted.size).toBe(3);
  });

  it("honors native Retry-After across manual retry and worker restart using the same key", async () => {
    const { headers, notifications } = await prepared(
      "notification-rate-reviewer@example.com",
    );
    rateLimited = true;
    await requestLink(notifications, "rate-private@example.com");
    const notice = (await notifications.workspace(headers)).notices[0];
    expect(notice.state).toBe("rate_limited");
    expect(
      Date.parse(notice.nextAttemptAt ?? "") - h.clock.now().getTime(),
    ).toBeGreaterThanOrEqual(119000);
    rateLimited = false;
    await app().recoverPending();
    await notifications.retry(headers, notice.id);
    expect(accepted.size).toBe(0);
    await h.admin.query(
      "update notification_notice set next_attempt_at=statement_timestamp()-interval '1 second' where account=$1",
      [config.account],
    );
    await app().recoverPending();
    expect((await notifications.workspace(headers)).notices[0].state).toBe(
      "accepted",
    );
    expect(
      new Set(wire.filter((r) => r.url.endsWith("/emails")).map((r) => r.key))
        .size,
    ).toBe(1);
  });

  it("freezes local dispatch during an account-usage read so an accepted send cannot disappear between observation and persistence", async () => {
    const { headers, notifications } = await prepared(
      "notification-snapshot-reviewer@example.com",
    );
    beforeUsage = async () => {
      await requestLink(app(), "snapshot-private@example.com");
    };
    await notifications.refreshSetup(headers);
    expect(accepted.size).toBe(0);
    const notice = (await notifications.workspace(headers)).notices[0];
    await notifications.retry(headers, notice.id);
    expect(accepted.size).toBe(1);
  });

  it.each(
    notificationTables.flatMap((table) =>
      ["SELECT", "INSERT"].map((privilege) => ({ table, privilege })),
    ),
  )(
    "requires $privilege on $table individually",
    async ({ table, privilege }) => {
      await h.admin.query(
        `revoke ${privilege} on public.${table} from app_runtime`,
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await secureDatabase(h.admin);
      }
      await verifyRuntimeRole(h.runtime);
    },
  );

  it.each(notificationFunctions)(
    "requires the restricted %s helper",
    async (name) => {
      const rows = await h.admin.query<{ signature: string }>(
        "select oid::regprocedure::text as signature from pg_proc where pronamespace='public'::regnamespace and proname=$1",
        [name],
      );
      expect(rows.rows).toHaveLength(1);
      await h.admin.query(
        `revoke execute on function ${rows.rows[0].signature} from app_runtime`,
      );
      try {
        await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
          code: "SETUP_REQUIRED",
        });
      } finally {
        await secureDatabase(h.admin);
      }
    },
  );

  it("restores populated private and public ledgers on managed reapplication", async () => {
    const { headers, notifications } = await prepared(
      "notification-security-reviewer@example.com",
    );
    await requestLink(notifications, "security-private@example.com");
    const before = await notifications.workspace(headers);
    await h.reapplySchema();
    expect((await notifications.workspace(headers)).notices).toEqual(
      before.notices,
    );
    for (const table of notificationTables)
      expect((await h.runtime.query(`select * from ${table}`)).rows).toEqual(
        [],
      );
  });

  it("composes the existing cost alert with real provider acceptance and a single redacted native usage identity", async () => {
    const { headers } = await prepared(
      "notification-cost-reviewer@example.com",
    );
    const notifications = app({
      configuration: {
        ...config,
        costFrom: "budget@alerts.platform.example",
        costDomainId: "ef4e41b4-05ba-4bc7-ad25-ff9b588d5301",
      },
    });
    await notifications.refreshSetup(headers);
    const actor = await h.access.primary(headers);
    await h.admin.query(
      "update platform_operator set costs=true where user_id=$1",
      [actor.user.id],
    );
    const costs = () =>
      createCostApplication({
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createCostRepository(runtimeDatabase(h.runtime)),
        clock: h.clock,
        mailer: notifications.costMailer,
      });
    const month = h.clock.now().toISOString().slice(0, 7);
    await costs().record(headers, {
      sourceId: "evidence:notification-budget-fixture",
      expectedVersion: 0,
      source: {
        month,
        provider: "neon",
        category: "database",
        kind: "consumption",
        funding: "cash",
        amount: { currency: "INR", micros: "85000000" },
        quantity: 1,
        unit: "statement",
        businessId: null,
        runId: null,
        allocation: "Platform",
        evidence: "Hypothetical cost fixture",
        observedAt: `${month}-01T00:00:00Z`,
        freshUntil: "2026-12-01T00:00:00Z",
        plan: null,
        status: "recorded",
        details: {},
      },
      reason: "Fixture",
      retentionSeconds: 3600,
    });
    await costs().setBudget(headers, {
      month,
      category: "global",
      expectedVersion: 0,
      limitInrMicros: "100000000",
      ownerId: actor.user.id,
      email: true,
      forecastAlerts: false,
      retentionSeconds: 3600,
      note: "Existing authorized budget notice",
    });
    loseResponse = true;
    await costs().evaluate(headers, month);
    expect((await costs().workspace(headers, month)).alerts[0].emailState).toBe(
      "uncertain",
    );
    expect((await notifications.workspace(headers)).notices[0].state).toBe(
      "uncertain",
    );
    loseResponse = false;
    await h.admin.query(
      "update notification_notice set next_attempt_at=statement_timestamp()-interval '1 second' where account=$1",
      [config.account],
    );
    await costs().recoverPending();
    expect((await costs().workspace(headers, month)).alerts[0].emailState).toBe(
      "accepted",
    );
    expect((await notifications.workspace(headers)).notices[0]).toMatchObject({
      purpose: "cost_alert",
      state: "accepted",
      providerId: "e2ee4284-d207-42e0-9e0f-4104546bddae",
    });
    expect(accepted.size).toBe(1);
    expect(accepted.values().next().value?.body).toMatchObject({
      from: "budget@alerts.platform.example",
    });
    await costs().refresh(headers, { month, retentionSeconds: 3600 });
    await costs().refresh(headers, { month, retentionSeconds: 3600 });
    const noticeId = (await notifications.workspace(headers)).notices[0].id;
    const allSources = (await costs().workspace(headers, month)).sources.filter(
      (s) => s.source.provider === "resend",
    );
    expect(new Set(allSources.map((s) => s.sourceId)).size).toBe(
      allSources.length,
    );
    const sources = allSources.filter(
      (s) => s.sourceId === `native:notification:${noticeId}`,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].source).toMatchObject({
      funding: "existing_subscription",
      unit: "transactional_email",
      status: "unpriced",
      quantity: 1,
    });
    expect(JSON.stringify(sources)).not.toContain(
      "notification-cost-reviewer@example.com",
    );
    await h.admin.query(
      "update operator_cost_alert set email_state='uncertain',first_attempt_at=statement_timestamp()-interval '24 hours',lease_key=NULL,lease_until=statement_timestamp()-interval '1 second' where id=$1",
      [(await costs().workspace(headers, month)).alerts[0].id],
    );
    await app().recoverPending();
    await costs().recoverPending();
    expect((await costs().workspace(headers, month)).alerts[0].emailState).toBe(
      "accepted",
    );
    expect(accepted.size).toBe(1);
  });

  it("delivers a currently assigned persisted operations notice only under its selected audience policy without reexecuting the source action", async () => {
    const { headers, notifications } = await prepared(
      "notification-platform-owner@example.com",
    );
    const business = await h.application.createBusiness(headers, {
      name: "Notice Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    await notifications.setPreference(headers, business.id, {
      purpose: "operations",
      enabled: true,
      expectedVersion: 0,
    });
    const database = runtimeDatabase(h.runtime);
    const sender = await createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(database, h.clock),
      adapter: unavailableSenderAdapter,
      clock: h.clock,
    }).saveConnection(headers, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        label: "Sales",
        provider: "gmail",
        account: "sales@business.example",
        enabled: true,
      },
    });
    const provider = mailboxFixture(h.clock);
    const mailboxPolicy = await createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider,
      clock: h.clock,
      enqueue: async () => {
        throw new Error(
          "Source action must not be queued by notification delivery",
        );
      },
    }).save(headers, business.id, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: sender.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["sales"] },
        history: null,
      },
    });
    await notifications.recoverPending();
    const visible = await notifications.businessWorkspace(headers, business.id);
    expect(visible.notices).toHaveLength(1);
    expect(visible.notices[0]).toMatchObject({
      purpose: "operations",
      sourceStage: "unsafe",
      state: "accepted",
    });
    await app().recoverPending();
    expect(accepted.size).toBe(1);
    expect(provider.bodyReads).toEqual([]);
    const operations = createOperationsApplication({
      authenticate: h.access.authenticateForWork,
      repository: createOperationsRepository(database, h.clock),
      commands: {},
    });
    await operations.recover(headers, business.id, {
      source: "mailbox_scope",
      targetId: mailboxPolicy.id,
      action: "escalate",
      requestKey: randomUUID(),
    });
    await notifications.recoverPending();
    expect(
      (
        await notifications.businessWorkspace(headers, business.id)
      ).notices.some(
        (n) => n.sourceStage === "escalated" && n.state === "accepted",
      ),
    ).toBe(true);
    expect(accepted.size).toBe(2);
    await notifications.setPreference(headers, business.id, {
      purpose: "operations",
      enabled: false,
      expectedVersion: 1,
    });
    expect(
      (await notifications.preferences(headers, business.id))[0],
    ).toMatchObject({ enabled: false, version: 2 });
    const foreign = await h.signIn("notice-platform-foreign@example.com");
    await expect(
      notifications.setPreference(foreign, business.id, {
        purpose: "operations",
        enabled: true,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("expires the sealed authentication payload at 600 seconds and never retries its bearer URL after expiry", async () => {
    const { headers, notifications } = await prepared(
      "notification-expiry-reviewer@example.com",
    );
    loseResponse = true;
    await requestLink(notifications, "expired-secret@example.com");
    const notice = (await notifications.workspace(headers)).notices[0];
    expect(
      Date.parse(notice.expiresAt) - Date.parse(notice.createdAt),
    ).toBeGreaterThan(599000);
    expect(
      Date.parse(notice.expiresAt) - Date.parse(notice.createdAt),
    ).toBeLessThanOrEqual(600000);
    await h.admin.query(
      "update notification_notice set expires_at=statement_timestamp()-interval '1 second',next_attempt_at=NULL where id=$1",
      [notice.id],
    );
    await h.admin.query(
      "update notification_payload set expires_at=statement_timestamp()-interval '1 second' where notice_id=$1",
      [notice.id],
    );
    loseResponse = false;
    await app().recoverPending();
    expect((await notifications.workspace(headers)).notices[0]).toMatchObject({
      state: "expired",
      providerId: null,
    });
    expect(wire.filter((r) => r.url.endsWith("/emails"))).toHaveLength(1);
    expect(
      (
        await h.admin.query(
          "select count(*)::int as count from notification_payload where notice_id=$1",
          [notice.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it("holds recovery when its private sealing key or original sending key is unavailable", async () => {
    const { headers, notifications } = await prepared(
      "notification-rotation-reviewer@example.com",
    );
    loseResponse = true;
    await requestLink(notifications, "missing-sealing-key@example.com");
    await h.admin.query(
      "update notification_notice set next_attempt_at=NULL where account=$1",
      [config.account],
    );
    loseResponse = false;
    await app({
      vault: notificationVault({
        activeKey: "v2",
        keys: { v2: Buffer.alloc(32, 22) },
      }),
    }).recoverPending();
    expect((await notifications.workspace(headers)).notices[0].state).toBe(
      "held",
    );
    loseResponse = true;
    await requestLink(notifications, "changed-sending-key@example.com");
    await h.admin.query(
      "update notification_notice set next_attempt_at=NULL where account=$1",
      [config.account],
    );
    loseResponse = false;
    await app({
      configuration: { ...config, apiKey: "rotated-fixture-send-key" },
    }).recoverPending();
    const result = await notifications.workspace(headers);
    expect(result.notices.every((n) => n.state === "held")).toBe(true);
    expect(result.pendingReservations).toBe(2);
    expect(wire.filter((r) => r.url.endsWith("/emails"))).toHaveLength(2);
  });

  it("keeps actual acceptance when the delivery lease changes during provider I/O", async () => {
    const { headers, notifications } = await prepared(
      "notification-late-acceptance@example.com",
    );
    beforeSendResult = async () => {
      await h.admin.query(
        "update notification_notice set lease=gen_random_uuid(),lease_until=statement_timestamp()-interval '1 second' where account=$1 and state='sending'",
        [config.account],
      );
    };
    await requestLink(notifications, "late-native-acceptance@example.com");
    expect((await notifications.workspace(headers)).notices[0]).toMatchObject({
      state: "accepted",
      providerId: "e2ee4284-d207-42e0-9e0f-4104546bddae",
    });
    await app().recoverPending();
    expect(wire.filter((r) => r.url.endsWith("/emails"))).toHaveLength(1);
  });

  it("enforces bounded signing-secret rotation, rejects stale Svix timestamps and conflicting event IDs", async () => {
    const { headers, notifications } = await prepared(
      "notification-signature-reviewer@example.com",
    );
    await requestLink(notifications, "signature-private@example.com");
    const oldSecret = `whsec_${Buffer.alloc(32, 33).toString("base64")}`;
    const rotatedAt = new Date(h.clock.now().getTime() - 3600000).toISOString();
    const event = signed(
      "email.delivered",
      "signature-private@example.com",
      "msg_rotated",
      oldSecret,
    );
    const rotated = app({
      configuration: {
        ...config,
        previousWebhookSecret: oldSecret,
        webhookRotatedAt: rotatedAt,
        previousWebhookValidUntil: new Date(
          h.clock.now().getTime() + 3600000,
        ).toISOString(),
      },
    });
    await rotated.receiveWebhook(event.raw, event.headers);
    expect((await notifications.workspace(headers)).notices[0].stage).toBe(
      "delivered",
    );
    const expired = app({
      configuration: {
        ...config,
        previousWebhookSecret: oldSecret,
        webhookRotatedAt: rotatedAt,
        previousWebhookValidUntil: new Date(
          h.clock.now().getTime() - 1,
        ).toISOString(),
      },
    });
    await expect(
      expired.receiveWebhook(event.raw, event.headers),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const altered = signed(
      "email.bounced",
      "signature-private@example.com",
      "msg_rotated",
    );
    await expect(
      notifications.receiveWebhook(altered.raw, altered.headers),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const oldTime = new Date(h.clock.now().getTime() - 600000);
    const stale = signed(
      "email.bounced",
      "signature-private@example.com",
      "msg_stale",
    );
    stale.headers.set(
      "svix-timestamp",
      String(Math.floor(oldTime.getTime() / 1000)),
    );
    stale.headers.set(
      "svix-signature",
      new Webhook(config.webhookSecret).sign("msg_stale", oldTime, stale.raw),
    );
    await expect(
      notifications.receiveWebhook(stale.raw, stale.headers),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app({
        configuration: { ...config, account: "foreign-account" },
      }).receiveWebhook(event.raw, event.headers),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps an earlier ambiguous acceptance reserved when a later retry is rate limited", async () => {
    const { headers, notifications } = await prepared(
      "notification-ambiguity-reviewer@example.com",
    );
    loseResponse = true;
    await requestLink(notifications, "ambiguous-rate-private@example.com");
    const id = (await notifications.workspace(headers)).notices[0].id;
    loseResponse = false;
    rateLimited = true;
    await h.admin.query(
      "update notification_notice set next_attempt_at=NULL where id=$1",
      [id],
    );
    await notifications.retry(headers, id);
    expect((await notifications.workspace(headers)).notices[0].state).toBe(
      "rate_limited",
    );
    expect((await notifications.workspace(headers)).pendingReservations).toBe(
      1,
    );
  });

  it("delivers the current native subscription lifecycle notice once while retaining the original in-app stage", async () => {
    const { headers, notifications } = await prepared(
      "notification-lifecycle-reviewer@example.com",
    );
    h.clock.set("2026-11-05T09:00:00.000Z");
    const fixture = await subscriptionFixture(h),
      native = razorpayFixture(h.clock);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      gateway: configuredPayments({
        ...native.configuration,
        env: {
          ...native.configuration.env,
          SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify({
            id: "notification-fixture-policy",
            version: 1,
            mode: "test",
            reviewedBy: "fixture-operator",
            checkedAt: "2026-11-01T00:00:00Z",
            effectiveFrom: "2026-11-01T00:00:00Z",
            effectiveUntil: "2028-01-01T00:00:00Z",
            evidence: ["fixture:notice-policy"],
            graceSeconds: 86400,
            graceAccess: "remaining_allowance",
            cancellationTiming: "cycle_end",
            cancellationAccess: "paid_through",
            preserveRecords: true,
          }),
        },
      }),
      clock: h.clock,
    });
    await notifications.setPreference(fixture.owner, fixture.business.id, {
      purpose: "subscription",
      enabled: true,
      expectedVersion: 0,
    });
    const action = await payments.prepare(fixture.owner, fixture.business.id, {
      quoteId: fixture.quote.id,
      requestKey: randomUUID(),
    });
    await payments.start(fixture.owner, fixture.business.id, {
      actionId: action.id,
    });
    native.charge(
      "pay_notification",
      "2026-11-05T09:00:00Z",
      "2026-12-05T09:00:00Z",
    );
    await payments.recover();
    const financial = await payments.workspace(
      fixture.owner,
      fixture.business.id,
    );
    expect(financial.actions[0].lifecycle?.state).toBe("active");
    const currentTime = await h.admin.query<{ now: Date }>(
      "select clock_timestamp() as now",
    );
    h.clock.set(currentTime.rows[0].now.toISOString());
    const currentOwner = await h.signIn("tax-owner@example.com");
    await notifications.recoverPending();
    const notices = (
      await notifications.businessWorkspace(currentOwner, fixture.business.id)
    ).notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      purpose: "subscription",
      state: "accepted",
      sourceStage: "payment_active",
    });
    expect(
      (await payments.workspace(currentOwner, fixture.business.id)).actions[0]
        .lifecycleEvents,
    ).toEqual(financial.actions[0].lifecycleEvents);
    await app().recoverPending();
    expect(accepted.size).toBe(1);
    expect(native.creations).toHaveLength(1);
    expect((await notifications.workspace(headers)).notices[0].providerId).toBe(
      "e2ee4284-d207-42e0-9e0f-4104546bddae",
    );
  });

  it("keeps public auth responses generic on native rejection and forbids arbitrary HTTP recipients or bodies", async () => {
    const { headers, notifications } = await prepared(
      "notification-http-reviewer@example.com",
    );
    nativeError = { status: 403, name: "restricted_api_key" };
    expect(
      await requestLink(notifications, "public-auth-failure@example.com"),
    ).toEqual({ status: true });
    expect((await notifications.workspace(headers)).notices[0]).toMatchObject({
      state: "rejected",
      providerId: null,
    });
    const diagnostics: unknown[] = [];
    const http = createNotificationHttp({
      application: notifications,
      origin: config.origin,
      reportFailure: (d) => diagnostics.push(d),
    });
    const json = (input: unknown, origin = config.origin) =>
      new Request(`${config.origin}/api/platform/notifications`, {
        method: "POST",
        headers: {
          ...Object.fromEntries(headers),
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
    expect(
      (
        await http.command(
          json({
            action: "send",
            input: { to: "prospect@example.com", text: "arbitrary" },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.command(
          json({ action: "verify" }, "https://foreign.example"),
        )
      ).status,
    ).toBe(403);
    expect((await http.get(new Request(config.origin))).status).toBe(401);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /prospect@example|private-provider|token=/,
    );
    const raw = signed(
      "email.failed",
      "public-auth-failure@example.com",
      "msg_http_failed",
    );
    expect(
      (
        await http.webhook(
          new Request(`${config.origin}/api/webhooks/resend`, {
            method: "POST",
            headers: raw.headers,
            body: raw.raw,
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("rechecks operator authority after native reads and records incurred invitation acceptance without reviving revoked access", async () => {
    const { headers, notifications } = await prepared(
      "notification-current-authority@example.com",
    );
    const actor = await h.access.primary(headers);
    beforeUsage = async () => {
      await h.admin.query(
        "update platform_operator set notifications=false where user_id=$1",
        [actor.user.id],
      );
    };
    await expect(notifications.refreshSetup(headers)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.admin.query(
      "update platform_operator set notifications=true where user_id=$1",
      [actor.user.id],
    );
    await h.admin.query(
      "update notification_setup set at=statement_timestamp()-interval '1 minute' where account=$1 and setup is null",
      [config.account],
    );
    await notifications.refreshSetup(headers);
    const business = await h.application.createBusiness(headers, {
      name: "Revoked notice Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const team = createTeamApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTeamRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      tokens: invitationTokens("notification-revoke-fixture"),
      mailer: notifications.invitationMailer,
      origin: config.origin,
    });
    beforeSendResult = async () => {
      const current = (await team.getTeam(headers, business.id)).invitations[0];
      await team.revokeInvitation(headers, business.id, {
        invitationId: current.id,
      });
    };
    const invitation = await team.invite(headers, business.id, {
      email: "revoked-during-notice@example.com",
      role: "salesperson",
    });
    expect(invitation.status).toBe("revoked");
    expect(
      (await notifications.businessWorkspace(headers, business.id)).notices[0],
    ).toMatchObject({ state: "accepted", authorityCurrent: false });
    await notifications.recoverPending();
    expect(accepted.size).toBe(1);
  });

  it("holds the original invitation after its persisted native retry guarantee instead of sending a new identity", async () => {
    const { headers, notifications } = await prepared(
      "notification-deadline-reviewer@example.com",
    );
    const business = await h.application.createBusiness(headers, {
      name: "Deadline Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const team = createTeamApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTeamRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      tokens: invitationTokens("notification-deadline-fixture"),
      mailer: notifications.invitationMailer,
      origin: config.origin,
    });
    loseResponse = true;
    await team.invite(headers, business.id, {
      email: "deadline-invite@example.com",
      role: "salesperson",
    });
    loseResponse = false;
    const original = (
      await notifications.businessWorkspace(headers, business.id)
    ).notices[0];
    await h.admin.query(
      "update notification_notice set first_attempt_at=statement_timestamp()-interval '24 hours',retry_until=statement_timestamp()-interval '1 minute',next_attempt_at=NULL where id=$1",
      [original.id],
    );
    await app().recoverPending();
    expect(
      (await notifications.businessWorkspace(headers, business.id)).notices[0],
    ).toMatchObject({ state: "held", reason: "key_or_idempotency_expired" });
    expect(wire.filter((r) => r.url.endsWith("/emails"))).toHaveLength(1);
    expect((await notifications.workspace(headers)).pendingReservations).toBe(
      1,
    );
  });

  it("retains a signed receipt arriving before the native response and never consumes a used auth token on restart", async () => {
    const { headers, notifications } = await prepared(
      "notification-early-receipt@example.com",
    );
    beforeSendResult = async () => {
      const event = signed(
        "email.delivered",
        "early-receipt-private@example.com",
        "msg_early",
      );
      await notifications.receiveWebhook(event.raw, event.headers);
      expect(
        (await notifications.workspace(headers)).notices[0].stage,
      ).toBeNull();
    };
    await requestLink(notifications, "early-receipt-private@example.com");
    expect((await notifications.workspace(headers)).notices[0].stage).toBe(
      "delivered",
    );
    loseResponse = true;
    const auth = createAuth({
      database: runtimeDatabase(h.runtime),
      baseURL: config.origin,
      secret: "fixture-consumed-authentication-secret",
      mailer: notifications.signInMailer,
    });
    await auth.api.signInMagicLink({
      body: { email: "consumed-secret@example.com" },
      headers: new Headers({ origin: config.origin }),
    });
    const mail = wire.filter((r) => r.url.endsWith("/emails")).at(-1)?.body;
    const text = await import("zod").then(
      ({ z }) => z.object({ text: z.string() }).parse(mail).text,
    );
    const url = text.match(/http:\/\/[^\s]+/)?.[0];
    expect(url).toBeDefined();
    const verified = await auth.handler(new Request(url!));
    expect(verified.headers.getSetCookie().length).toBeGreaterThan(0);
    await h.admin.query(
      "update notification_notice set next_attempt_at=NULL where account=$1",
      [config.account],
    );
    loseResponse = false;
    await app().recoverPending();
    expect(
      (await notifications.workspace(headers)).notices.find(
        (n) => n.state === "held",
      )?.reason,
    ).toBe("authority_changed");
    expect(wire.filter((r) => r.url.endsWith("/emails"))).toHaveLength(2);
  });

  it("restricts the explicit test-recipient mode and refreshes stale native evidence only under its current operator delegation", async () => {
    const { headers } = await prepared("notification-test-mode@example.com");
    const restricted = app({
      configuration: {
        ...config,
        mode: "test_recipient",
        testRecipient: "permitted-test@example.com",
      },
    });
    await restricted.refreshSetup(headers);
    await requestLink(restricted, "not-permitted-test@example.com");
    expect(accepted.size).toBe(0);
    await requestLink(restricted, "permitted-test@example.com");
    expect(accepted.size).toBe(1);
    const actor = await h.access.primary(headers);
    await h.admin.query(
      "update notification_setup set at=statement_timestamp()-interval '6 minutes' where account=$1",
      [config.account],
    );
    const before = wire.filter((r) => r.url.endsWith("/usage")).length;
    await restricted.recoverPending();
    expect(wire.filter((r) => r.url.endsWith("/usage")).length).toBe(
      before + 1,
    );
    await h.admin.query(
      "update platform_operator set notifications=false where user_id=$1",
      [actor.user.id],
    );
    await h.admin.query(
      "update notification_setup set at=statement_timestamp()-interval '6 minutes' where account=$1",
      [config.account],
    );
    await restricted.recoverPending();
    expect(wire.filter((r) => r.url.endsWith("/usage")).length).toBe(
      before + 1,
    );
  });

  it("keeps Business SQL views free of global usage, terms and payloads and ignores future caller maintenance timestamps", async () => {
    const { headers, notifications } = await prepared(
        "notification-scope-reviewer@example.com",
      ),
      actor = await h.access.primary(headers);
    const business = await h.application.createBusiness(headers, {
      name: "Minimal notice scope",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    await requestLink(notifications, "retained-auth-secret@example.com");
    const id = (await notifications.workspace(headers)).notices[0].id;
    const result = await runtimeDatabase(h.runtime).transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor_id',${actor.user.id},true),set_config('app.business_id',${business.id},true)`,
      );
      return tx.execute(
        sql`select public.notification_workspace(${config.account},${business.id}::uuid) as value`,
      );
    });
    expect(result.rows[0].value).not.toHaveProperty("terms");
    expect(result.rows[0].value).not.toHaveProperty("pendingReservations");
    expect(result.rows[0].value).not.toHaveProperty("setup");
    await runtimeDatabase(h.runtime).transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.at','2999-01-01T00:00:00Z',true)`,
      );
      await tx.execute(sql`select public.notification_prune()`);
    });
    expect(
      (
        await h.admin.query(
          "select count(*)::int as count from notification_payload where notice_id=$1",
          [id],
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it("retains historical uncertainty without charging an expired prior-period dispatch to today's quota", async () => {
    dailyUsed = 99;
    const { headers, notifications } = await prepared(
      "notification-window-reviewer@example.com",
    );
    loseResponse = true;
    await requestLink(notifications, "prior-period-secret@example.com");
    loseResponse = false;
    const id = (await notifications.workspace(headers)).notices[0].id;
    await h.admin.query(
      "update notification_notice set first_attempt_at=statement_timestamp()-interval '2 months',expires_at=statement_timestamp()-interval '1 month',state='expired' where id=$1",
      [id],
    );
    await h.admin.query(
      "update notification_event set at=statement_timestamp()-interval '2 months' where notice_id=$1",
      [id],
    );
    await requestLink(notifications, "current-period-secret@example.com");
    expect(accepted.size).toBe(2);
    expect((await notifications.workspace(headers)).pendingReservations).toBe(
      1,
    );
  });

  it.each([
    { status: 409, name: "concurrent_idempotent_requests", state: "uncertain" },
    { status: 409, name: "invalid_idempotent_request", state: "held" },
    { status: 503, name: "service_unavailable", state: "uncertain" },
    { status: 422, name: "validation_error", state: "rejected" },
  ])(
    "classifies native $name without changing the original identity",
    async ({ status, name, state }) => {
      const { headers, notifications } = await prepared(
        `notification-error-${name}@example.com`,
      );
      nativeError = { status, name };
      await requestLink(notifications, "classified-error-private@example.com");
      const notice = (await notifications.workspace(headers)).notices[0];
      expect(notice.state).toBe(state);
      expect(notice.providerId).toBeNull();
      expect(accepted.size).toBe(0);
      expect(JSON.stringify(notice)).not.toContain(
        "private-provider-secret-body",
      );
      expect(wire.filter((r) => r.url.endsWith("/emails"))[0].key).toMatch(
        /^authentication\//,
      );
    },
  );
  it("notifies the Business manager and a sender-health-only operator from the current persisted incident", async () => {
    const { headers, notifications } = await prepared(
      "notice-health-business@example.com",
    );
    const operator = await h.signIn("notice-health-operator@example.com"),
      actor = await h.access.primary(operator);
    await h.admin.query(
      "insert into platform_operator(user_id,sender_health,notifications) values($1,true,true)",
      [actor.user.id],
    );
    const business = await h.application.createBusiness(headers, {
      name: "Health notice Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const database = runtimeDatabase(h.runtime),
      inbox = createInboxApplication({
        authenticate: h.authenticate,
        repository: createInboxRepository(database),
        adapter: normalizedInquiryAdapter,
        clock: h.clock,
      });
    const connection = await inbox.addConnection(headers, business.id, {
      label: "Selected sales",
      channel: "email",
      conversationRefs: ["sales"],
      manualRepliesObservable: false,
    });
    const sender = await readySender(h, headers, business.id, connection.id);
    const health = createSenderHealthApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderHealthRepository(database, h.clock),
    });
    const rule = { unit: "rate", limit: 0.05, minimumSample: 10 };
    await health.configure(operator, business.id, sender.identity.id, {
      expectedVersion: 0,
      policy: {
        source: "assisted_review",
        sourceAuthority:
          "Fixture provider report reviewed by authorized support",
        sourceOrigin: "https://evidence.example",
        population: "Exact sender submissions in the fixture window",
        windowSeconds: 3600,
        freshnessSeconds: 3600,
        maximumLatenessSeconds: 600,
        retentionDays: 30,
        thresholds: {
          spf: rule,
          dkim: rule,
          dmarc_alignment: rule,
          bounces: rule,
          complaints: rule,
        },
      },
    });
    await notifications.setPreference(headers, business.id, {
      purpose: "operations",
      enabled: true,
      expectedVersion: 0,
    });
    await notifications.setPreference(operator, null, {
      purpose: "operations",
      enabled: true,
      expectedVersion: 0,
    });
    const binding = (await health.workspace(operator, business.id, true))
      .identities[0].binding;
    await health.ingest(operator, business.id, sender.identity.id, {
      eventKey: "native-report-fixture",
      policyVersion: 1,
      binding,
      observedAt: h.clock.now().toISOString(),
      windowStart: new Date(h.clock.now().getTime() - 3600000).toISOString(),
      windowEnd: h.clock.now().toISOString(),
      reference: "https://evidence.example/reports/notice",
      artifactSha256: "a".repeat(64),
      metrics: {
        spf: { failed: 0, total: 100 },
        dkim: { failed: 0, total: 100 },
        dmarc_alignment: { failed: 0, total: 100 },
        bounces: { failed: 6, total: 100 },
        complaints: { failed: 0, total: 100 },
      },
      repairs: [],
    });
    await notifications.recoverPending();
    expect(
      (await notifications.businessWorkspace(headers, business.id)).notices,
    ).toEqual([
      expect.objectContaining({ sourceStage: "incident", state: "accepted" }),
    ]);
    expect(
      (await notifications.workspace(operator)).notices.filter(
        (n) => n.sourceStage === "incident",
      ),
    ).toHaveLength(2);
    expect(accepted.size).toBe(2);
    expect(JSON.stringify([...accepted.values()])).toContain(
      "/platform/sender-health",
    );
    await notifications.recoverPending();
    expect(accepted.size).toBe(2);
  });
  it("bootstraps native auth-only setup with owner authority without granting MFA or enabling platform sends", async () => {
    const primary = await h.signIn(
        "notice-bootstrap-operator@example.com",
        false,
      ),
      actor = await h.access.primary(primary);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [actor.user.id],
    );
    const terms = {
      kind: "free" as const,
      reference: "Explicit deployment-owned auth bootstrap terms",
      monthlyLimit: 3000,
      dailyLimit: 100,
      amount: null,
    };
    await expect(
      bootstrapNotificationSetup({
        owner: h.runtime,
        configuration: config,
        approverId: actor.user.id,
        terms,
        provider: createResendProvider(config, nativeFetch),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await bootstrapNotificationSetup({
      owner: h.admin,
      configuration: config,
      approverId: actor.user.id,
      terms,
      provider: createResendProvider(config, nativeFetch),
    });
    const notifications = app();
    await requestLink(notifications, "notice-bootstrap-operator@example.com");
    expect(accepted.size).toBe(1);
    expect(await h.access.status(primary)).toMatchObject({
      required: true,
      readiness: "mfa-incomplete",
    });
    await expect(notifications.workspace(primary)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    const verified = await h.signIn("notice-bootstrap-operator@example.com");
    expect((await notifications.workspace(verified)).bootstrapAuthOnly).toBe(
      true,
    );
    const business = await h.application.createBusiness(verified, {
      name: "Bootstrap fence Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const team = createTeamApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTeamRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      tokens: invitationTokens("notification-bootstrap-fixture"),
      mailer: notifications.invitationMailer,
      origin: config.origin,
    });
    const invitation = await team.invite(verified, business.id, {
      email: "bootstrap-invitation@example.com",
      role: "salesperson",
    });
    expect(invitation.delivery).toBe("unconfirmed");
    expect(accepted.size).toBe(1);
    await notifications.selectTerms(verified, terms);
    expect((await notifications.workspace(verified)).bootstrapAuthOnly).toBe(
      false,
    );
    const notice = (
      await notifications.businessWorkspace(verified, business.id)
    ).notices[0];
    await notifications.retry(verified, notice.id);
    expect(
      (await notifications.businessWorkspace(verified, business.id)).notices[0]
        .state,
    ).toBe("accepted");
    expect(accepted.size).toBe(2);
  });

  it("rechecks invitation session assurance after native I/O while retaining the incurred provider receipt", async () => {
    const { headers, notifications } = await prepared(
        "notice-invitation-assurance@example.com",
      ),
      current = h.clock.now();
    const business = await h.application.createBusiness(headers, {
      name: "Assurance Business",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const team = createTeamApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTeamRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      tokens: invitationTokens("notification-assurance-fixture"),
      mailer: notifications.invitationMailer,
      origin: config.origin,
    });
    beforeSendResult = async () => {
      h.clock.set(new Date(current.getTime() + 13 * 3600000).toISOString());
    };
    await expect(
      team.invite(headers, business.id, {
        email: "assurance-invitation@example.com",
        role: "salesperson",
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    h.clock.set(current.toISOString());
    expect(
      (await notifications.businessWorkspace(headers, business.id)).notices[0],
    ).toMatchObject({
      state: "accepted",
      providerId: "e2ee4284-d207-42e0-9e0f-4104546bddae",
    });
    expect(accepted.size).toBe(1);
  });
});
