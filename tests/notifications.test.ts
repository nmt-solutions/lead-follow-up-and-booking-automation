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
        id: config.domainId,
        name: "platform.example",
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
    const time = await h.admin.query<{ now: Date }>(
      "select clock_timestamp() as now",
    );
    h.clock.set(time.rows[0].now.toISOString());
  });
  const app = () =>
    createNotificationApplication({
      authenticatePlatform: h.access.authenticatePlatform,
      authenticate: h.authenticate,
      repository: createNotificationRepository(runtimeDatabase(h.runtime)),
      provider: createResendProvider(config, nativeFetch),
      vault: notificationVault({
        activeKey: "v1",
        keys: { v1: Buffer.alloc(32, 11) },
      }),
      configuration: config,
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
});
