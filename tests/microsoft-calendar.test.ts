import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createMicrosoftCalendarApplication } from "../src/application/microsoft-calendar";
import { microsoftFixture } from "./support/microsoft-calendar";
import { createMicrosoftCalendarHttp } from "../src/http/microsoft-calendar";
import { configuredMicrosoftCalendar } from "../src/microsoft-calendar/configuration";

describe("Business Microsoft Calendar grants through real persistence", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`microsoft-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Calendar Business",
      offering: "Consultation",
      homeMarket: "US",
      website: "",
    });
    const microsoft = microsoftFixture(h.clock);
    const application = createMicrosoftCalendarApplication({
      database: runtimeDatabase(h.runtime),
      access: h.access,
      clock: h.clock,
      configuration: microsoft.configuration,
      fetch: microsoft.fetch,
    });
    return { credentials, business, microsoft, application };
  }
  async function connect(f: Awaited<ReturnType<typeof fixture>>) {
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    f.microsoft.control.nonce = new URL(
      start.authorizationUrl,
    ).searchParams.get("nonce")!;
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    return f.application.select(f.credentials, f.business.id, {
      calendarId: "primary",
    });
  }
  it("binds consent to actor, Business and session, consumes state once, encrypts tokens and selects only an authorized calendar", async () => {
    const f = await fixture();
    expect(
      (await f.application.read(f.credentials, f.business.id)).status,
    ).toBe("not_connected");
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    const url = new URL(start.authorizationUrl);
    f.microsoft.control.nonce = url.searchParams.get("nonce")!;
    expect(url.searchParams.get("scope")).not.toMatch(/gmail|mail\.read/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const callback = {
      state: url.searchParams.get("state"),
      code: "fixture-code",
    };
    const result = await f.application.callback(
      f.credentials,
      f.business.id,
      callback,
    );
    expect(result.returnPath).toBe(`/businesses/${f.business.id}/calendar`);
    const state = await f.application.read(f.credentials, f.business.id);
    expect(state).toMatchObject({
      status: "selection_required",
      accountEmail: "calendar@outlook.com",
    });
    expect(JSON.stringify(state)).not.toMatch(
      /fixture-access|fixture-refresh|client_secret/,
    );
    await expect(
      f.application.callback(f.credentials, f.business.id, callback),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      f.application.select(f.credentials, f.business.id, {
        calendarId: "foreign",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const ready = await f.application.select(f.credentials, f.business.id, {
      calendarId: "primary",
    });
    expect(ready).toMatchObject({
      status: "ready",
      selectedCalendarId: "primary",
    });
    const stored = await h.admin.query(
      "select credentials from microsoft_calendar_grant where business_id = $1",
      [f.business.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain("fixture-refresh");
    expect(
      f.microsoft.calls.filter((c) => c.url.endsWith("/token")),
    ).toHaveLength(1);
  });

  it("denies unsafe returns, cross-Business, wrong actor/session, expired or superseded state without exchanging a code", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      f.application.start(f.credentials, f.business.id, {
        returnPath: "//evil.example",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const first = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    const input = {
      state: new URL(first.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    };
    await expect(
      f.application.callback(other.credentials, f.business.id, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.application.callback(other.credentials, other.business.id, input),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const actor = await h.authenticate(f.credentials);
    const anotherSession = await h.signIn(
      (await h.auth.api.getSession({ headers: f.credentials }))!.user.email,
    );
    await expect(
      f.application.callback(anotherSession, f.business.id, input),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const fresh = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    await expect(
      f.application.callback(f.credentials, f.business.id, input),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    h.clock.set("2026-11-05T09:11:00Z");
    await expect(
      f.application.callback(f.credentials, f.business.id, {
        state: new URL(fresh.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(f.microsoft.calls).toHaveLength(0);
    expect(actor.userId).toBeTruthy();
  });
  it("requires current integration role and verified MFA for consent, callbacks, reads and revocation", async () => {
    const f = await fixture();
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    const actor = await h.authenticate(f.credentials);
    await h.admin.query(
      "update membership set role = 'salesperson' where user_id = $1 and business_id = $2",
      [actor.userId, f.business.id],
    );
    await expect(
      f.application.read(f.credentials, f.business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.application.callback(f.credentials, f.business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      f.application.disconnect(f.credentials, f.business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.admin.query(
      "update membership set role = 'owner' where user_id = $1 and business_id = $2",
      [actor.userId, f.business.id],
    );
    h.clock.set("2026-11-05T22:00:00Z");
    await expect(
      f.application.start(f.credentials, f.business.id, {
        returnPath: `/businesses/${f.business.id}/calendar`,
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(f.microsoft.calls).toHaveLength(0);
  });
  it("does not grant calendar capability from mail-only or partial consent and consumes denied callbacks", async () => {
    const f = await fixture();
    f.microsoft.control.scopes = "openid email Mail.Send";
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    f.microsoft.control.nonce = new URL(
      start.authorizationUrl,
    ).searchParams.get("nonce")!;
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({
      status: "insufficient",
      selectedCalendarId: null,
      calendars: [],
    });
    await expect(
      f.application.select(f.credentials, f.business.id, {
        calendarId: "primary",
      }),
    ).rejects.toMatchObject({ code: "CALENDAR_SETUP_REQUIRED" });
    const retry = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    const denied = {
      state: new URL(retry.authorizationUrl).searchParams.get("state"),
      error: "access_denied",
    };
    await f.application.callback(f.credentials, f.business.id, denied);
    expect(
      (await f.application.read(f.credentials, f.business.id)).reason,
    ).toBe("consent_denied");
    await expect(
      f.application.callback(f.credentials, f.business.id, denied),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("refreshes once under concurrent reads, retains rotated refresh tokens and blocks after revocation", async () => {
    const f = await fixture();
    await connect(f);
    h.clock.set("2026-11-05T10:00:01Z");
    await Promise.all([
      f.application.read(f.credentials, f.business.id),
      f.application.read(f.credentials, f.business.id),
    ]);
    expect(f.microsoft.control.refreshes).toBe(1);
    h.clock.set("2026-11-05T11:00:02Z");
    f.microsoft.control.tokenError = 400;
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({
      status: "reconnect_required",
      reason: "revoked",
      calendars: [],
    });
    const refreshCalls = f.microsoft.calls.filter((c) =>
      c.url.endsWith("/token"),
    );
    expect(refreshCalls.at(-1)?.body).toMatchObject({
      refresh_token: "fixture-refresh-rotated",
    });
    const count = refreshCalls.length;
    await f.application.read(f.credentials, f.business.id);
    expect(
      f.microsoft.calls.filter((c) => c.url.endsWith("/token")),
    ).toHaveLength(count);
  });

  it.each(["badSignature", "badIssuer", "wrongNonce"] as const)(
    "rejects untrusted Microsoft identity %s without adopting credentials",
    async (failure) => {
      const f = await fixture();
      f.microsoft.control[failure] = true;
      const start = await f.application.start(f.credentials, f.business.id, {
        returnPath: `/businesses/${f.business.id}/calendar`,
      });
      f.microsoft.control.nonce = new URL(
        start.authorizationUrl,
      ).searchParams.get("nonce")!;
      await f.application.callback(f.credentials, f.business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      expect(
        await f.application.read(f.credentials, f.business.id),
      ).toMatchObject({
        status: "insufficient",
        calendars: [],
        accountKind: null,
      });
    },
  );
  it("derives account class from trusted tenant provenance, excludes unsupported calendars, and preserves account identity on reconnect", async () => {
    const f = await fixture();
    f.microsoft.control.tenant = "11111111-2222-4333-8444-555555555555";
    // An Outlook email address in a signed workforce tenant must not choose the personal path.
    const work = await connect(f);
    expect(work).toMatchObject({
      accountKind: "microsoft_work",
      calendars: [{ id: "primary" }],
    });
    await expect(
      f.application.select(f.credentials, f.business.id, {
        calendarId: "secondary",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const retry = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    f.microsoft.control.subject = "substituted-account";
    f.microsoft.control.nonce = new URL(
      retry.authorizationUrl,
    ).searchParams.get("nonce")!;
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(retry.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({ status: "insufficient", accountKind: "microsoft_work" });
    const personal = await fixture();
    await connect(personal);
    expect(
      (
        await personal.application.select(
          personal.credentials,
          personal.business.id,
          { calendarId: "secondary" },
        )
      ).selectedCalendarId,
    ).toBe("secondary");
    personal.microsoft.control.shared = true;
    expect(
      await personal.application.read(
        personal.credentials,
        personal.business.id,
      ),
    ).toMatchObject({
      status: "insufficient",
      calendars: [],
      reason: "calendar_access_lost",
    });
  });
  it("rejects guest capability and requires recent MFA for security changes", async () => {
    const f = await fixture();
    f.microsoft.control.acct = 1;
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    f.microsoft.control.nonce = new URL(
      start.authorizationUrl,
    ).searchParams.get("nonce")!;
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    expect(
      (await f.application.read(f.credentials, f.business.id)).status,
    ).toBe("insufficient");
    h.clock.set("2026-11-05T09:16:00Z");
    await expect(
      f.application.disconnect(f.credentials, f.business.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
  it("deletes credentials locally without claiming remote revocation, invalidates pending callbacks and keeps forced RLS on schema reapply", async () => {
    const f = await fixture();
    await connect(f);
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    expect(
      await f.application.disconnect(f.credentials, f.business.id),
    ).toMatchObject({
      status: "disconnected",
      reason: "provider_consent_remains",
    });
    await expect(
      f.application.callback(f.credentials, f.business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(
      (
        await h.admin.query(
          "select credentials from microsoft_calendar_grant where business_id=$1",
          [f.business.id],
        )
      ).rows[0].credentials,
    ).toBeNull();
    expect(
      (await h.runtime.query("select * from microsoft_calendar_grant")).rows,
    ).toEqual([]);
    await expect(
      h.runtime.query("delete from microsoft_calendar_grant"),
    ).rejects.toThrow();
    await expect(
      h.runtime.query("update microsoft_calendar_oauth set verifier='bad'"),
    ).rejects.toThrow();
    await h.reapplySchema();
    expect(
      (await f.application.read(f.credentials, f.business.id)).status,
    ).toBe("disconnected");
    expect(f.microsoft.calls.some((c) => /revoke|Mail\./.test(c.url))).toBe(
      false,
    );
  });
  it("serializes disconnect behind a refresh without resurrecting credentials", async () => {
    const f = await fixture();
    await connect(f);
    h.clock.set("2026-11-05T10:00:01Z");
    // Refresh is a read (normal Business MFA lifetime); refresh MFA before the security mutation.
    const actor = await h.access.authenticateForWork(f.credentials);
    await h.admin.query("update session set mfa_verified_at=$1 where id=$2", [
      h.clock.now(),
      actor.sessionId,
    ]);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
      enter = r;
    });
    const waiting = new Promise<void>((r) => {
      release = r;
    });
    f.microsoft.control.beforeRefresh = async () => {
      enter();
      await waiting;
    };
    const refresh = f.application.read(f.credentials, f.business.id);
    await entered;
    const disconnect = f.application.disconnect(f.credentials, f.business.id);
    release();
    await refresh;
    expect(await disconnect).toMatchObject({ status: "disconnected" });
    expect(
      (
        await h.admin.query(
          "select credentials from microsoft_calendar_grant where business_id=$1",
          [f.business.id],
        )
      ).rows[0].credentials,
    ).toBeNull();
  });
  it("keeps missing configuration unavailable and validates HTTP origin/callback data with safe diagnostics", async () => {
    const f = await fixture();
    const unavailable = createMicrosoftCalendarApplication({
      database: runtimeDatabase(h.runtime),
      access: h.access,
      clock: h.clock,
      configuration: null,
      fetch: f.microsoft.fetch,
    });
    expect(await unavailable.read(f.credentials, f.business.id)).toMatchObject({
      configured: false,
      status: "not_connected",
    });
    await expect(
      unavailable.start(f.credentials, f.business.id, {
        returnPath: `/businesses/${f.business.id}/calendar`,
      }),
    ).rejects.toMatchObject({ code: "CALENDAR_SETUP_REQUIRED" });
    expect(configuredMicrosoftCalendar({})).toBeNull();
    const diagnostics: unknown[] = [];
    const http = createMicrosoftCalendarHttp({
      application: f.application,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const headers = new Headers(f.credentials);
    headers.set("origin", "https://foreign.example");
    headers.set("Content-Type", "application/json");
    expect(
      (
        await http.start(
          new Request("http://localhost:3000/start", {
            method: "POST",
            headers,
            body: "{}",
          }),
          f.business.id,
        )
      ).status,
    ).toBe(403);
    const bad = await http.callback(
      new Request(
        "http://localhost:3000/callback?state=secret&code=sensitive-code",
        { headers: f.credentials },
      ),
      f.business.id,
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).not.toContain("sensitive-code");
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /sensitive-code|fixture-client-secret/,
    );
  });
  it.each([429, 503])(
    "keeps Microsoft identity HTTP %i distinct from missing permission",
    async (status) => {
      const f = await fixture();
      const start = await f.application.start(f.credentials, f.business.id, {
        returnPath: `/businesses/${f.business.id}/calendar`,
      });
      f.microsoft.control.nonce = new URL(
        start.authorizationUrl,
      ).searchParams.get("nonce")!;
      f.microsoft.control.apiError = status;
      await f.application.callback(f.credentials, f.business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      });
      expect(
        await f.application.read(f.credentials, f.business.id),
      ).toMatchObject({
        status: "reconnect_required",
        reason: status === 429 ? "rate_limited" : "unavailable",
      });
    },
  );
  it("rejects an expired signed identity using the controlled clock", async () => {
    const f = await fixture();
    f.microsoft.control.expiredIdentity = true;
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    f.microsoft.control.nonce = new URL(
      start.authorizationUrl,
    ).searchParams.get("nonce")!;
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({ status: "insufficient", accountKind: null });
  });
});
