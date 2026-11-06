import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { readySender } from "./support/senders";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { runtimeDatabase } from "../src/db/runtime";
import { createSenderHealthApplication } from "../src/application/sender-health";
import { createSenderHealthRepository } from "../src/db/sender-health-repository";
import { createSenderHealthHttp } from "../src/http/sender-health";
import { verifyRuntimeRole } from "../src/db/runtime";

describe("Sender health at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  function app() {
    return createSenderHealthApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderHealthRepository(
        runtimeDatabase(h.runtime),
        h.clock,
      ),
    });
  }
  async function setup() {
    h.clock.set("2026-11-05T09:00:00Z");
    const owner = await h.signIn(`health-${randomUUID()}@example.com`);
    const business = await h.application.createBusiness(owner, {
      name: "Supplier",
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
    const connection = await inbox.addConnection(owner, business.id, {
      label: "Selected sales",
      channel: "email",
      conversationRefs: ["sales"],
      manualRepliesObservable: false,
    });
    const sender = await readySender(h, owner, business.id, connection.id);
    const operator = await h.signIn(
      `health-operator-${randomUUID()}@example.com`,
    );
    const actor = await h.authenticate(operator);
    await h.admin.query(
      "INSERT INTO platform_operator (user_id,sender_health) VALUES ($1,true)",
      [actor.userId],
    );
    return {
      owner,
      operator,
      businessId: business.id,
      sender,
      inbox,
      inboxId: connection.id,
    };
  }
  const rule = { unit: "rate" as const, limit: 0.05, minimumSample: 10 };
  const policy = {
    source: "assisted_review" as const,
    sourceAuthority: "Provider report reviewed by authorized support",
    sourceOrigin: "https://evidence.example",
    population: "Exact sender submissions in the reviewed window",
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
  };
  async function configured() {
    const f = await setup(),
      identityId = f.sender.identity.id;
    await app().configure(f.operator, f.businessId, identityId, {
      expectedVersion: 0,
      policy,
    });
    const binding = (await app().workspace(f.operator, f.businessId, true))
      .identities[0].binding;
    const evidence = {
      eventKey: "report",
      policyVersion: 1,
      binding,
      observedAt: "2026-11-05T09:00:00Z",
      windowStart: "2026-11-05T08:00:00Z",
      windowEnd: "2026-11-05T09:00:00Z",
      reference: "https://evidence.example/reports/report",
      artifactSha256: "a".repeat(64),
      metrics: {
        spf: { failed: 0, total: 100 },
        dkim: { failed: 0, total: 100 },
        dmarc_alignment: { failed: 0, total: 100 },
        bounces: { failed: 0, total: 100 },
        complaints: { failed: 0, total: 100 },
      },
      repairs: [] as string[],
    };
    return { ...f, identityId, evidence };
  }
  it("persists an attributed threshold incident and one alert for each audience across duplicate events and restart", async () => {
    const f = await setup();
    const identityId = f.sender.identity.id;
    const configured = await app().configure(
      f.operator,
      f.businessId,
      identityId,
      { expectedVersion: 0, policy },
    );
    const state = await app().workspace(f.operator, f.businessId, true);
    const binding = state.identities[0].binding;
    const evidence = {
      eventKey: "review-1",
      policyVersion: configured.version,
      binding,
      observedAt: "2026-11-05T09:00:00Z",
      windowStart: "2026-11-05T08:00:00Z",
      windowEnd: "2026-11-05T09:00:00Z",
      reference: "https://evidence.example/reports/review-1",
      artifactSha256: "a".repeat(64),
      metrics: {
        spf: { failed: 0, total: 100 },
        dkim: { failed: 0, total: 100 },
        dmarc_alignment: { failed: 0, total: 100 },
        bounces: { failed: 5, total: 100 },
        complaints: { failed: 0, total: 100 },
      },
      repairs: [],
    };
    await Promise.all([
      app().ingest(f.operator, f.businessId, identityId, evidence),
      app().ingest(f.operator, f.businessId, identityId, evidence),
    ]);
    const business = await app().workspace(f.owner, f.businessId);
    expect(business.alerts).toHaveLength(1);
    expect(business.identities[0].incidents).toMatchObject([
      { failures: ["bounces"], resolved: false },
    ]);
    expect((await app().alerts(f.operator)).alerts).toHaveLength(1);
    expect(
      (await f.sender.app.workspace(f.owner, f.businessId)).identities[0]
        .readiness,
    ).toMatchObject({
      ready: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "health_incident" }),
      ]),
    });
    expect(
      (await f.inbox.workspace(f.owner, f.businessId)).connections[0].active,
    ).toBe(true);
    await expect(
      app().ingest(f.operator, f.businessId, identityId, {
        ...evidence,
        artifactSha256: "b".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("requires a newer complete window satisfying the failed policy as well as current bindings; refresh, acknowledgement and lowered thresholds do not repair", async () => {
    const f = await configured();
    f.evidence.metrics.complaints.failed = 5;
    await app().ingest(f.operator, f.businessId, f.identityId, f.evidence);
    const incident = (await app().workspace(f.owner, f.businessId))
      .identities[0].incidents[0];
    const alert = (await app().workspace(f.owner, f.businessId)).alerts[0];
    await app().acknowledge(f.owner, f.businessId, alert.id);
    await f.sender.app.check(f.owner, f.businessId, f.identityId, {
      expectedVersion: 1,
    });
    await app().configure(f.operator, f.businessId, f.identityId, {
      expectedVersion: 1,
      policy: {
        ...policy,
        thresholds: {
          ...policy.thresholds,
          complaints: { ...rule, limit: 0.5 },
        },
      },
    });
    expect(
      (await f.sender.app.workspace(f.owner, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(false);
    h.clock.set("2026-11-05T10:00:00Z");
    await h.reverifyAuthenticator(f.operator);
    const next = {
      ...f.evidence,
      eventKey: "repair",
      policyVersion: 2,
      observedAt: "2026-11-05T10:00:00Z",
      windowStart: "2026-11-05T09:00:00Z",
      windowEnd: "2026-11-05T10:00:00Z",
      repairs: [incident.id],
    };
    await expect(
      app().ingest(f.operator, f.businessId, f.identityId, next),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    next.metrics.complaints.failed = 0;
    await app().ingest(f.operator, f.businessId, f.identityId, next);
    await f.sender.app.check(f.owner, f.businessId, f.identityId, {
      expectedVersion: 1,
    });
    expect(
      (await f.sender.app.workspace(f.owner, f.businessId)).identities[0]
        .readiness.ready,
    ).toBe(true);
    expect(
      (await app().workspace(f.owner, f.businessId)).identities[0].incidents[0]
        .resolved,
    ).toBe(true);
    await expect(
      app().ingest(f.operator, f.businessId, f.identityId, {
        ...f.evidence,
        eventKey: "late",
        policyVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("does not repair an open incident using a window that overlaps a later repeated failure", async () => {
    const f = await configured();
    f.evidence.metrics.bounces.failed = 5;
    await app().ingest(f.operator, f.businessId, f.identityId, f.evidence);
    const id = (await app().workspace(f.owner, f.businessId)).identities[0]
      .incidents[0].id;
    h.clock.set("2026-11-05T10:00:00Z");
    await h.reverifyAuthenticator(f.operator);
    const later = {
      ...f.evidence,
      eventKey: "later-failure",
      observedAt: "2026-11-05T10:00:00Z",
      windowStart: "2026-11-05T09:00:00Z",
      windowEnd: "2026-11-05T10:00:00Z",
    };
    await app().ingest(f.operator, f.businessId, f.identityId, later);
    h.clock.set("2026-11-05T10:01:00Z");
    await expect(
      app().ingest(f.operator, f.businessId, f.identityId, {
        ...later,
        eventKey: "contradictory-repair",
        observedAt: h.clock.now().toISOString(),
        metrics: { ...later.metrics, bounces: { failed: 0, total: 100 } },
        repairs: [id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("keeps undersized, expired and foreign evidence unknown and enforces count thresholds without adding snapshots", async () => {
    const f = await configured();
    f.evidence.metrics.bounces = { failed: 1, total: 2 };
    await app().ingest(f.operator, f.businessId, f.identityId, f.evidence);
    expect(
      (await app().workspace(f.owner, f.businessId)).identities[0].issues,
    ).toContainEqual(
      expect.objectContaining({ code: "health_sample_insufficient" }),
    );
    const foreign = await setup();
    await expect(
      app().workspace(foreign.owner, f.businessId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      app().ingest(f.owner, f.businessId, f.identityId, f.evidence),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app().ingest(f.operator, f.businessId, f.identityId, {
        ...f.evidence,
        eventKey: "forged",
        binding: { ...f.evidence.binding, generation: 999 },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app().ingest(f.operator, f.businessId, f.identityId, {
        ...f.evidence,
        eventKey: "secret-url",
        reference: "https://evidence.example/x?token=private",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await app().configure(f.operator, f.businessId, f.identityId, {
      expectedVersion: 1,
      policy: {
        ...policy,
        thresholds: {
          ...policy.thresholds,
          bounces: { unit: "count", limit: 2, minimumSample: 10 },
        },
      },
    });
    const next = {
      ...f.evidence,
      eventKey: "count-1",
      policyVersion: 2,
      metrics: { ...f.evidence.metrics, bounces: { failed: 1, total: 100 } },
    };
    await app().ingest(f.operator, f.businessId, f.identityId, next);
    await app().ingest(f.operator, f.businessId, f.identityId, {
      ...next,
      eventKey: "count-2",
    });
    expect(
      (await app().workspace(f.owner, f.businessId)).identities[0].incidents,
    ).toHaveLength(0);
    h.clock.set("2026-11-05T10:00:00Z");
    expect(
      (await app().workspace(f.owner, f.businessId)).identities[0].issues,
    ).toContainEqual(
      expect.objectContaining({ code: "health_evidence_required" }),
    );
  });
  it("classifies a sender-health-only operator in public authentication and rejects stale MFA and revoked capability", async () => {
    const f = await setup();
    expect(await h.access.status(f.operator)).toMatchObject({
      required: true,
      operator: true,
      operatorVerified: true,
      readiness: "mfa-satisfied",
    });
    const primaryOnly = await h.signIn(
      (await h.access.status(f.operator)).email,
      false,
    );
    expect(await h.access.status(primaryOnly)).toMatchObject({
      required: true,
      operator: true,
      verified: false,
      operatorVerified: false,
      readiness: "mfa-incomplete",
    });
    await expect(
      h.access.authenticateForWork(primaryOnly),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    const actor = await h.authenticate(f.operator);
    h.clock.set("2026-11-05T09:15:00Z");
    expect(await h.access.status(f.operator)).toMatchObject({
      operatorVerified: false,
      readiness: "mfa-incomplete",
    });
    await expect(app().alerts(f.operator)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await h.reverifyAuthenticator(f.operator);
    await h.admin.query(
      "UPDATE platform_operator SET sender_health=false WHERE user_id=$1",
      [actor.userId],
    );
    expect(await h.access.status(f.operator)).toMatchObject({
      required: false,
      operator: false,
    });
    await expect(app().alerts(f.operator)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("purges expired source artifacts under the configured retention while retaining incident safety and replay tombstones", async () => {
    const f = await configured();
    await app().configure(f.operator, f.businessId, f.identityId, {
      expectedVersion: 1,
      policy: { ...policy, retentionDays: 1 },
    });
    f.evidence.policyVersion = 2;
    f.evidence.metrics.bounces.failed = 5;
    await app().ingest(f.operator, f.businessId, f.identityId, f.evidence);
    h.clock.set("2026-11-07T09:00:00Z");
    const operator = await h.signIn((await h.access.status(f.operator)).email);
    await app().prune(operator, f.businessId, f.identityId);
    expect(
      (await app().workspace(operator, f.businessId, true)).identities[0],
    ).toMatchObject({
      evidence: null,
      incidents: [{ resolved: false, failures: ["bounces"] }],
    });
    await app().ingest(operator, f.businessId, f.identityId, f.evidence);
    expect(
      (await app().workspace(operator, f.businessId, true)).identities[0]
        .evidence,
    ).toBeNull();
  });
  it("rechecks capability after waiting for the dispatch lock and exposes only safe HTTP diagnostics", async () => {
    const f = await configured(),
      actor = await h.authenticate(f.operator);
    const latch = await h.admin.connect();
    await latch.query("select pg_advisory_lock(hashtextextended($1,0))", [
      f.businessId,
    ]);
    const pending = app()
      .ingest(f.operator, f.businessId, f.identityId, f.evidence)
      .catch((e: unknown) => e);
    try {
      await vi.waitFor(async () =>
        expect(
          (
            await h.admin.query(
              "select count(*)::int n from pg_locks where locktype='advisory' and not granted",
            )
          ).rows[0].n,
        ).toBeGreaterThan(0),
      );
      await h.admin.query(
        "UPDATE platform_operator SET sender_health=false WHERE user_id=$1",
        [actor.userId],
      );
      await latch.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        f.businessId,
      ]);
      expect(await pending).toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await latch.query("select pg_advisory_unlock(hashtextextended($1,0))", [
        f.businessId,
      ]);
      latch.release();
    }
    const origin = "http://localhost:3000";
    const diagnostics: unknown[] = [];
    const http = createSenderHealthHttp({
      application: app(),
      origin,
      reportFailure: (d) => diagnostics.push(d),
    });
    const response = await http.command(
      new Request(`${origin}/api/platform/sender-health/${f.businessId}`, {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(f.owner),
          origin,
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          command: "ingest",
          identityId: f.identityId,
          evidence: {
            ...f.evidence,
            reference: "https://evidence.example/private?token=secret",
          },
        }),
      }),
      f.businessId,
      true,
    );
    expect(response.status).toBe(400);
    expect(
      JSON.stringify(await response.json()) + JSON.stringify(diagnostics),
    ).not.toMatch(/private|token|secret|artifactSha256/);
  });
  it("keeps incoming capture and another sender available and re-establishes forced RLS and narrow grants on schema reapplication", async () => {
    const f = await configured();
    f.evidence.metrics.spf.failed = 5;
    await app().ingest(f.operator, f.businessId, f.identityId, f.evidence);
    const inbox = await f.inbox.addConnection(f.owner, f.businessId, {
      label: "Unaffected sales",
      channel: "email",
      conversationRefs: ["sales"],
      manualRepliesObservable: false,
    });
    const other = await readySender(h, f.owner, f.businessId, inbox.id, {
      fromAddress: "unrelated@supplier.example",
    });
    const senders = await f.sender.app.workspace(f.owner, f.businessId);
    expect(
      senders.identities.find((i) => i.id === other.identity.id)?.readiness
        .ready,
    ).toBe(true);
    expect(
      senders.identities.find((i) => i.id === f.identityId)?.readiness.ready,
    ).toBe(false);
    await f.inbox.capture(f.owner, f.businessId, f.inboxId, {
      eventId: "still-incoming",
      messageRef: "incoming-1",
      conversationRef: "sales",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      kind: "direct_inquiry",
      subject: "Steel inquiry",
      text: "Please send details",
      occurredAt: h.clock.now().toISOString(),
    });
    expect(
      (await f.inbox.workspace(f.owner, f.businessId)).conversations,
    ).toHaveLength(1);
    expect(
      (await h.runtime.query("select * from sender_health_record")).rows,
    ).toHaveLength(0);
    await h.admin.query(
      "ALTER TABLE sender_health_record NO FORCE ROW LEVEL SECURITY",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect(
      (await app().workspace(f.owner, f.businessId)).identities.find(
        (i) => i.id === f.identityId,
      )?.incidents[0].resolved,
    ).toBe(false);
  });
  it("requires both read and append grants and restores public evidence ingestion on schema reapplication", async () => {
    const f = await configured();
    await h.admin.query(
      "REVOKE INSERT ON sender_health_record FROM app_runtime",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    await app().ingest(f.operator, f.businessId, f.identityId, {
      ...f.evidence,
      eventKey: "after-grant-repair",
    });
  });
});
