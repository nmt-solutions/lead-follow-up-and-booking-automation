import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import type { Transaction } from "../src/db/scope";
import { runtimeDatabase } from "../src/db/runtime";
import { createGoogleCalendarApplication } from "../src/application/google-calendar";
import { googleFixture } from "./support/google-calendar";
import { createGoogleCalendarHttp } from "../src/http/google-calendar";
import { configuredGoogleCalendar } from "../src/google-calendar/configuration";

describe("Business Google Calendar grants through real persistence", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  async function fixture() {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`google-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Calendar Business",
      offering: "Consultation",
      homeMarket: "US",
      website: "",
    });
    const google = googleFixture();
    const application = createGoogleCalendarApplication({
      database: runtimeDatabase(h.runtime),
      access: h.access,
      clock: h.clock,
      configuration: google.configuration,
      fetch: google.fetch,
    });
    return { credentials, business, google, application };
  }
  async function connect(f: Awaited<ReturnType<typeof fixture>>) {
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    return f.application.select(f.credentials, f.business.id, {
      calendarId: "dedicated@example.com",
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
      accountEmail: "calendar@example.com",
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
      calendarId: "dedicated@example.com",
    });
    expect(ready).toMatchObject({
      status: "ready",
      selectedCalendarId: "dedicated@example.com",
    });
    const stored = await h.admin.query(
      "select credentials from google_calendar_grant where business_id = $1",
      [f.business.id],
    );
    expect(JSON.stringify(stored.rows)).not.toContain("fixture-refresh");
    expect(f.google.calls.filter((c) => c.url.endsWith("/token"))).toHaveLength(
      1,
    );
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
    expect(f.google.calls).toHaveLength(0);
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
    expect(f.google.calls).toHaveLength(0);
  });
  it("does not grant calendar capability from mail-only or partial consent and consumes denied callbacks", async () => {
    const f = await fixture();
    f.google.control.scopes =
      "openid email https://www.googleapis.com/auth/gmail.send";
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
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
        calendarId: "dedicated@example.com",
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
    expect(f.google.control.refreshes).toBe(1);
    h.clock.set("2026-11-05T11:00:02Z");
    f.google.control.tokenError = 400;
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({
      status: "reconnect_required",
      reason: "revoked",
      calendars: [],
    });
    const refreshCalls = f.google.calls.filter((c) => c.url.endsWith("/token"));
    expect(refreshCalls.at(-1)?.body).toMatchObject({
      refresh_token: "fixture-refresh-rotated",
    });
    const count = refreshCalls.length;
    await f.application.read(f.credentials, f.business.id);
    expect(f.google.calls.filter((c) => c.url.endsWith("/token"))).toHaveLength(
      count,
    );
  });
  it("makes disconnect durable before remote revoke, supports retry and invalidates concurrent OAuth callbacks", async () => {
    const f = await fixture();
    await connect(f);
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    f.google.control.revokeError = 503;
    expect(
      await f.application.disconnect(f.credentials, f.business.id),
    ).toMatchObject({ status: "revocation_pending", calendars: [] });
    await expect(
      f.application.callback(f.credentials, f.business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      f.application.start(f.credentials, f.business.id, {
        returnPath: `/businesses/${f.business.id}/calendar`,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    f.google.control.revokeError = 0;
    expect(
      await f.application.disconnect(f.credentials, f.business.id),
    ).toMatchObject({ status: "disconnected" });
    const data = await h.admin.query(
      "select credentials from google_calendar_grant where business_id = $1",
      [f.business.id],
    );
    expect(data.rows[0].credentials).toBeNull();
  });
  it("serializes refresh with disconnect so a late refresh cannot resurrect a grant", async () => {
    const f = await fixture();
    await connect(f);
    h.clock.set("2026-11-05T10:00:01Z");
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
      started = r;
    });
    const held = new Promise<void>((r) => {
      release = r;
    });
    f.google.control.beforeRefresh = async () => {
      started();
      await held;
    };
    const read = f.application.read(f.credentials, f.business.id);
    await entered;
    const disconnect = f.application.disconnect(f.credentials, f.business.id);
    release();
    await read;
    expect(await disconnect).toMatchObject({
      status: "disconnected",
      calendars: [],
    });
    expect(
      f.google.calls.find((c) => c.url.endsWith("/revoke"))?.body,
    ).toMatchObject({ token: "fixture-refresh-rotated" });
    expect(
      (await f.application.read(f.credentials, f.business.id)).status,
    ).toBe("disconnected");
  });
  it("validates calendar time zones and access roles; records grant loss rather than stale readiness", async () => {
    const f = await fixture();
    await connect(f);
    f.google.control.apiError = 429;
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({ reason: "rate_limited", calendars: [] });
    f.google.control.apiError = 0;
    f.google.control.timeZone = "invalid/zone";
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({ reason: "invalid_response", calendars: [] });
    f.google.control.timeZone = "UTC";
    f.google.control.accessRole = "reader";
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({
      status: "insufficient",
      reason: "calendar_access_lost",
      calendars: [],
    });
    await expect(
      f.application.select(f.credentials, f.business.id, {
        calendarId: "readonly@example.com",
      }),
    ).rejects.toMatchObject({ code: "CALENDAR_SETUP_REQUIRED" });
  });
  it("rejects account substitution on reconnect and exposes honest missing project configuration", async () => {
    const f = await fixture();
    await connect(f);
    f.google.control.subject = "other-account";
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({
      status: "insufficient",
      accountEmail: "calendar@example.com",
    });
    const unconfigured = createGoogleCalendarApplication({
      database: runtimeDatabase(h.runtime),
      access: h.access,
      clock: h.clock,
      configuration: null,
      fetch: f.google.fetch,
    });
    expect(await unconfigured.read(f.credentials, f.business.id)).toMatchObject(
      { configured: false },
    );
    await expect(
      unconfigured.start(f.credentials, f.business.id, {
        returnPath: `/businesses/${f.business.id}/calendar`,
      }),
    ).rejects.toMatchObject({ code: "CALENDAR_SETUP_REQUIRED" });
    expect(
      configuredGoogleCalendar({ GOOGLE_CALENDAR_APPROVED: "false" }),
    ).toBeNull();
  });
  it("enforces HTTP origin/body validation and redacts callback diagnostics and redirects", async () => {
    const f = await fixture();
    const diagnostics: unknown[] = [];
    const http = createGoogleCalendarHttp({
      application: f.application,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const request = (origin: string, body: unknown) =>
      new Request("http://localhost:3000/calendar", {
        method: "POST",
        headers: {
          cookie: f.credentials.get("cookie")!,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    expect(
      (await http.start(request("https://evil.example", {}), f.business.id))
        .status,
    ).toBe(403);
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    const result = await http.callback(
      new Request(
        `http://localhost:3000/callback?state=${state}&code=fixture-code`,
        { headers: f.credentials },
      ),
      f.business.id,
    );
    expect(result.status).toBe(303);
    expect(result.headers.get("Location")).toBe(
      `http://localhost:3000/businesses/${f.business.id}/calendar`,
    );
    const replay = await http.callback(
      new Request(
        `http://localhost:3000/callback?state=${state}&code=secret-code`,
        { headers: f.credentials },
      ),
      f.business.id,
    );
    expect(replay.status).toBe(400);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /fixture|secret-code|state=/,
    );
    expect(await replay.text()).not.toMatch(
      /secret-code|fixture-access|fixture-client-secret/,
    );
  });
  it("rotates encryption keys on refresh and refuses decryption under another Business context", async () => {
    const f = await fixture();
    await connect(f);
    const rotated = createGoogleCalendarApplication({
      database: runtimeDatabase(h.runtime),
      access: h.access,
      clock: h.clock,
      fetch: f.google.fetch,
      configuration: {
        ...f.google.configuration,
        activeKeyId: "next",
        keys: { ...f.google.configuration.keys, next: "cd".repeat(32) },
      },
    });
    h.clock.set("2026-11-05T10:00:01Z");
    expect((await rotated.read(f.credentials, f.business.id)).status).toBe(
      "ready",
    );
    const row = await h.admin.query(
      "select credentials from google_calendar_grant where business_id = $1",
      [f.business.id],
    );
    expect(JSON.parse(row.rows[0].credentials).keyId).toBe("next");
    const other = await fixture();
    await connect(other);
    await h.admin.query(
      "update google_calendar_grant set credentials = $1 where business_id = $2",
      [row.rows[0].credentials, other.business.id],
    );
    const before = other.google.calls.length;
    expect(
      await other.application.read(other.credentials, other.business.id),
    ).toMatchObject({ reason: "unavailable", calendars: [] });
    expect(other.google.calls).toHaveLength(before);
  });
  it("revalidates refresh scope and 403 grants, preserves denied-reconnect credentials for revocation and rejects cross-Business reads", async () => {
    const f = await fixture(),
      other = await fixture();
    await connect(f);
    await expect(
      f.application.read(other.credentials, f.business.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.google.control.scopes =
      "openid email https://www.googleapis.com/auth/gmail.send";
    h.clock.set("2026-11-05T10:00:01Z");
    expect(
      await f.application.read(f.credentials, f.business.id),
    ).toMatchObject({ status: "insufficient", reason: "insufficient" });
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    await f.application.callback(f.credentials, f.business.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      error: "access_denied",
    });
    await f.application.disconnect(f.credentials, f.business.id);
    expect(
      f.google.calls.find((c) => c.url.endsWith("/revoke"))?.body,
    ).toMatchObject({ token: "fixture-refresh-rotated" });
  });
  it("forces RLS on grant/state records and denies runtime scope or historical deletion changes", async () => {
    const f = await fixture();
    await connect(f);
    const read = await h.runtime.query("select id from google_calendar_grant");
    expect(read.rows).toEqual([]);
    await expect(
      h.runtime.query("delete from google_calendar_grant"),
    ).rejects.toThrow();
    await expect(
      h.runtime.query("update google_calendar_grant set business_id = $1", [
        randomUUID(),
      ]),
    ).rejects.toThrow();
    await expect(
      h.runtime.query(
        "update google_calendar_oauth set verifier = 'untrusted' ",
      ),
    ).rejects.toThrow();
    await h.reapplySchema();
    expect(
      (await f.application.read(f.credentials, f.business.id)).status,
    ).toBe("ready");
  });
  it("revokes the actual session after OAuth initiation, including copied credentials", async () => {
    const f = await fixture();
    const start = await f.application.start(f.credentials, f.business.id, {
      returnPath: `/businesses/${f.business.id}/calendar`,
    });
    const copied = new Headers(f.credentials);
    await h.signOut(f.credentials);
    await expect(
      f.application.read(copied, f.business.id),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      f.application.callback(copied, f.business.id, {
        state: new URL(start.authorizationUrl).searchParams.get("state"),
        code: "fixture-code",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(f.google.calls).toHaveLength(0);
  });

  it("does not let a delayed disconnect revoke a replacement connection", async () => {
    const f = await fixture();
    await connect(f);
    const database = runtimeDatabase(h.runtime);
    const transact = database.transaction.bind(database);
    type Configuration = Parameters<typeof database.transaction>[1];
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((r) => {
      entered = r;
    });
    const resumed = new Promise<void>((r) => {
      release = r;
    });
    let calls = 0;
    // Only schedule real transactions: every query/row/lock still comes from PostgreSQL.
    database.transaction = async function <T>(
      operation: (tx: Transaction) => Promise<T>,
      configuration?: Configuration,
    ) {
      if (++calls === 2) {
        entered();
        await resumed;
      }
      return transact(operation, configuration);
    };
    const delayed = createGoogleCalendarApplication({
      database,
      access: h.access,
      clock: h.clock,
      configuration: f.google.configuration,
      fetch: f.google.fetch,
    });
    const disconnecting = delayed.disconnect(f.credentials, f.business.id);
    await waiting;
    await f.application.disconnect(f.credentials, f.business.id);
    const replacement = await connect(f);
    release();
    expect(await disconnecting).toMatchObject({
      status: "ready",
      connectionId: replacement.connectionId,
    });
    expect(
      f.google.calls.filter((c) => c.url.endsWith("/revoke")),
    ).toHaveLength(1);
    expect(
      (await f.application.read(f.credentials, f.business.id)).status,
    ).toBe("ready");
  });
});
