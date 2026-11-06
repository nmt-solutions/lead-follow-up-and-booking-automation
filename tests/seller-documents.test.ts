import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { runtimeDatabase } from "../src/db/runtime";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { createMemoryStorage } from "./support/storage";
import { subscriptionFixture } from "./support/subscription";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { deterministicPayments } from "./support/payment-gateway";
import { createSellerDocumentHttp } from "../src/http/seller-documents";
import { verifyRuntimeRole } from "../src/db/runtime";
import { prepareDatabaseRole, secureDatabase } from "../src/db/setup";
import { persistPaidSubscription } from "./support/paid-subscription";
import { createFileApplication } from "../src/application/files";
import { createFileRepository } from "../src/db/file-repository";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { razorpayFixture } from "./support/razorpay";

// Synthetic inputs only. No production legal identity, policy or series is seeded.
const issuer = {
  mode: "fixture",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  seller: {
    legalName: "Synthetic seller",
    address: "Fixture address",
    country: "IN",
    contact: "seller@example.com",
  },
  legalFields: [{ label: "Synthetic registration", value: "TEST-ONLY" }],
  requiredCustomerFields: ["legalName", "address", "invoiceContact"],
  series: {
    invoice: {
      key: "fixture-invoices",
      prefix: "TEST-I-",
      first: "1",
      width: 4,
    },
    credit_note: {
      key: "fixture-credits",
      prefix: "TEST-C-",
      first: "1",
      width: 4,
    },
  },
  currencies: [
    {
      currency: "INR",
      precision: 2,
      rounding: { mode: "half_up", scope: "per_line", incrementMinor: "1" },
      additionalRoundings: [],
    },
  ],
  template: {
    format: "text_v1",
    invoiceTitle: "Seller invoice",
    creditTitle: "Credit note",
    footer: "Synthetic fixture only",
  },
  retention: {
    minimumSeconds: 86400,
    policyReference: "fixture:protected-history",
    disposition: "protected_history",
  },
  creditAllocation: "cumulative_original_components_v1",
  evidence: [
    {
      title: "Fixture legal review",
      reference: "fixture:issuer-review",
      checkedAt: "2026-11-05T08:00:00.000Z",
    },
  ],
};

describe("Seller documents at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => h?.close());
  function compose(storage = createMemoryStorage(), recoveryLeaseSeconds = 60) {
    const put = storage.put.bind(storage);
    storage.put = async (key, object) => {
      if (storage.objects.has(key))
        throw new Error("fixture conditional write conflict");
      return put(key, object);
    };
    const app = createSellerDocumentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage,
      policy: {
        accountScope: "tax-fixture",
        maxBytes: 1000000,
        accessTtlSeconds: 30,
        recoveryLeaseSeconds,
      },
      mode: "fixture",
    });
    return { app, storage };
  }
  async function operator() {
    const headers = await h.signIn("documents@example.com");
    const actor = await h.authenticate(headers);
    await h.admin.query(
      "INSERT INTO platform_operator(user_id,documents) VALUES($1,true)",
      [actor.userId],
    );
    return headers;
  }
  async function reviewedPurchase(
    options: Parameters<typeof subscriptionFixture>[1] = {},
  ) {
    const f = await subscriptionFixture(h, options),
      gateway = deterministicPayments(h.clock);
    const payments = createSubscriptionPaymentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSubscriptionPaymentRepository(
        runtimeDatabase(h.runtime),
      ),
      clock: h.clock,
      gateway,
    });
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await payments.start(f.owner, f.business.id, { actionId: action.id });
    gateway.confirm(action.operationKey);
    await payments.refresh(f.owner, f.business.id, { actionId: action.id });
    const period = (await payments.workspace(f.owner, f.business.id))
      .periods[0];
    return { ...f, payments, period, gateway };
  }
  async function approve(
    app: ReturnType<typeof compose>["app"],
    op: Headers,
    configuration: unknown = issuer,
    expectedVersion = 0,
  ) {
    const state = await app.saveIssuer(op, {
      expectedVersion,
      configuration,
      note: "Synthetic exact draft",
    });
    await app.decideIssuer(op, {
      revisionId: state.revisions.at(-1)!.id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Synthetic exact approval",
    });
  }
  it("requires a current document operator with MFA and records exact-version issuer approval", async () => {
    const op = await operator(),
      { app } = compose();
    const state = await h.access.status(op);
    expect(state).toMatchObject({
      operator: true,
      operatorVerified: true,
      required: true,
    });
    const catalog = await app.saveIssuer(op, {
      expectedVersion: 0,
      configuration: issuer,
      note: "Fixture review draft",
    });
    expect(catalog.revisions[0]).toMatchObject({
      version: 1,
      configuration: issuer,
    });
    expect(catalog.decisions).toEqual([]);
    const approved = await app.decideIssuer(op, {
      revisionId: catalog.revisions[0].id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Fixture exact legal/numbering/template review",
    });
    expect(approved.decisions[0]).toMatchObject({
      revisionId: catalog.revisions[0].id,
      outcome: "approved",
    });
    const outsider = await h.signIn("ordinary@example.com");
    await expect(app.catalog(outsider)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      app.saveIssuer(op, {
        expectedVersion: 0,
        configuration: issuer,
        note: "stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    h.clock.set("2026-11-05T09:16:00Z");
    await expect(app.catalog(op)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
  });
  it("issues native test-charge invoices and renewal credits with immutable exact charge evidence while live issuance stays isolated", async () => {
    const f = await subscriptionFixture(h),
      native = razorpayFixture(h.clock),
      payments = createSubscriptionPaymentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway: configuredPayments(native.configuration),
      }),
      { app, storage } = compose(),
      op = await operator();
    await approve(app, op);
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await payments.start(f.owner, f.business.id, { actionId: action.id });
    native.charge(
      "pay_initial",
      "2026-11-05T09:00:00.000Z",
      "2026-12-05T09:00:00.000Z",
    );
    await payments.recover();
    const initialPeriod = (await payments.workspace(f.owner, f.business.id))
      .periods[0];
    const original = await app.issue(f.owner, f.business.id, {
      periodId: initialPeriod.id,
      requestKey: randomUUID(),
    });
    expect(original.snapshot).toMatchObject({
      source: { charge: initialPeriod.charge },
      financial: { provider: { mode: "test" }, tax: { mode: "fixture" } },
    });
    const rules = await f.tax.saveRule(f.operator, {
      key: f.rules.revisions[0].key,
      expectedVersion: 1,
      note: "Synthetic later registration evidence",
      rule: {
        ...f.rules.revisions[0].rule,
        effectiveFrom: "2026-12-01T00:00:00.000Z",
        registration: {
          ...f.rules.revisions[0].rule.registration,
          identifier: "RENEWAL-REGISTRATION",
        },
      },
    });
    await f.tax.decideRule(f.operator, {
      revisionId: rules.revisions.at(-1)!.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic renewal approval",
    });
    await h.admin.query(
      "UPDATE business_file SET retention_until='2028-01-01' WHERE business_id=$1",
      [f.business.id],
    );
    h.clock.set("2026-12-05T09:00:00.000Z");
    native.charge(
      "pay_renewal",
      "2026-12-05T09:00:00.000Z",
      "2027-01-05T09:00:00.000Z",
    );
    await payments.recover();
    const owner = await h.signIn("tax-owner@example.com"),
      currentOp = await h.signIn("documents@example.com"),
      periods = (await payments.workspace(owner, f.business.id)).periods;
    expect(periods).toHaveLength(2);
    const renewal = periods[1],
      invoice = await app.issue(owner, f.business.id, {
        periodId: renewal.id,
        requestKey: randomUUID(),
      });
    expect(invoice.number).toBe("TEST-I-0002");
    expect(invoice.snapshot).toMatchObject({
      source: { paymentId: "pay_renewal", charge: renewal.charge },
      financial: {
        basis: { kind: "renewal" },
        tax: { purpose: "subscription_charge" },
      },
      lines: [
        {
          rule: {
            revision: {
              version: 2,
              rule: { registration: { identifier: "RENEWAL-REGISTRATION" } },
            },
          },
        },
      ],
      totals: { netMinor: "10005", taxMinor: "1001", totalMinor: "11006" },
    });
    expect(invoice.snapshot.financial).toEqual(renewal.snapshot);
    const input = {
      invoiceId: invoice.id,
      periodId: renewal.id,
      paymentId: renewal.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: {
        kind: "refund",
        reference: "fixture-native-renewal-correction",
      },
      reason: "Synthetic reviewed native renewal correction",
      evidence: ["fixture:approved-correction"],
      lines: [{ lineId: "subscription", netMinor: "3335" }],
    };
    const credit = await app.adjust(currentOp, f.business.id, input);
    expect(credit.snapshot).toMatchObject({
      source: { paymentId: "pay_renewal", charge: renewal.charge },
      original: { id: invoice.id },
      totals: { netMinor: "3335", taxMinor: "334", totalMinor: "3669" },
    });
    expect(
      (
        await app.adjust(currentOp, f.business.id, {
          ...input,
          requestKey: randomUUID(),
        })
      ).id,
    ).toBe(credit.id);
    await payments.recover();
    expect(
      (await app.workspace(owner, f.business.id)).documents.find(
        (d) => d.id === original.id,
      ),
    ).toEqual(original);
    expect(native.creations).toHaveLength(1);
    const grant = await app.createAccess(owner, f.business.id, invoice.id),
      downloaded = await app.download(
        owner,
        f.business.id,
        invoice.id,
        grant.token,
      ),
      text = new TextDecoder().decode(downloaded.bytes);
    expect(text).toContain("inv_renewal");
    expect(text).toContain("order_renewal");
    expect(text).toContain("Payment mode: test");
    const live = createSellerDocumentApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createSellerDocumentRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      mode: "live",
      storage,
      policy: {
        accountScope: "tax-fixture",
        maxBytes: 1000000,
        accessTtlSeconds: 30,
        recoveryLeaseSeconds: 60,
      },
    });
    await expect(
      live.issue(owner, f.business.id, {
        periodId: renewal.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      live.adjust(currentOp, f.business.id, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("issues one numbered invoice from real reviewed payment evidence under concurrent requests and rejects changed-key payloads", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app, storage } = compose();
    const input = { periodId: f.period.id, requestKey: randomUUID() };
    await expect(
      app.issue(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "SELLER_DOCUMENT_SETUP_REQUIRED" });
    await approve(app, op);
    const [a, b] = await Promise.all([
      app.issue(f.owner, f.business.id, input),
      app.issue(f.owner, f.business.id, { ...input, requestKey: randomUUID() }),
    ]);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({
      number: "TEST-I-0001",
      kind: "invoice",
      snapshot: {
        source: { periodId: f.period.id, paymentId: f.period.paymentId },
        totals: { netMinor: "10005", taxMinor: "1001", totalMinor: "11006" },
        financial: { tax: { status: "calculated" } },
      },
    });
    expect(
      (await app.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(1);
    const artifact = [...storage.objects.values()][0];
    expect(new TextDecoder().decode(artifact.bytes)).toContain(
      "Seller invoice TEST-I-0001",
    );
    expect(new TextDecoder().decode(artifact.bytes)).toContain("INR 110.06");
    await expect(
      app.issue(f.owner, f.business.id, { ...input, periodId: randomUUID() }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.issue(f.owner, f.business.id, { ...input, amountMinor: "1" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("retains the issued identity through failed or ambiguous conditional storage and authenticates private actor-bound downloads", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app, storage } = compose();
    await approve(app, op);
    storage.failPut = true;
    const input = { periodId: f.period.id, requestKey: randomUUID() };
    const failed = await app.issue(f.owner, f.business.id, input);
    expect(failed.artifact).toMatchObject({
      state: "failed",
      failure: "ARTIFACT_UNCONFIRMED",
    });
    storage.failPut = false;
    storage.failAfterPut = true;
    const recovered = await app.recover(f.owner, f.business.id, {
      documentId: failed.id,
    });
    expect(recovered).toMatchObject({
      id: failed.id,
      number: failed.number,
      artifact: { state: "ready", failure: null },
    });
    const grant = await app.createAccess(f.owner, f.business.id, failed.id);
    const download = await app.download(
      f.owner,
      f.business.id,
      failed.id,
      grant.token,
    );
    expect(new TextDecoder().decode(download.bytes)).toContain(
      "Seller invoice TEST-I-0001",
    );
    const other = await h.signIn("other@example.com");
    await expect(
      app.download(other, f.business.id, failed.id, grant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    h.clock.set("2026-11-05T09:00:31Z");
    await expect(
      app.download(f.owner, f.business.id, failed.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    const state = await app.workspace(f.owner, f.business.id);
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0].artifact).toMatchObject({ state: "ready" });
    expect(state.storageUsage).toMatchObject({
      putAttempts: 2,
      getAttempts: 3,
    });
  });
  it("records bounded cumulative partial credits using original tax allocations and deduplicates an adjustment across request keys", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    const invoice = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    const input = {
      invoiceId: invoice.id,
      periodId: f.period.id,
      paymentId: f.period.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "refund", reference: "fixture-refund-1" },
      reason: "Synthetic partial correction",
      evidence: ["fixture:approved-correction"],
      lines: [{ lineId: "subscription", netMinor: "3335" }],
    };
    await expect(
      app.adjust(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [one, duplicate] = await Promise.all([
      app.adjust(op, f.business.id, input),
      app.adjust(op, f.business.id, { ...input, requestKey: randomUUID() }),
    ]);
    expect(one.id).toBe(duplicate.id);
    expect(one).toMatchObject({
      kind: "credit_note",
      number: "TEST-C-0001",
      snapshot: {
        original: { id: invoice.id, number: invoice.number },
        totals: { netMinor: "3335", taxMinor: "334", totalMinor: "3669" },
        adjustment: { reason: input.reason, adjustmentId: input.adjustmentId },
      },
    });
    const two = await app.adjust(op, f.business.id, {
      ...input,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "refund", reference: "fixture-refund-2" },
    });
    expect(two.snapshot.totals).toEqual({
      netMinor: "3335",
      taxMinor: "333",
      totalMinor: "3668",
    });
    const three = await app.adjust(op, f.business.id, {
      ...input,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "dispute", reference: "fixture-dispute-3" },
    });
    expect(three.snapshot.totals).toEqual({
      netMinor: "3335",
      taxMinor: "334",
      totalMinor: "3669",
    });
    await expect(
      app.adjust(op, f.business.id, {
        ...input,
        requestKey: randomUUID(),
        adjustmentId: randomUUID(),
        source: { kind: "manual", reference: "over-credit" },
        lines: [{ lineId: "subscription", netMinor: "1" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.adjust(op, f.business.id, {
        ...input,
        reason: "changed",
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      app.adjust(op, f.business.id, {
        ...input,
        paymentId: "foreign",
        requestKey: randomUUID(),
        adjustmentId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await app.workspace(f.owner, f.business.id)).documents.find(
        (d) => d.id === invoice.id,
      ),
    ).toEqual(invoice);
  });
  it("recovers persisted artifact intents through a restarted worker without purchaser impersonation", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app, storage } = compose();
    await approve(app, op);
    storage.failPut = true;
    const document = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    await h.signOut(f.owner);
    storage.failPut = false;
    // Valid file policies can choose a grace interval above the Node timer bound;
    // the persisted recovery lease is a PostgreSQL interval, not an I/O timer.
    const restarted = compose(storage, 2147484).app;
    expect(await restarted.recoverPending()).toMatchObject({
      attempted: 1,
      failed: 0,
    });
    const owner = await h.signIn("tax-owner@example.com");
    expect(
      (await restarted.workspace(owner, f.business.id)).documents[0],
    ).toMatchObject({
      id: document.id,
      number: document.number,
      artifact: { state: "ready" },
    });
    expect(await restarted.recoverPending()).toMatchObject({ attempted: 0 });
  });
  it("serves private attachments through authenticated HTTP grants and keeps public failures safe", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    const http = createSellerDocumentHttp({
      application: app,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const headers = new Headers(f.owner);
    headers.set("origin", "http://localhost:3000");
    headers.set("content-type", "application/json");
    const response = await http.issue(
      new Request("http://localhost:3000/api/documents", {
        method: "POST",
        headers,
        body: JSON.stringify({
          periodId: f.period.id,
          requestKey: randomUUID(),
        }),
      }),
      f.business.id,
    );
    expect(response.status).toBe(200);
    const id = (await app.workspace(f.owner, f.business.id)).documents[0].id;
    const grant = await app.createAccess(f.owner, f.business.id, id);
    headers.set("x-file-token", grant.token);
    const result = await http.download(
      new Request("http://localhost:3000/api/content", { headers }),
      f.business.id,
      id,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("content-disposition")).toContain("attachment;");
    expect(result.headers.get("content-security-policy")).toBe("sandbox");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await result.text()).toContain("Seller invoice TEST-I-0001");
    const invalid = await http.download(
      new Request("http://localhost:3000/api/content", { headers }),
      randomUUID(),
      id,
    );
    expect(invalid.status).toBe(404);
    expect(await invalid.text()).not.toMatch(
      /private-provider|recovery_key|SELECT|postgres|sha256/i,
    );
    const foreignHeaders = new Headers(headers);
    foreignHeaders.set("origin", "https://foreign.example");
    expect(
      (
        await http.issue(
          new Request("http://localhost:3000/api/documents", {
            method: "POST",
            headers: foreignHeaders,
            body: "{}",
          }),
          f.business.id,
        )
      ).status,
    ).toBe(403);
  });
  it("keeps originals unchanged after customer, seller, registration, tax and price changes while later paid periods select effective versions", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    const first = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    await approve(
      app,
      op,
      {
        ...issuer,
        effectiveFrom: "2026-12-06T00:00:00.000Z",
        seller: { ...issuer.seller, legalName: "Synthetic seller v2" },
      },
      1,
    );
    await f.billing.save(f.owner, f.business.id, {
      expectedVersion: 1,
      note: "Customer name changed after payment",
      profile: {
        ...f.quote.profile.profile,
        legalName: "Changed synthetic customer",
      },
    });
    expect(
      (
        await app.issue(f.owner, f.business.id, {
          periodId: f.period.id,
          requestKey: randomUUID(),
        })
      ).snapshot,
    ).toEqual(first.snapshot);
    h.clock.set("2026-12-06T09:00:00Z");
    const owner = await h.signIn("tax-owner@example.com"),
      taxOperator = await h.signIn("tax-operator@example.com"),
      docOperator = await h.signIn("documents@example.com");
    const file = await f.files.beginUpload(owner, f.business.id, {
      purpose: "billing",
      name: "new-evidence.txt",
      contentType: "text/plain",
      size: 5,
    });
    await f.files.completeUpload(
      owner,
      f.business.id,
      file.file.id,
      file.token,
      new TextEncoder().encode("legal"),
    );
    const profile = (await f.billing.workspace(owner, f.business.id)).current!
      .profile;
    await f.billing.save(owner, f.business.id, {
      expectedVersion: 2,
      note: "Fresh customer evidence",
      profile: {
        ...profile,
        evidence: profile.evidence.map((e) => ({ ...e, fileId: file.file.id })),
      },
    });
    await f.billing.review(taxOperator, f.business.id, {
      expectedVersion: 3,
      expectedReviewVersion: 1,
      outcome: "reviewed",
      findings: [],
      note: "Reviewed updated synthetic identity",
    });
    const rule = await f.tax.saveRule(taxOperator, {
      key: "fixture",
      expectedVersion: 1,
      note: "Synthetic changed registration and rate",
      rule: {
        ...f.rules.revisions[0].rule,
        effectiveFrom: "2026-12-06T00:00:00.000Z",
        registration: {
          ...f.rules.revisions[0].rule.registration,
          identifier: "TEST-ONLY-2",
        },
        rates: [{ name: "Synthetic tax", numerator: "1", denominator: "5" }],
      },
    });
    await f.tax.decideRule(taxOperator, {
      revisionId: rule.revisions.at(-1)!.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic changed tax approved",
    });
    await f.quotes.configure(taxOperator, {
      expectedVersion: 1,
      effectiveFrom: null,
      note: "Synthetic updated price",
      offers: [
        {
          ...f.quote.pricing.offer,
          prices: {
            ...f.quote.pricing.offer.prices,
            INR: { monthlyMinor: 20010, pilotMinor: 1000 },
          },
        },
      ],
    });
    const quote = await f.quotes.createQuote(owner, f.business.id, {
      offerId: "fixture",
      reservedCapacityId: null,
      term: "monthly",
      expectedCatalogVersion: 2,
      expectedBillingVersion: 3,
      expectedReviewVersion: 2,
      requestKey: randomUUID(),
    });
    const action = await f.payments.prepare(owner, f.business.id, {
      quoteId: quote.snapshot.id,
      requestKey: randomUUID(),
    });
    await f.payments.start(owner, f.business.id, { actionId: action.id });
    f.gateway.confirm(action.operationKey);
    await f.payments.refresh(owner, f.business.id, { actionId: action.id });
    const period = (
      await f.payments.workspace(owner, f.business.id)
    ).periods.find((p) => p.id !== f.period.id)!;
    const later = await app.issue(owner, f.business.id, {
      periodId: period.id,
      requestKey: randomUUID(),
    });
    expect(later).toMatchObject({
      number: "TEST-I-0002",
      snapshot: {
        issuer: {
          revision: {
            version: 2,
            configuration: { seller: { legalName: "Synthetic seller v2" } },
          },
        },
        totals: { netMinor: "20010", taxMinor: "4002", totalMinor: "24012" },
        financial: {
          tax: {
            billing: {
              current: { profile: { legalName: "Changed synthetic customer" } },
            },
          },
        },
      },
    });
    expect(
      later.snapshot.lines[0].rule.revision.rule.registration.identifier,
    ).toBe("TEST-ONLY-2");
    const credit = await app.adjust(docOperator, f.business.id, {
      invoiceId: first.id,
      periodId: first.periodId,
      paymentId: first.snapshot.source.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "manual", reference: "fixture-original-correction" },
      reason: "Correct original after rate changed",
      evidence: ["fixture:review"],
      lines: [{ lineId: "subscription", netMinor: "10005" }],
    });
    expect(credit.snapshot.totals).toEqual({
      netMinor: "10005",
      taxMinor: "1001",
      totalMinor: "11006",
    });
    expect(
      credit.snapshot.lines[0].rule.revision.rule.registration.identifier,
    ).toBe("TEST-ONLY");
    expect(
      (await app.workspace(owner, f.business.id)).documents.find(
        (d) => d.id === first.id,
      ),
    ).toEqual(first);
  });
  it("denies staff, foreign Businesses, reused grants and revoked roles before releasing bytes", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app, storage } = compose();
    await approve(app, op);
    const doc = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    const staff = await h.signIn("staff@example.com"),
      staffActor = await h.authenticate(staff),
      admin = await h.signIn("admin@example.com"),
      adminActor = await h.authenticate(admin);
    await h.admin.query(
      "INSERT INTO membership(business_id,user_id,role) VALUES($1,$2,'salesperson'),($1,$3,'admin')",
      [f.business.id, staffActor.userId, adminActor.userId],
    );
    await expect(app.workspace(staff, f.business.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      app.issue(staff, f.business.id, {
        periodId: f.period.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const foreign = await h.application.createBusiness(admin, {
      name: "Foreign Business",
      offering: "Fixture",
      homeMarket: "Pune",
      website: "",
    });
    await expect(
      app.issue(admin, foreign.id, {
        periodId: f.period.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const grant = await app.createAccess(f.owner, f.business.id, doc.id);
    await expect(
      app.download(admin, f.business.id, doc.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    const adminGrant = await app.createAccess(admin, f.business.id, doc.id);
    storage.afterGet = async () => {
      await h.admin.query(
        "UPDATE membership SET role='salesperson' WHERE business_id=$1 AND user_id=$2",
        [f.business.id, adminActor.userId],
      );
    };
    await expect(
      app.download(admin, f.business.id, doc.id, adminGrant.token),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    storage.afterGet = null;
    const operatorGrant = await app.createAccess(
        op,
        f.business.id,
        doc.id,
        true,
      ),
      operatorActor = await h.authenticate(op);
    await h.admin.query(
      "UPDATE platform_operator SET documents=false WHERE user_id=$1",
      [operatorActor.userId],
    );
    await expect(
      app.download(op, f.business.id, doc.id, operatorGrant.token, true),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("protects issued history from generic file deletion, expiry, cleanup and metadata purge", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app, storage } = compose();
    await approve(app, op);
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage,
      policy: {
        accountScope: "tax-fixture",
        maxBytes: 1000000,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        recordRetentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
      },
    });
    const doc = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    await expect(
      files.deleteFile(f.owner, f.business.id, doc.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    h.clock.set("2026-11-08T09:00:00Z");
    await files.cleanup();
    await files.cleanup();
    const owner = await h.signIn("tax-owner@example.com"),
      grant = await app.createAccess(owner, f.business.id, doc.id);
    expect(
      new TextDecoder().decode(
        (await app.download(owner, f.business.id, doc.id, grant.token)).bytes,
      ),
    ).toContain(doc.number);
    expect(
      storage.effects
        .filter((e) => e.action === "delete")
        .every((e) => e.key.startsWith("business-files/")),
    ).toBe(true);
    expect((await app.workspace(owner, f.business.id)).documents[0]).toEqual(
      doc,
    );
  });
  it("rejects an operational paid fixture without authoritative reviewed charge tax lines", async () => {
    const owner = await h.signIn("operational@example.com"),
      business = await h.application.createBusiness(owner, {
        name: "Operational fixture",
        offering: "Fixture",
        homeMarket: "Pune",
        website: "",
      }),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    await persistPaidSubscription(h, owner, business.id, {
      markets: ["Pune"],
      discovery: { quantity: 1, unit: "research units" },
      automation: { quantity: 1, unit: "provider calls" },
    });
    const period = (await app.workspace(owner, business.id)).periods[0];
    await expect(
      app.issue(owner, business.id, {
        periodId: period.id,
        requestKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("preserves real financial history through schema reapplication and detects missing SELECT and INSERT privileges independently", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    const doc = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    await prepareDatabaseRole(h.admin);
    await expect(verifyRuntimeRole(h.runtime)).rejects.toBeDefined();
    await h.admin.query(
      "ALTER TABLE subscription_period DROP CONSTRAINT subscription_period_scope; ALTER TABLE subscription_period ADD CONSTRAINT subscription_period_scope UNIQUE(id,business_id); ALTER TABLE seller_document DROP CONSTRAINT seller_document_scope; ALTER TABLE seller_document ADD CONSTRAINT seller_document_scope UNIQUE(id,business_id)",
    );
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect((await app.workspace(f.owner, f.business.id)).documents[0]).toEqual(
      doc,
    );
    for (const table of [
      "seller_issuer_revision",
      "seller_issuer_decision",
      "seller_document",
      "seller_document_request",
      "seller_document_access",
      "seller_document_storage",
    ])
      for (const privilege of ["SELECT", "INSERT"]) {
        await h.admin.query(`REVOKE ${privilege} ON ${table} FROM app_runtime`);
        await expect(verifyRuntimeRole(h.runtime)).rejects.toBeDefined();
        await secureDatabase(h.admin);
        await verifyRuntimeRole(h.runtime);
      }
    for (const signature of [
      "seller_next_number(uuid,text,bigint)",
      "seller_artifact_worker_authorized(uuid,uuid)",
      "claim_seller_artifacts(text,integer)",
    ]) {
      await h.admin.query(
        `REVOKE EXECUTE ON FUNCTION public.${signature} FROM app_runtime`,
      );
      await expect(verifyRuntimeRole(h.runtime)).rejects.toBeDefined();
      await secureDatabase(h.admin);
      await verifyRuntimeRole(h.runtime);
    }
    expect(
      (
        await h.runtime.query(
          "SELECT * FROM claim_seller_artifacts('tax-fixture',0)",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await h.runtime.query(
          "SELECT seller_artifact_worker_authorized($1,$2) AS allowed",
          [doc.id, f.business.id],
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  it("issues USD from its captured billing basis without assuming an exemption", async () => {
    const f = await reviewedPurchase({ country: "US" }),
      op = await operator(),
      { app } = compose();
    await approve(app, op, {
      ...issuer,
      currencies: [{ ...issuer.currencies[0], currency: "USD" }],
    });
    const doc = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    expect(doc.snapshot).toMatchObject({
      currency: "USD",
      precision: 2,
      totals: { netMinor: "2500", taxMinor: "250", totalMinor: "2750" },
    });
    expect(doc.snapshot.lines[0].rule.revision.rule.treatment).toBe("taxable");
  });
  it("serializes distinct partial adjustments so concurrent credits cannot exceed a line balance", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    const doc = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    const request = (ref: string) => ({
      invoiceId: doc.id,
      periodId: doc.periodId,
      paymentId: doc.snapshot.source.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "manual", reference: ref },
      reason: "Concurrent correction",
      evidence: ["fixture:review"],
      lines: [{ lineId: "subscription", netMinor: "6000" }],
    });
    const outcomes = await Promise.allSettled([
      app.adjust(op, f.business.id, request("one")),
      app.adjust(op, f.business.id, request("two")),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (await app.workspace(f.owner, f.business.id)).documents.filter(
        (d) => d.kind === "credit_note",
      ),
    ).toHaveLength(1);
  });
  it("keeps failed artifacts numbered when a conflicting object cannot reconcile its bytes and metadata", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app, storage } = compose();
    await approve(app, op);
    storage.failPut = true;
    const doc = await app.issue(f.owner, f.business.id, {
      periodId: f.period.id,
      requestKey: randomUUID(),
    });
    storage.objects.set(`seller-documents/${f.business.id}/${doc.id}`, {
      bytes: new TextEncoder().encode("corrupt"),
      contentType: "text/plain",
      metadata: {
        businessId: f.business.id,
        fileId: doc.id,
        ownerId: "foreign",
        sha256: "0".repeat(64),
      },
    });
    storage.failPut = false;
    expect(
      await app.recover(f.owner, f.business.id, { documentId: doc.id }),
    ).toMatchObject({
      id: doc.id,
      number: doc.number,
      artifact: { state: "failed" },
    });
    await expect(
      app.createAccess(f.owner, f.business.id, doc.id),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect(
      (await app.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(1);
  });
  it("gates drafts, withdrawn effective versions, unsupported rounding and caller approval claims", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose(),
      input = { periodId: f.period.id, requestKey: randomUUID() };
    const draft = await app.saveIssuer(op, {
      expectedVersion: 0,
      configuration: issuer,
      note: "Synthetic unapproved draft",
    });
    await expect(
      app.issue(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "SELLER_DOCUMENT_SETUP_REQUIRED" });
    await expect(
      app.issue(f.owner, f.business.id, { ...input, approved: true }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await app.decideIssuer(op, {
      revisionId: draft.revisions[0].id,
      expectedVersion: 0,
      outcome: "approved",
      note: "Reviewed",
    });
    await approve(
      app,
      op,
      {
        ...issuer,
        currencies: [
          {
            ...issuer.currencies[0],
            rounding: { ...issuer.currencies[0].rounding, mode: "down" },
          },
        ],
      },
      1,
    );
    await expect(
      app.issue(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "SELLER_DOCUMENT_SETUP_REQUIRED" });
    const state = await app.catalog(op);
    await app.decideIssuer(op, {
      revisionId: state.revisions[1].id,
      expectedVersion: 1,
      outcome: "withdrawn",
      note: "Withdraw superseding version",
    });
    await expect(
      app.issue(f.owner, f.business.id, input),
    ).rejects.toMatchObject({ code: "SELLER_DOCUMENT_SETUP_REQUIRED" });
    await expect(
      app.saveIssuer(op, {
        expectedVersion: 2,
        configuration: {
          ...issuer,
          series: {
            ...issuer.series,
            invoice: { ...issuer.series.invoice, prefix: "CHANGED-" },
          },
        },
        note: "Invalid series reuse",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("allocates one shared seller series across isolated Businesses without exposing another Business history", async () => {
    const f = await reviewedPurchase(),
      op = await operator(),
      { app } = compose();
    await approve(app, op);
    const owner = await h.signIn("second-buyer@example.com"),
      business = await h.application.createBusiness(owner, {
        name: "Second buyer",
        offering: "Fixture",
        homeMarket: "Pune",
        website: "",
      });
    const upload = await f.files.beginUpload(owner, business.id, {
      name: "second-evidence.txt",
      purpose: "billing",
      contentType: "text/plain",
      size: 5,
    });
    await f.files.completeUpload(
      owner,
      business.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("legal"),
    );
    await f.billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Synthetic second buyer",
      profile: {
        ...f.quote.profile.profile,
        legalName: "Second synthetic buyer",
        evidence: f.quote.profile.profile.evidence.map((e) => ({
          ...e,
          fileId: upload.file.id,
        })),
      },
    });
    await f.billing.review(f.operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 0,
      outcome: "reviewed",
      findings: [],
      note: "Second buyer reviewed",
    });
    const q = await f.quotes.createQuote(owner, business.id, {
      offerId: "fixture",
      reservedCapacityId: null,
      term: "monthly",
      expectedCatalogVersion: 1,
      expectedBillingVersion: 1,
      expectedReviewVersion: 1,
      requestKey: randomUUID(),
    });
    const action = await f.payments.prepare(owner, business.id, {
      quoteId: q.snapshot.id,
      requestKey: randomUUID(),
    });
    await f.payments.start(owner, business.id, { actionId: action.id });
    f.gateway.confirm(action.operationKey);
    await f.payments.refresh(owner, business.id, { actionId: action.id });
    const period = (await f.payments.workspace(owner, business.id)).periods[0];
    const docs = await Promise.all([
      app.issue(f.owner, f.business.id, {
        periodId: f.period.id,
        requestKey: randomUUID(),
      }),
      app.issue(owner, business.id, {
        periodId: period.id,
        requestKey: randomUUID(),
      }),
    ]);
    expect(docs.map((d) => d.number).sort()).toEqual([
      "TEST-I-0001",
      "TEST-I-0002",
    ]);
    expect(
      (await app.workspace(f.owner, f.business.id)).documents,
    ).toHaveLength(1);
    await expect(app.workspace(owner, f.business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await app.queue(op)).toHaveLength(2);
  });
  it("apportions original subtotal-rounded multiple tax components without losing the final remainder", async () => {
    const f = await subscriptionFixture(h),
      op = await operator(),
      { app } = compose();
    const rounding = {
      mode: "half_even",
      scope: "subtotal",
      incrementMinor: "5",
    };
    await approve(app, op, {
      ...issuer,
      currencies: [{ ...issuer.currencies[0], rounding }],
    });
    const rules = await f.tax.saveRule(f.operator, {
      key: "fixture",
      expectedVersion: 1,
      note: "Synthetic subtotal components",
      rule: {
        ...f.rules.revisions[0].rule,
        rounding,
        rates: [
          { name: "Component A", numerator: "1", denominator: "20" },
          { name: "Component B", numerator: "1", denominator: "20" },
        ],
      },
    });
    await f.tax.decideRule(f.operator, {
      revisionId: rules.revisions.at(-1)!.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic components approved",
    });
    const gateway = deterministicPayments(h.clock),
      payments = createSubscriptionPaymentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway,
      });
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: f.quote.id,
      requestKey: randomUUID(),
    });
    await payments.start(f.owner, f.business.id, { actionId: action.id });
    gateway.confirm(action.operationKey);
    await payments.refresh(f.owner, f.business.id, { actionId: action.id });
    const period = (await payments.workspace(f.owner, f.business.id))
        .periods[0],
      invoice = await app.issue(f.owner, f.business.id, {
        periodId: period.id,
        requestKey: randomUUID(),
      });
    expect(invoice.snapshot.totals).toEqual({
      netMinor: "10005",
      taxMinor: "1000",
      totalMinor: "11005",
    });
    const taxCredits: string[] = [];
    for (const reference of ["part-1", "part-2", "part-3"]) {
      const credit = await app.adjust(op, f.business.id, {
        invoiceId: invoice.id,
        periodId: period.id,
        paymentId: period.paymentId,
        requestKey: randomUUID(),
        adjustmentId: randomUUID(),
        source: { kind: "manual", reference },
        reason: "Synthetic partial component correction",
        evidence: ["fixture:approval"],
        lines: [{ lineId: "subscription", netMinor: "3335" }],
      });
      taxCredits.push(credit.snapshot.totals.taxMinor);
    }
    expect(taxCredits).toEqual(["330", "340", "330"]);
  });
  it("preserves independently rounded captured lines and credits only the selected original line", async () => {
    const f = await subscriptionFixture(h),
      op = await operator(),
      { app } = compose();
    const rounding = { mode: "down", scope: "per_line", incrementMinor: "1" };
    await approve(app, op, {
      ...issuer,
      currencies: [
        { ...issuer.currencies[0], additionalRoundings: [rounding] },
      ],
    });
    const rules = await f.tax.saveRule(f.operator, {
      key: "capacity",
      expectedVersion: 0,
      note: "Synthetic independent capacity rounding",
      rule: {
        ...f.rules.revisions[0].rule,
        productCode: "reserved_capacity",
        rounding,
      },
    });
    await f.tax.decideRule(f.operator, {
      revisionId: rules.revisions.find((r) => r.key === "capacity")!.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic capacity approved",
    });
    await f.quotes.configure(f.operator, {
      expectedVersion: 1,
      effectiveFrom: null,
      note: "Synthetic capacity price",
      offers: [
        {
          ...f.quote.pricing.offer,
          reservedCapacity: [
            {
              id: "capacity",
              label: "Synthetic reservation",
              capacity: { quantity: 1, unit: "capacity units" },
              prices: {
                INR: { monthlyMinor: 1003, pilotMinor: null },
                USD: null,
              },
            },
          ],
        },
      ],
    });
    const quote = await f.quotes.createQuote(f.owner, f.business.id, {
      offerId: "fixture",
      reservedCapacityId: "capacity",
      term: "monthly",
      expectedCatalogVersion: 2,
      expectedBillingVersion: 1,
      expectedReviewVersion: 1,
      requestKey: randomUUID(),
    });
    const gateway = deterministicPayments(h.clock),
      payments = createSubscriptionPaymentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
        ),
        clock: h.clock,
        gateway,
      });
    const action = await payments.prepare(f.owner, f.business.id, {
      quoteId: quote.snapshot.id,
      requestKey: randomUUID(),
    });
    await payments.start(f.owner, f.business.id, { actionId: action.id });
    gateway.confirm(action.operationKey);
    await payments.refresh(f.owner, f.business.id, { actionId: action.id });
    const period = (await payments.workspace(f.owner, f.business.id))
        .periods[0],
      invoice = await app.issue(f.owner, f.business.id, {
        periodId: period.id,
        requestKey: randomUUID(),
      });
    expect(invoice.snapshot.totals).toEqual({
      netMinor: "11008",
      taxMinor: "1101",
      totalMinor: "12109",
    });
    const credit = await app.adjust(op, f.business.id, {
      invoiceId: invoice.id,
      periodId: period.id,
      paymentId: period.paymentId,
      requestKey: randomUUID(),
      adjustmentId: randomUUID(),
      source: { kind: "manual", reference: "capacity-partial" },
      reason: "Synthetic selected capacity correction",
      evidence: ["fixture:approval"],
      lines: [{ lineId: "reserved_capacity", netMinor: "501" }],
    });
    expect(credit.snapshot.totals).toEqual({
      netMinor: "501",
      taxMinor: "49",
      totalMinor: "550",
    });
    expect(credit.snapshot.lines).toHaveLength(1);
    expect(credit.snapshot.lines[0].input.id).toBe("reserved_capacity");
    expect(
      (await app.workspace(f.owner, f.business.id)).documents.find(
        (d) => d.id === invoice.id,
      ),
    ).toEqual(invoice);
  });
});
