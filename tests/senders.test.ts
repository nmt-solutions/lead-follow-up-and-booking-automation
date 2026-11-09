import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { readySender, senderFixture } from "./support/senders";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import {
  senderObservationSchema,
  type SenderCheck,
} from "../src/models/senders";
import { createSenderHttp } from "../src/http/senders";
import { randomUUID } from "node:crypto";

describe("Sending identities at the persisted application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  function application() {
    return createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(runtimeDatabase(h.runtime), h.clock),
      adapter: unavailableSenderAdapter,
      clock: h.clock,
    });
  }
  async function setup(suffix: string) {
    h.clock.set("2026-11-05T09:00:00Z");
    const credentials = await h.signIn(`sender-${suffix}@example.com`);
    const business = await h.application.createBusiness(credentials, {
      name: "Steel Supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(runtimeDatabase(h.runtime)),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const connection = await inbox.addConnection(credentials, business.id, {
      label: "Selected sales inbox",
      channel: "email",
      conversationRefs: ["sales"],
      manualRepliesObservable: false,
    });
    return {
      credentials,
      businessId: business.id,
      inbox,
      inboxId: connection.id,
    };
  }
  it("persists distinct outreach and sales identities without self-authorizing transport or replies", async () => {
    const credentials = await h.signIn("sender-owner@example.com");
    const business = await h.application.createBusiness(credentials, {
      name: "Steel Supplier",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const app = application();
    for (const purpose of ["dedicated_outreach", "ordinary_sales"]) {
      await app.saveIdentity(credentials, business.id, {
        id: null,
        expectedVersion: 0,
        configuration: {
          origin: "customer_domain",
          purpose,
          fromAddress:
            purpose === "dedicated_outreach"
              ? "outreach@supplier.example"
              : "sales@supplier.example",
          displayName: "Sales team",
          uses: ["inbound", "existing_conversation"],
          connectionId: null,
          replyRouteId: null,
          enabled: true,
        },
      });
    }
    const reloaded = await application().workspace(credentials, business.id);
    expect(reloaded.identities).toHaveLength(2);
    expect(
      reloaded.identities.map((i) => i.configuration.purpose).sort(),
    ).toEqual(["dedicated_outreach", "ordinary_sales"]);
    expect(reloaded.identities[0].readiness).toMatchObject({ ready: false });
    expect(reloaded.identities[0].readiness.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "connection_required",
        "reply_route_required",
        "observation_required",
      ]),
    );
    await expect(
      app.saveIdentity(credentials, business.id, {
        id: null,
        expectedVersion: 0,
        configuration: { ...reloaded.identities[0].configuration, ready: true },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  for (const origin of [
    "customer_mailbox",
    "customer_domain",
    "service_provided",
  ] as const) {
    it(`derives ${origin} readiness from persisted proof and independently enforces first-contact policy`, async () => {
      const f = await setup(origin);
      const s = await readySender(h, f.credentials, f.businessId, f.inboxId, {
        origin,
        purpose: "dedicated_outreach",
        uses: ["first_contact", "trial", "inbound", "existing_conversation"],
      });
      const state = await senderFixture(h).app.workspace(
        f.credentials,
        f.businessId,
      );
      expect(state.identities[0]).toMatchObject({
        identification: {
          businessName: "Steel Supplier",
          fromName: "Sales team · Steel Supplier",
          platformDisclosure: "Sent through LeadRelay for Steel Supplier",
        },
        evidence: {
          adapterKey: "deterministic-mail-v1",
          mode: "fixture",
          binding: { identityId: s.identity.id, identityVersion: 1 },
        },
        readiness: {
          mode: "fixture",
          uses: {
            first_contact: { ready: origin !== "service_provided" },
            inbound: { ready: true },
            trial: { ready: true },
            existing_conversation: { ready: true },
          },
        },
      });
      s.fixture.approvedUses = ["existing_conversation"];
      await s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      });
      const limited = (await s.app.workspace(f.credentials, f.businessId))
        .identities[0];
      expect(limited.readiness.uses.trial).toMatchObject({
        ready: false,
        reasons: expect.arrayContaining(["use_not_approved"]),
      });
      expect(limited.readiness.uses.existing_conversation.ready).toBe(true);
    });
  }
  for (const [check, status] of [
    ["domain_verification", "missing"],
    ["spf", "failed"],
    ["dkim", "failed"],
    ["dmarc_alignment", "failed"],
    ["sending_grant", "revoked"],
    ["sending_grant", "insufficient"],
    ["delivery_transport", "missing"],
    ["reply_reading_grant", "missing"],
    ["inbox_sync", "unavailable"],
    ["reply_capture", "unknown"],
    ["health", "authentication_failed"],
    ["health", "bounces"],
    ["health", "complaints"],
  ] as const) {
    it(`keeps ${check} ${status} actionable independently of all other passing checks`, async () => {
      const f = await setup(`${check}-${status}`);
      const s = await readySender(h, f.credentials, f.businessId, f.inboxId, {
        origin: "customer_domain",
      });
      s.fixture.changes[check] = status satisfies SenderCheck;
      await s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      });
      const result = (
        await senderFixture(h).app.workspace(f.credentials, f.businessId)
      ).identities[0];
      expect(result.readiness).toMatchObject({
        ready: false,
        issues: [{ code: `${check}:${status}`, action: expect.any(String) }],
      });
      expect(result.evidence?.checks.dkim).toBe(
        check === "dkim" ? "failed" : "pass",
      );
      expect(
        (await f.inbox.workspace(f.credentials, f.businessId)).connections[0]
          .active,
      ).toBe(true);
    });
  }
  it("expires proof and invalidates it after address, connection and reply-route changes without reviving old proof", async () => {
    const f = await setup("stale");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    h.clock.set("2026-11-05T10:00:01Z");
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.issues,
    ).toContainEqual(expect.objectContaining({ code: "observation_stale" }));
    h.clock.set("2026-11-05T09:01:00Z");
    await s.app.saveIdentity(f.credentials, f.businessId, {
      id: s.identity.id,
      expectedVersion: 1,
      configuration: {
        ...s.identity.configuration,
        fromAddress: "other@supplier.example",
      },
    });
    const changed = (await s.app.workspace(f.credentials, f.businessId))
      .identities[0];
    expect(changed.readiness.ready).toBe(false);
    expect(changed.readiness.issues.map((i) => i.code)).toContain(
      "observation_outdated",
    );
    await s.app.saveIdentity(f.credentials, f.businessId, {
      id: s.identity.id,
      expectedVersion: 2,
      configuration: s.identity.configuration,
    });
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
    await s.app.check(f.credentials, f.businessId, s.identity.id, {
      expectedVersion: 3,
    });
    await s.app.saveConnection(f.credentials, f.businessId, {
      id: s.connection.id,
      expectedVersion: 1,
      configuration: s.connection.configuration,
    });
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
    await s.app.check(f.credentials, f.businessId, s.identity.id, {
      expectedVersion: 3,
    });
    await s.app.saveReplyRoute(f.credentials, f.businessId, {
      id: s.route.id,
      expectedVersion: 1,
      configuration: { ...s.route.configuration, enabled: false },
    });
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
  });
  it("keeps all-pass authentication blocked without delivery transport or a reply route", async () => {
    const f = await setup("domain-only");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId, {
      origin: "customer_domain",
    });
    s.fixture.changes.delivery_transport = "missing";
    await s.app.saveIdentity(f.credentials, f.businessId, {
      id: s.identity.id,
      expectedVersion: 1,
      configuration: { ...s.identity.configuration, replyRouteId: null },
    });
    const result = await s.app.check(
      f.credentials,
      f.businessId,
      s.identity.id,
      { expectedVersion: 2 },
    );
    expect(result.readiness.issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "reply_route_required",
        "delivery_transport:missing",
      ]),
    );
    expect(result.readiness.ready).toBe(false);
    expect(result.evidence?.checks).toMatchObject({
      domain_verification: "pass",
      spf: "pass",
      dkim: "pass",
      dmarc_alignment: "pass",
    });
  });
  it("rejects cross-Business identity, connection, reply route and evidence bindings", async () => {
    const a = await setup("scope-a");
    const b = await setup("scope-b");
    const s = await readySender(h, a.credentials, a.businessId, a.inboxId);
    const other = senderFixture(h);
    for (const configuration of [
      {
        ...s.identity.configuration,
        connectionId: s.connection.id,
        replyRouteId: null,
      },
      {
        ...s.identity.configuration,
        connectionId: null,
        replyRouteId: s.route.id,
      },
    ]) {
      await expect(
        other.app.saveIdentity(b.credentials, b.businessId, {
          id: null,
          expectedVersion: 0,
          configuration,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      other.app.check(b.credentials, b.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      other.app.workspace(b.credentials, a.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      other.app.saveReplyRoute(b.credentials, b.businessId, {
        id: null,
        expectedVersion: 0,
        configuration: {
          ...s.route.configuration,
          inboxConnectionId: b.inboxId,
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      s.app.check(a.credentials, a.businessId, s.identity.id, {
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const malicious = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(runtimeDatabase(h.runtime), h.clock),
      clock: h.clock,
      adapter: {
        ...s.adapter,
        async inspect(context) {
          const result = await s.adapter.inspect(
            context,
            new AbortController().signal,
          );
          return {
            ...(typeof result === "object" ? result : {}),
            binding: { ...context.binding, businessId: b.businessId },
          };
        },
      },
    });
    await expect(
      malicious.check(a.credentials, a.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(
      (await s.app.workspace(a.credentials, a.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
  });
  it("rechecks session, MFA and role after adapter I/O and does not accept stale configuration proof", async () => {
    const f = await setup("racing-setup");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    s.fixture.intercept = async () => {
      await s.app.saveConnection(f.credentials, f.businessId, {
        id: s.connection.id,
        expectedVersion: 1,
        configuration: { ...s.connection.configuration, enabled: false },
      });
    };
    await expect(
      s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
    s.fixture.intercept = async () => {
      await h.signOut(f.credentials);
    };
    await expect(
      s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("protects HTTP commands, rejects malformed/forged proof and redacts provider diagnostics", async () => {
    const f = await setup("http");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    s.fixture.intercept = async () => {
      throw new Error("secret-token private-mail-body");
    };
    const diagnostics: unknown[] = [];
    const http = createSenderHttp({
      application: s.app,
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    function request(input: unknown, origin = "http://localhost:3000") {
      const headers = new Headers(f.credentials);
      headers.set("content-type", "application/json");
      headers.set("origin", origin);
      return new Request("http://localhost:3000/api/senders", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      });
    }
    expect(
      (
        await http.check(
          request({ expectedVersion: 1, ready: true }),
          f.businessId,
          s.identity.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.check(
          request({ expectedVersion: 1 }, "https://evil.example"),
          f.businessId,
          s.identity.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.check(
          request({ expectedVersion: 1 }),
          f.businessId,
          randomUUID(),
        )
      ).status,
    ).toBe(404);
    const failed = await http.check(
      request({ expectedVersion: 1 }),
      f.businessId,
      s.identity.id,
    );
    expect(failed.status).toBe(200);
    const body = await failed.text();
    expect(body).toContain("delivery_transport:unavailable");
    expect(`${body}${JSON.stringify(diagnostics)}`).not.toMatch(
      /secret-token|private-mail-body/,
    );
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
  });
  it("requires privileged setup permissions and current MFA while allowing scoped salesperson status reads", async () => {
    const f = await setup("roles");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    const sales = await h.signIn("sender-salesperson@example.com");
    await h.team.invite(f.credentials, f.businessId, {
      email: "sender-salesperson@example.com",
      role: "salesperson",
    });
    const mail = h.invitations.sent.at(-1)!;
    await h.team.accept(sales, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    expect((await s.app.workspace(sales, f.businessId)).canManage).toBe(false);
    await expect(
      s.app.check(sales, f.businessId, s.identity.id, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      s.app.saveConnection(sales, f.businessId, {
        id: s.connection.id,
        expectedVersion: 1,
        configuration: s.connection.configuration,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const noMfa = await h.signIn("sender-roles@example.com", false);
    await expect(s.app.workspace(noMfa, f.businessId)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
  });
  it("rejects an earlier in-flight healthy check after a later failed check has been persisted", async () => {
    const f = await setup("proof-order");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    s.fixture.intercept = async () => {
      s.fixture.intercept = async () => {};
      s.fixture.changes.health = "revoked";
      await s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      });
      s.fixture.changes = {};
    };
    await expect(
      s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await s.app.workspace(f.credentials, f.businessId)).identities[0],
    ).toMatchObject({
      readiness: { ready: false },
      evidence: { checks: { health: "revoked" } },
    });
  });
  it("blocks persisted passing proof when its configured adapter is removed or changed", async () => {
    const f = await setup("adapter-removed");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    const unavailable = (
      await application().workspace(f.credentials, f.businessId)
    ).identities[0];
    expect(unavailable.readiness.ready).toBe(false);
    expect(unavailable.readiness.issues.map((i) => i.code)).toContain(
      "adapter_unconfigured",
    );
    expect(
      (await senderFixture(h).app.workspace(f.credentials, f.businessId))
        .identities[0].readiness.ready,
    ).toBe(true);
    expect(s.identity.id).toBe(unavailable.id);
  });
  it("blocks a revoked selected reply inbox even when adapter proof passes", async () => {
    const f = await setup("inbox-revoked");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    await f.inbox.revokeConnection(f.credentials, f.businessId, f.inboxId);
    const state = (await s.app.workspace(f.credentials, f.businessId))
      .identities[0];
    expect(state.readiness.ready).toBe(false);
    expect(state.readiness.issues.map((i) => i.code)).toContain(
      "reply_route_unavailable",
    );
  });
  it("rejects sequential cached positive proof after a newer revocation and keeps the sender blocked on reload", async () => {
    const f = await setup("cached-positive");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    h.clock.set("2026-11-05T09:05:00Z");
    s.fixture.changes.sending_grant = "revoked";
    await s.app.check(f.credentials, f.businessId, s.identity.id, {
      expectedVersion: 1,
    });
    h.clock.set("2026-11-05T09:06:00Z");
    s.fixture.changes = {};
    const cached = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(runtimeDatabase(h.runtime), h.clock),
      clock: h.clock,
      adapter: {
        ...s.adapter,
        async inspect(context, signal) {
          const observation = senderObservationSchema.parse(
            await s.adapter.inspect(context, signal),
          );
          return {
            ...observation,
            observedAt: "2026-11-05T09:00:00Z",
            validUntil: "2026-11-05T10:00:00Z",
          };
        },
      },
    });
    await expect(
      cached.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(
      (await senderFixture(h).app.workspace(f.credentials, f.businessId))
        .identities[0].readiness.ready,
    ).toBe(false);
  });
  it("rejects a setup check when Admin access or MFA is revoked during provider work", async () => {
    const f = await setup("authorization-change");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    const admin = await h.signIn("sender-setup-admin@example.com");
    const actor = await h.authenticate(admin);
    await h.team.invite(f.credentials, f.businessId, {
      email: "sender-setup-admin@example.com",
      role: "admin",
    });
    const mail = h.invitations.sent.at(-1)!;
    await h.team.accept(admin, {
      token: new URLSearchParams(new URL(mail.url).hash.slice(1)).get("token"),
    });
    s.fixture.intercept = async () => {
      await h.team.removeMember(f.credentials, f.businessId, {
        userId: actor.userId,
      });
    };
    await expect(
      s.app.check(admin, f.businessId, s.identity.id, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    s.fixture.intercept = async () => {
      h.clock.set("2026-11-05T22:00:00Z");
    };
    await expect(
      s.app.check(f.credentials, f.businessId, s.identity.id, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    h.clock.set("2026-11-05T09:01:00Z");
  });
  it("preserves identities and evidence through additive schema reapplication and verifies restricted forced-RLS storage", async () => {
    const f = await setup("reapply");
    const s = await readySender(h, f.credentials, f.businessId, f.inboxId);
    const before = await s.app.workspace(f.credentials, f.businessId);
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(
      await senderFixture(h).app.workspace(f.credentials, f.businessId),
    ).toEqual(before);
    await expect(
      h.runtime.query("update sender_observation set evidence = '{}'::jsonb"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.runtime.query("delete from sender_identity"),
    ).rejects.toMatchObject({ code: "42501" });
    await h.admin.query(
      "ALTER TABLE sender_identity NO FORCE ROW LEVEL SECURITY",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await h.admin.query("ALTER TABLE sender_identity FORCE ROW LEVEL SECURITY");
    await verifyRuntimeRole(h.runtime);
  });
});
