import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { createHarness } from "./support/harness";
import { recoveryFixture } from "./support/recovery";
import { financialExportFixture } from "./support/governance-financial";
import { createMemoryStorage } from "./support/storage";
import { financialResearch } from "./support/financial-operational";
import { runtimeDatabase } from "../src/db/runtime";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createFinancialAdjustmentApplication } from "../src/application/financial-adjustments";
import { createFinancialAdjustmentRepository } from "../src/db/financial-adjustment-repository";
import { createRecoveryReconciler } from "../src/recovery/reconciliation";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";

describe("Populated native PostgreSQL infrastructure drill", () => {
  let h: Awaited<ReturnType<typeof createHarness>>,
    f: Awaited<ReturnType<typeof financialExportFixture>>,
    r: Awaited<ReturnType<typeof recoveryFixture>>,
    pending: { id: string },
    owner: Headers;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    h.clock.set("2026-11-05T09:00:00Z");
    const storage = createMemoryStorage();
    f = await financialExportFixture(
      h,
      storage,
      "fixture:recovery-files",
      true,
      undefined,
      async (fixture) => {
        const research = await financialResearch(h, fixture, true);
        await research.app.start(fixture.owner, fixture.business.id, {
          ...research.request(),
          budget: 3,
        });
        await research.app.execute(research.queued.shift());
        await research.app.start(
          fixture.owner,
          fixture.business.id,
          research.request(),
        );
      },
    );
    const receiptBody = new TextEncoder().encode(
      JSON.stringify({
        account_id: "acc_fixture",
        event: "refund.processed",
        payload: { refund: { entity: f.native.refunds[0] } },
      }),
    );
    await f.adjustments.event({
      body: receiptBody,
      headers: new Headers({
        "x-razorpay-event-id": `evt_${randomUUID()}`,
        "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
          .update(receiptBody)
          .digest("hex"),
      }),
    });
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(runtimeDatabase(h.runtime)),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const connection = await inbox.addConnection(f.owner, f.business.id, {
      label: "Sales",
      channel: "email",
      conversationRefs: [],
      manualRepliesObservable: true,
    });
    await inbox.capture(f.owner, f.business.id, connection.id, {
      eventId: "recovery-inquiry",
      messageRef: "recovery-inquiry",
      conversationRef: "buyer",
      senderRef: "buyer@example.net",
      senderName: "Buyer",
      subject: "Steel",
      text: "Please quote 500 kg of steel.",
      kind: "direct_inquiry",
      occurredAt: h.clock.now().toISOString(),
    });
    pending = await f.adjustments.review(f.op, f.business.id, {
      kind: "refund",
      invoiceId: f.invoice.id,
      requestKey: randomUUID(),
      lines: [{ lineId: "subscription", netMinor: "50" }],
      reason: "Fixture reviewed pending refund",
      evidence: ["fixture:reviewed-refund"],
    });
    const copies = [...storage.objects.entries()].map(([_key, object], i) => ({
      id: `artifact-${i}`,
      bytes: Buffer.from(object.bytes),
      retained: true,
    }));
    copies.push({
      id: "unretained-old-upload",
      bytes: Buffer.from("deleted source bytes without retained copy"),
      retained: false,
    });
    h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
    owner = await h.signIn(`recovery-${randomUUID()}@example.com`);
    r = await recoveryFixture(h, owner, f.business.id, copies);
  });
  afterEach(async () => {
    await r?.close();
  });
  it("restores exact prospects, evidence, conversations, original cash/tax/credit artifacts and pending work; a post-cutoff native acceptance never repeats", async () => {
    const operator = await h.signIn("export-documents@example.com");
    f.native.loseRefund = true;
    await f.adjustments.execute(operator, f.business.id, {
      caseId: pending.id,
    });
    expect(f.native.refundPosts).toHaveLength(2);
    f.native.loseRefund = false;
    await f.adjustments.refresh(operator, f.business.id, {
      caseId: pending.id,
    });
    r.controls.reconcile = createRecoveryReconciler({
      financial: f.adjustments,
      credentials: operator,
      now: () => new Date(vi.getRealSystemTime()),
      freshSeconds: 600,
    });
    const op = await r.request();
    await r.advance(op.id, 7);
    const recovered = await r
      .application()
      .inspect(owner, { businessId: f.business.id, operationId: op.id });
    expect(recovered.business).toEqual({
      id: f.business.id,
      name: f.business.name,
    });
    for (const table of [
      "discovery_prospect",
      "discovery_observation",
      "inbox_conversation",
      "inbox_message",
      "subscription_payment",
      "subscription_period",
      "seller_document",
      "financial_case",
      "financial_case_event",
      "financial_receipt",
    ]) {
      expect(
        recovered.facts.filter((f) => f.table === table).length,
        table,
      ).toBeGreaterThan(0);
    }
    expect(recovered.facts).toEqual(
      expect.arrayContaining(r.archive.manifest.facts),
    );
    const ws = await r.application().workspace(owner),
      saved = ws.operations.find((s) => s.id === op.id)!;
    expect(
      saved.events.find(
        (e) => e.stage === "quarantined" && e.outcome === "completed",
      )?.evidence.files,
    ).toContainEqual({
      id: "unretained-old-upload",
      hash: r.plan.files.at(-1)!.hash,
      bytes: r.plan.files.at(-1)!.bytes,
      status: "omitted",
    });
    expect(
      saved.events.find(
        (e) => e.stage === "reconciled" && e.outcome === "completed",
      )?.evidence.native,
    ).toEqual(
      expect.arrayContaining([
        {
          source: "financial_case",
          id: pending.id,
          nativeId: "rfnd_fixture2",
          outcome: "accepted",
          amountMinor: "55",
          currency: "INR",
        },
      ]),
    );
    // Even when the restored review and original actor are otherwise still current, PostgreSQL quarantine fences its execution before native I/O.
    h.clock.set("2026-11-05T09:00:00Z");
    const targetFinancial = createFinancialAdjustmentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createFinancialAdjustmentRepository(
        runtimeDatabase(r.target.runtime),
      ),
      clock: h.clock,
      gateway: configuredFinancialAdjustments(f.native.configuration),
      documents: f.documents,
    });
    await expect(
      targetFinancial.execute(f.op, f.business.id, { caseId: pending.id }),
    ).rejects.toBeDefined();
    expect(f.native.refundPosts).toHaveLength(2);
    expect(r.controls.targetFiles.size).toBe(r.plan.files.length - 1);
  });
});
