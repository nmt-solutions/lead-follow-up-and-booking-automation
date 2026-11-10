import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { gmailFixture } from "./support/gmail";
import { microsoftMailFixture } from "./support/microsoft-mail";
import { runtimeDatabase } from "../src/db/runtime";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";
import { createGmailApplication } from "../src/application/gmail";
import { createGmailConnection } from "../src/gmail/connection";
import { createMicrosoftMailApplication } from "../src/application/microsoft-mail";
import { createMicrosoftMailConnection } from "../src/microsoft-mail/connection";
import { createEmailSetup } from "../src/application/email-setup";
import { gmailReadScope, gmailSendScope } from "../src/models/gmail";
import { isPendingEmailAccount } from "../src/models/email-setup";
import { configuredGmail } from "../src/gmail/configuration";
import { configuredMicrosoftMail } from "../src/microsoft-mail/configuration";
import { configuredGoogleCalendar } from "../src/google-calendar/configuration";
import { configuredMicrosoftCalendar } from "../src/microsoft-calendar/configuration";
import {
  setOAuthContext,
  readOAuthContext,
  clearOAuthContext,
} from "../src/http/oauth-context";

describe("consent-first email setup", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture(configured = true) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`connect-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Supplier",
      offering: "Office furniture",
      homeMarket: "India",
      website: "",
    });
    const database = runtimeDatabase(h.runtime);
    const senders = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(database, h.clock),
      adapter: unavailableSenderAdapter,
      clock: h.clock,
    });
    const mailboxes = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider: unavailableMailboxProvider,
      clock: h.clock,
    });
    const google = gmailFixture();
    google.configuration.redirectPath = "/api/connections/gmail/callback";
    google.control.scopes = `openid email ${gmailReadScope} ${gmailSendScope}`;
    const microsoft = microsoftMailFixture(h.clock);
    microsoft.configuration.redirectPath =
      "/api/connections/microsoft/callback";
    microsoft.identity.scopes += " Mail.Send";
    const queueInitialSync = vi.fn(async () => undefined);
    const gmail = createGmailApplication({
      access: h.access,
      connection: createGmailConnection(database, {
        clock: h.clock,
        configuration: google.configuration,
        fetch: google.fetch,
      }),
      queueInitialSync,
    });
    const outlook = createMicrosoftMailApplication({
      access: h.access,
      connection: createMicrosoftMailConnection(database, {
        clock: h.clock,
        configuration: microsoft.configuration,
        fetch: microsoft.fetch,
      }),
      queueInitialSync,
    });
    const setup = createEmailSetup({
      mailboxes,
      senders,
      providers: {
        gmail: { configured, start: gmail.start },
        microsoft: { configured, start: outlook.start },
      },
    });
    return {
      credentials,
      business,
      mailboxes,
      senders,
      google,
      microsoft,
      gmail,
      outlook,
      setup,
      queueInitialSync,
    };
  }
  it.each(["gmail", "microsoft"] as const)(
    "connects %s from provider consent without entering an address or creating identities manually",
    async (provider) => {
      const f = await fixture();
      const started = await f.setup.start(f.credentials, f.business.id, {
        provider,
      });
      const url = new URL(started.authorizationUrl);
      expect(url.searchParams.has("login_hint")).toBe(false);
      expect(url.searchParams.get("redirect_uri")).toBe(
        `http://localhost:3000/api/connections/${provider}/callback`,
      );
      expect(url.searchParams.get("scope")).toContain(
        provider === "gmail" ? gmailSendScope : "Mail.Send",
      );
      const before = await f.mailboxes.workspace(f.credentials, f.business.id);
      expect(isPendingEmailAccount(before.mailboxes[0].account)).toBe(true);
      expect(before.mailboxes[0].configuration).toMatchObject({
        requestedRead: true,
        requestedSend: true,
        scope: { kind: "mailbox" },
        history: null,
      });
      f.microsoft.identity.nonce = url.searchParams.get("nonce") ?? "";
      const app = provider === "gmail" ? f.gmail : f.outlook;
      const input = {
        state: url.searchParams.get("state"),
        code: "fixture-code",
      };
      await app.callback(
        f.credentials,
        f.business.id,
        started.mailboxId,
        input,
      );
      expect(
        await app.read(f.credentials, f.business.id, started.mailboxId),
      ).toMatchObject({
        status: "connected",
        account: "sales@supplier.example",
        read: true,
        send: true,
      });
      const after = await f.mailboxes.workspace(f.credentials, f.business.id);
      expect(after.connections).toHaveLength(1);
      expect(after.connections[0].account).toBe("sales@supplier.example");
      expect(after.mailboxes[0].configuration.history).toBeNull();
      const sender = await f.senders.workspace(f.credentials, f.business.id);
      expect(sender.replyRoutes).toHaveLength(1);
      expect(sender.identities).toHaveLength(1);
      expect(sender.identities[0].configuration).toMatchObject({
        purpose: "ordinary_sales",
        fromAddress: "sales@supplier.example",
        displayName: "Supplier",
        uses: ["inbound", "existing_conversation"],
      });
      expect(f.queueInitialSync).toHaveBeenCalledOnce();
      expect(f.google.sends).toHaveLength(0);
      expect(f.microsoft.sends).toHaveLength(0);
      await expect(
        app.callback(f.credentials, f.business.id, started.mailboxId, input),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    },
  );
  it("reuses an incomplete connection after declined consent and does not create a sending identity", async () => {
    const f = await fixture();
    const first = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    await f.gmail.callback(f.credentials, f.business.id, first.mailboxId, {
      state: new URL(first.authorizationUrl).searchParams.get("state"),
      error: "access_denied",
    });
    const second = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    expect(second.mailboxId).toBe(first.mailboxId);
    expect(
      (await f.mailboxes.workspace(f.credentials, f.business.id)).connections,
    ).toHaveLength(1);
    expect(
      (await f.senders.workspace(f.credentials, f.business.id)).identities,
    ).toHaveLength(0);
    expect(f.queueInitialSync).not.toHaveBeenCalled();
  });
  it("rejects another actor's callback and preserves the original actor's consent", async () => {
    const f = await fixture();
    const started = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    const input = {
      state: new URL(started.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    };
    const other = await h.signIn(`other-${randomUUID()}@example.com`);
    await expect(
      f.gmail.callback(other, f.business.id, started.mailboxId, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await f.gmail.callback(
      f.credentials,
      f.business.id,
      started.mailboxId,
      input,
    );
    expect(
      (await f.gmail.read(f.credentials, f.business.id, started.mailboxId))
        .account,
    ).toBe("sales@supplier.example");
  });
  it("does not overwrite an existing connected account when consent selects the same email twice", async () => {
    const f = await fixture();
    const first = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    await f.gmail.callback(f.credentials, f.business.id, first.mailboxId, {
      state: new URL(first.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    const second = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    await expect(
      f.gmail.callback(f.credentials, f.business.id, second.mailboxId, {
        state: new URL(second.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await f.gmail.read(f.credentials, f.business.id, first.mailboxId))
        .status,
    ).toBe("connected");
    expect(
      (await f.senders.workspace(f.credentials, f.business.id)).identities,
    ).toHaveLength(1);
  });
  it("does not create draft mailboxes for an unavailable provider", async () => {
    const f = await fixture(false);
    await expect(
      f.setup.start(f.credentials, f.business.id, { provider: "gmail" }),
    ).rejects.toMatchObject({ code: "CHANNEL_SETUP_REQUIRED" });
    expect(
      (await f.mailboxes.workspace(f.credentials, f.business.id)).connections,
    ).toHaveLength(0);
  });
  it("keeps successful consent when initial synchronization is unavailable", async () => {
    const f = await fixture();
    f.queueInitialSync.mockRejectedValueOnce(new Error("worker unavailable"));
    const started = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    await expect(
      f.gmail.callback(f.credentials, f.business.id, started.mailboxId, {
        state: new URL(started.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).resolves.toMatchObject({
      returnPath: `/businesses/${f.business.id}/mailboxes`,
    });
    expect(
      await f.gmail.read(f.credentials, f.business.id, started.mailboxId),
    ).toMatchObject({ status: "connected", read: true, send: true });
    expect(
      (await f.mailboxes.workspace(f.credentials, f.business.id)).mailboxes[0]
        .visibility,
    ).toBe("unsafe");
    expect(f.google.sends).toHaveLength(0);
  });
  it("keeps the database identity guard after schema/security reapply and rejects renaming a connected mailbox", async () => {
    const f = await fixture();
    const started = await f.setup.start(f.credentials, f.business.id, {
      provider: "gmail",
    });
    await f.gmail.callback(f.credentials, f.business.id, started.mailboxId, {
      state: new URL(started.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    await h.reapplySchema();
    const actor = await h.access.authenticateForWork(f.credentials);
    const client = await h.runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "select set_config('app.actor_id',$1,true), set_config('app.business_id',$2,true), set_config('app.pilot_session',$3,true)",
        [actor.userId, f.business.id, actor.sessionId],
      );
      await expect(
        client.query(
          "update public.mailbox_policy set account=$1 where id=$2",
          ["changed@example.com", started.mailboxId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(
      (await f.gmail.read(f.credentials, f.business.id, started.mailboxId))
        .account,
    ).toBe("sales@supplier.example");
  });
});

describe("fixed callback routing", () => {
  it("keeps legacy callbacks by default and enables each shared callback independently after registration", () => {
    const env: Record<string, string> = {
      BETTER_AUTH_URL: "https://app.example",
    };
    for (const prefix of [
      "GMAIL",
      "MICROSOFT_MAIL",
      "GOOGLE_CALENDAR",
      "MICROSOFT_CALENDAR",
    ]) {
      Object.assign(env, {
        [`${prefix}_CLIENT_ID`]: "fixture",
        [`${prefix}_CLIENT_SECRET`]: "fixture-secret",
        [`${prefix}_TOKEN_KEY_ID`]: "test",
        [`${prefix}_TOKEN_KEYS`]: JSON.stringify({ test: "ab".repeat(32) }),
        [`${prefix}_APPROVED`]: "true",
        [`${prefix}_OAUTH_APPROVED`]: "true",
        [`${prefix}_PRODUCTION_PREREQUISITES_CONFIRMED`]: "true",
      });
    }
    for (const [prefix, configure, provider] of [
      ["GMAIL", configuredGmail, "gmail"],
      ["MICROSOFT_MAIL", configuredMicrosoftMail, "microsoft"],
      ["GOOGLE_CALENDAR", configuredGoogleCalendar, "google-calendar"],
      ["MICROSOFT_CALENDAR", configuredMicrosoftCalendar, "microsoft-calendar"],
    ] as const) {
      expect(configure(env)).not.toBeNull();
      expect(configure(env)?.redirectPath).toBeUndefined();
      expect(
        configure({ ...env, [`${prefix}_FIXED_CALLBACK_ENABLED`]: "true" })
          ?.redirectPath,
      ).toBe(`/api/connections/${provider}/callback`);
    }
    expect(
      configuredGmail({
        ...env,
        GOOGLE_CALENDAR_FIXED_CALLBACK_ENABLED: "true",
      })?.redirectPath,
    ).toBeUndefined();
  });
  it("keeps parallel consent contexts separate and uses short-lived, callback-only cookies", () => {
    const businessId = randomUUID(),
      mailboxId = randomUUID();
    const states = ["a".repeat(64), "b".repeat(64)];
    const cookies = states.map((state) => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        state,
        redirect_uri: "https://app.example/api/connections/gmail/callback",
      }).toString();
      const result = setOAuthContext(new Response(), url.toString(), "gmail", {
        businessId,
        mailboxId,
        onboarding: state === states[0],
      });
      const cookie = result.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=600; Secure");
      expect(cookie).toContain("Path=/api/connections/gmail/callback");
      return cookie.split(";")[0];
    });
    for (const state of states) {
      const request = new Request(
        `https://app.example/api/connections/gmail/callback?state=${state}&code=code`,
        { headers: { cookie: cookies.join("; ") } },
      );
      const context = readOAuthContext(request, "gmail");
      expect(context).toMatchObject({
        businessId,
        mailboxId,
        onboarding: state === states[0],
      });
      expect(
        clearOAuthContext(
          new Response(),
          "gmail",
          context.cookieName,
          "https://app.example",
        ).headers.get("set-cookie"),
      ).toContain("Max-Age=0");
    }
  });
  it("rejects missing, malformed, duplicate or cross-provider callback context", () => {
    for (const query of [
      "state=invalid",
      `state=${"a".repeat(64)}`,
      `state=${"a".repeat(64)}&state=${"b".repeat(64)}`,
    ])
      expect(() =>
        readOAuthContext(
          new Request(
            `https://app.example/api/connections/gmail/callback?${query}`,
          ),
          "gmail",
        ),
      ).toThrow();
  });
});
