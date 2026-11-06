import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { createBillingApplication } from "../src/application/billing";
import { createBillingRepository } from "../src/db/billing-repository";
import { createTaxApplication } from "../src/application/tax";
import { createTaxRepository } from "../src/db/tax-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createFileApplication } from "../src/application/files";
import { createFileRepository } from "../src/db/file-repository";
import { createMemoryStorage } from "./support/storage";
import { createTaxHttp } from "../src/http/tax";
import { taxCalculationSchema } from "../src/models/tax";
import { verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";

describe("Subscription tax at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let tax: ReturnType<typeof createTaxApplication<Headers>>;
  let billing: ReturnType<typeof createBillingApplication<Headers>>;
  beforeEach(async () => {
    h = await createHarness();
    const dependencies = {
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      clock: h.clock,
    };
    billing = createBillingApplication({
      ...dependencies,
      repository: createBillingRepository(runtimeDatabase(h.runtime)),
    });
    tax = createTaxApplication({
      ...dependencies,
      repository: createTaxRepository(runtimeDatabase(h.runtime)),
      mode: "fixture",
    });
  });
  afterEach(async () => h?.close());

  async function setup(country = "IN") {
    const owner = await h.signIn("tax-owner@example.com");
    const operator = await h.signIn("tax-operator@example.com");
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    const business = await h.application.createBusiness(owner, {
      name: "Fixture Business",
      offering: "Steel",
      homeMarket: "Pune",
      website: "",
    });
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage: createMemoryStorage(),
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: "tax-fixture",
      },
    });
    const upload = await files.beginUpload(owner, business.id, {
      name: "fixture.txt",
      contentType: "text/plain",
      size: 5,
      purpose: "billing",
    });
    await files.completeUpload(
      owner,
      business.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("legal"),
    );
    await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Synthetic billing evidence",
      profile: {
        legalName: "Synthetic buyer",
        registrationNumber: "fixture-only",
        address: {
          line1: "Fixture address",
          line2: "",
          city: "Fixture city",
          region: "MH",
          postalCode: "00000",
          country,
        },
        invoiceContact: { name: "Accounts", email: "accounts@example.com" },
        businessStatus: "business",
        taxIdentifierStatus: "not_applicable",
        taxIdentifiers: [],
        evidence: ["legal_identity", "billing_address", "business_status"].map(
          (kind) => ({
            kind,
            fileId: upload.file.id,
            note: "Synthetic fixture claim",
          }),
        ),
      },
    });
    await billing.review(operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 0,
      outcome: "reviewed",
      findings: [],
      note: "Synthetic evidence reviewed; treatment is separate",
    });
    return { owner, operator, business, files, fileId: upload.file.id };
  }

  const rule = {
    mode: "fixture",
    customerCountry: "IN",
    customerRegion: null,
    buyerStatus: "business",
    currency: "INR",
    productCode: "subscription",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    jurisdiction: {
      code: "fixture-domestic",
      name: "Synthetic domestic jurisdiction",
      country: "IN",
    },
    registration: {
      status: "registered",
      identifier: "TEST-ONLY",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
    },
    treatment: "taxable",
    rationale: "Synthetic example, no legal rate or registration assertion",
    requiredEvidence: ["legal_identity", "billing_address", "business_status"],
    rates: [{ name: "Synthetic tax", numerator: "1", denominator: "10" }],
    rounding: { mode: "half_up", scope: "per_line", incrementMinor: "1" },
    evidence: [
      {
        title: "Synthetic fixture policy",
        reference: "fixture:domestic-v1",
        checkedAt: "2026-11-05T08:00:00.000Z",
      },
    ],
  };
  function request(currency = "INR") {
    return {
      requestKey: randomUUID(),
      expectedProfileVersion: 1,
      expectedReviewVersion: 1,
      currency,
      lines: [
        {
          id: "pilot",
          productCode: "subscription",
          description: "Synthetic amount, not a commercial price",
          unitAmountMinor: "10005",
          quantity: 1,
        },
      ],
      note: "Tax preview only",
    };
  }
  async function approve(
    operator: Headers,
    key: string,
    value: unknown = rule,
    expectedVersion = 0,
  ) {
    const catalog = await tax.saveRule(operator, {
      key,
      expectedVersion,
      rule: value,
      note: "Synthetic configuration",
    });
    const revision = catalog.revisions.at(-1)!;
    await tax.decideRule(operator, {
      revisionId: revision.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Reviewed synthetic configuration",
    });
    return revision;
  }

  it("does not resurrect superseded coverage when a newer approved revision changes jurisdiction or expires", async () => {
    const { owner, operator, business } = await setup();
    await approve(operator, "moving-coverage");
    expect((await tax.calculate(owner, business.id, request())).status).toBe(
      "calculated",
    );
    await approve(
      operator,
      "moving-coverage",
      { ...rule, customerCountry: "US", currency: "USD" },
      1,
    );
    expect((await tax.calculate(owner, business.id, request())).status).toBe(
      "review_required",
    );
    await approve(
      operator,
      "moving-coverage",
      { ...rule, effectiveUntil: "2026-11-05T09:01:00.000Z" },
      2,
    );
    h.clock.set("2026-11-05T09:01:00Z");
    expect((await tax.calculate(owner, business.id, request())).status).toBe(
      "review_required",
    );
  });

  it("calculates a domestic preview using approved rules, exact currency rounding and retained reviewed evidence", async () => {
    const { owner, operator, business } = await setup();
    const revision = await approve(operator, "domestic");
    const input = request();
    const calculated = await tax.calculate(owner, business.id, input);
    expect(calculated).toMatchObject({
      status: "calculated",
      reasons: [],
      currency: "INR",
      totals: { netMinor: "10005", taxMinor: "1001", totalMinor: "11006" },
      at: "2026-11-05T09:00:00.000Z",
    });
    expect(calculated.lines[0]).toMatchObject({
      netMinor: "10005",
      taxMinor: "1001",
      totalMinor: "11006",
      rule: {
        revision: { id: revision.id, version: 1 },
        approval: { outcome: "approved" },
      },
    });
    expect(calculated.billing).toMatchObject({
      status: "reviewed",
      current: {
        version: 1,
        profile: { legalName: "Synthetic buyer" },
        evidence: [{ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }],
      },
    });
    expect(await tax.calculate(owner, business.id, input)).toEqual(calculated);
    expect((await tax.workspace(owner, business.id)).calculations).toEqual([
      calculated,
    ]);
  });

  it("requires explicit international coverage and records authorized treatment resolution without changing the original request", async () => {
    const { owner, operator, business } = await setup("US");
    const original = await tax.calculate(owner, business.id, request("USD"));
    expect(original).toMatchObject({
      status: "review_required",
      totals: null,
      reasons: [
        {
          kind: "unsupported",
          code: "unsupported_tax_treatment",
          lineId: "pilot",
        },
      ],
    });
    const international = {
      ...rule,
      customerCountry: "US",
      currency: "USD",
      treatment: "export",
      rates: [],
      jurisdiction: { ...rule.jurisdiction, code: "fixture-international" },
      rationale:
        "Synthetic reviewed export fixture, not a foreign-address exemption",
    };
    const draft = await tax.saveRule(operator, {
      key: "international",
      expectedVersion: 0,
      rule: international,
      note: "Draft is not approval",
    });
    const stillUnresolved = await tax.calculate(
      owner,
      business.id,
      request("USD"),
    );
    expect(stillUnresolved.status).toBe("review_required");
    expect(stillUnresolved.configuration.revisions).toEqual(draft.revisions);
    await tax.decideRule(operator, {
      revisionId: draft.revisions[0].id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic evidence supports this fixture treatment",
    });
    const resolution = {
      calculationId: original.id,
      requestKey: randomUUID(),
      expectedProfileVersion: 1,
      expectedReviewVersion: 1,
      note: "Resolve with explicitly approved synthetic treatment",
    };
    await expect(
      tax.resolve(owner, business.id, resolution),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const resolved = await tax.resolve(operator, business.id, resolution);
    expect(resolved.reasons).toEqual([]);
    expect(resolved).toMatchObject({
      resolvesId: original.id,
      status: "calculated",
      totals: { netMinor: "10005", taxMinor: "0", totalMinor: "10005" },
      lines: [{ rule: { revision: { rule: { treatment: "export" } } } }],
    });
    expect(await tax.resolve(operator, business.id, resolution)).toEqual(
      resolved,
    );
    const workspace = await tax.workspace(owner, business.id);
    expect(workspace.calculations[0]).toEqual(original);
    expect(
      (await tax.reviewQueue(operator)).map((entry) => entry.calculation.id),
    ).toEqual([stillUnresolved.id]);
  });

  it("exposes scoped HTTP commands with origin protection, strict input and safe public failures", async () => {
    const { owner, operator, business } = await setup();
    const http = createTaxHttp({
      application: tax,
      origin: "http://localhost:3000",
      reportFailure: (diagnostic) => h.diagnostics.push(diagnostic),
    });
    const makeRequest = (
      headers: Headers,
      body: unknown,
      origin = "http://localhost:3000",
    ) => {
      const copied = new Headers(headers);
      copied.set("origin", origin);
      copied.set("content-type", "application/json");
      return new Request("http://localhost:3000/api/tax", {
        method: "POST",
        headers: copied,
        body: JSON.stringify(body),
      });
    };
    expect(
      (
        await http.saveRule(
          makeRequest(owner, {
            key: "domestic",
            expectedVersion: 0,
            rule,
            note: "Cannot self authorize",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http.calculate(
          makeRequest(owner, request(), "https://foreign.example"),
          business.id,
        )
      ).status,
    ).toBe(403);
    const invalid = await http.calculate(
      makeRequest(owner, {
        ...request(),
        lines: [{ ...request().lines[0], unitAmountMinor: "1.005" }],
        password: "private-untrusted-value",
      }),
      business.id,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("private-untrusted-value");
    await approve(operator, "domestic");
    const response = await http.calculate(
      makeRequest(owner, request()),
      business.id,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { purpose: "tax_preview", totals: { totalMinor: "11006" } },
    });
    expect(
      (
        await http.get(
          new Request("http://localhost:3000/api/tax", { headers: owner }),
          business.id,
        )
      ).status,
    ).toBe(200);
  });

  it("applies half-even, down and subtotal allocation explicitly without losing currency precision", async () => {
    const { owner, operator, business } = await setup();
    await approve(operator, "rounding", {
      ...rule,
      rounding: { ...rule.rounding, mode: "half_even" },
    });
    const even = await tax.calculate(owner, business.id, request());
    expect(even.totals).toEqual({
      netMinor: "10005",
      taxMinor: "1000",
      totalMinor: "11005",
    });
    await approve(
      operator,
      "rounding",
      { ...rule, rounding: { ...rule.rounding, scope: "subtotal" } },
      1,
    );
    const input = request();
    const subtotal = await tax.calculate(owner, business.id, {
      ...input,
      lines: [
        { ...input.lines[0], id: "b", unitAmountMinor: "5" },
        { ...input.lines[0], id: "a", unitAmountMinor: "5" },
      ],
    });
    expect(
      subtotal.lines.map((line) => [line.input.id, line.taxMinor]),
    ).toEqual([
      ["b", "0"],
      ["a", "1"],
    ]);
    expect(subtotal.totals).toEqual({
      netMinor: "10",
      taxMinor: "1",
      totalMinor: "11",
    });
    await approve(
      operator,
      "rounding",
      {
        ...rule,
        rounding: { mode: "down", scope: "per_line", incrementMinor: "5" },
      },
      2,
    );
    expect((await tax.calculate(owner, business.id, request())).totals).toEqual(
      { netMinor: "10005", taxMinor: "1000", totalMinor: "11005" },
    );
    await approve(operator, "rounding", rule, 3);
    const precise = await tax.calculate(owner, business.id, {
      ...request(),
      lines: [{ ...input.lines[0], unitAmountMinor: "9007199254740993" }],
    });
    expect(precise.totals).toEqual({
      netMinor: "9007199254740993",
      taxMinor: "900719925474099",
      totalMinor: "9907919180215092",
    });
    expect(taxCalculationSchema.safeParse(precise).success).toBe(true);
  });

  it("retains conflicting rule evidence, resolves through withdrawal and preserves calculations across subsequent rule/profile changes", async () => {
    const { owner, operator, business } = await setup();
    await approve(operator, "first");
    const ambiguous = await approve(operator, "second", {
      ...rule,
      treatment: "exempt",
      rates: [],
    });
    const original = await tax.calculate(owner, business.id, request());
    expect(original).toMatchObject({
      status: "review_required",
      totals: null,
      reasons: [{ kind: "conflicting", code: "ambiguous_tax_rules" }],
    });
    expect(original.configuration.decisions).toHaveLength(2);
    await tax.decideRule(operator, {
      revisionId: ambiguous.id,
      expectedDecisionVersion: 1,
      outcome: "withdrawn",
      note: "Resolve overlapping fixture coverage",
    });
    const approved = await tax.resolve(operator, business.id, {
      calculationId: original.id,
      requestKey: randomUUID(),
      expectedProfileVersion: 1,
      expectedReviewVersion: 1,
      note: "Re-evaluated against unambiguous coverage",
    });
    expect(approved.totals?.totalMinor).toBe("11006");
    const profile = (await billing.workspace(owner, business.id)).current!
      .profile;
    await billing.save(owner, business.id, {
      expectedVersion: 1,
      profile: { ...profile, legalName: "Changed buyer" },
      note: "Change buyer after calculation",
    });
    await approve(
      operator,
      "first",
      {
        ...rule,
        rates: [
          { name: "New synthetic rate", numerator: "1", denominator: "5" },
        ],
      },
      1,
    );
    const next = await tax.calculate(owner, business.id, {
      ...request(),
      expectedProfileVersion: 2,
    });
    expect(next.status).toBe("review_required");
    await billing.review(operator, business.id, {
      expectedVersion: 2,
      expectedReviewVersion: 1,
      outcome: "reviewed",
      findings: [],
      note: "Review new identity revision",
    });
    const revised = await tax.calculate(owner, business.id, {
      ...request(),
      expectedProfileVersion: 2,
      expectedReviewVersion: 2,
    });
    expect(revised.totals?.totalMinor).toBe("12006");
    const all = (await tax.workspace(owner, business.id)).calculations;
    expect(all[0]).toEqual(original);
    expect(all[1]).toEqual(approved);
    expect(all[1].billing.current?.profile.legalName).toBe("Synthetic buyer");
  });

  it("uses half-open effective and registration windows and reviews expired or conflicting current billing evidence", async () => {
    const { owner, operator, business, files, fileId } = await setup();
    await approve(operator, "dated", {
      ...rule,
      effectiveUntil: "2026-11-05T09:01:00.000Z",
    });
    await approve(
      operator,
      "dated",
      {
        ...rule,
        effectiveFrom: "2026-11-05T09:01:00.000Z",
        registration: {
          ...rule.registration,
          effectiveFrom: "2026-11-05T09:02:00.000Z",
        },
      },
      1,
    );
    const first = await tax.calculate(owner, business.id, request());
    expect(first.status).toBe("calculated");
    h.clock.set("2026-11-05T09:01:00Z");
    expect(
      (await tax.calculate(owner, business.id, request())).reasons,
    ).toContainEqual({
      kind: "missing",
      code: "registration_not_effective",
      lineId: "pilot",
    });
    h.clock.set("2026-11-05T09:02:00Z");
    expect((await tax.calculate(owner, business.id, request())).status).toBe(
      "calculated",
    );
    await billing.review(operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 1,
      outcome: "conflicting",
      findings: ["Fixture document conflict"],
      note: "Later conflict",
    });
    expect(
      (
        await tax.calculate(owner, business.id, {
          ...request(),
          expectedReviewVersion: 2,
        })
      ).reasons,
    ).toContainEqual({
      kind: "conflicting",
      code: "billing_evidence_not_reviewed",
      lineId: null,
    });
    await billing.review(operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 2,
      outcome: "reviewed",
      findings: [],
      note: "Conflict resolved",
    });
    await files.deleteFile(owner, business.id, fileId);
    expect(
      (
        await tax.calculate(owner, business.id, {
          ...request(),
          expectedReviewVersion: 3,
        })
      ).reasons,
    ).toContainEqual({
      kind: "missing",
      code: "evidence_unavailable",
      lineId: null,
    });
    expect((await tax.workspace(owner, business.id)).calculations[0]).toEqual(
      first,
    );
  });

  it("checks current Business/operator/MFA authority, fixture isolation and concurrent idempotency", async () => {
    const { owner, operator, business } = await setup();
    await approve(operator, "domestic");
    const input = request();
    const [first, duplicate] = await Promise.all([
      tax.calculate(owner, business.id, input),
      tax.calculate(owner, business.id, input),
    ]);
    expect(first).toEqual(duplicate);
    await expect(
      tax.calculate(owner, business.id, { ...input, note: "Changed retry" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const foreign = await h.signIn("foreign-tax@example.com");
    await expect(tax.workspace(foreign, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      tax.calculate(foreign, business.id, request()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const admin = await h.signIn("tax-admin@example.com");
    await h.team.invite(owner, business.id, {
      email: "tax-admin@example.com",
      role: "admin",
    });
    await h.team.accept(admin, {
      token: new URLSearchParams(
        new URL(h.invitations.sent.at(-1)!.url).hash.slice(1),
      ).get("token"),
    });
    expect((await tax.workspace(admin, business.id)).calculations).toHaveLength(
      1,
    );
    await expect(tax.rules(admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      tax.saveRule(admin, {
        key: "bad",
        expectedVersion: 0,
        rule,
        note: "No operator grant",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const live = createTaxApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      clock: h.clock,
      repository: createTaxRepository(runtimeDatabase(h.runtime)),
      mode: "live",
    });
    expect((await live.calculate(owner, business.id, request())).status).toBe(
      "review_required",
    );
    await approve(operator, "live-domestic", { ...rule, mode: "live" });
    expect((await live.calculate(owner, business.id, request())).status).toBe(
      "calculated",
    );
    await h.provisionOperator(operator, { tax: false, reconciliation: true });
    await expect(tax.rules(operator)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    h.clock.set("2026-11-05T09:15:00Z");
    await expect(
      tax.reviewWorkspace(operator, business.id),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await h.team.removeMember(owner, business.id, {
      userId: (await h.authenticate(admin)).userId,
    });
    await expect(tax.workspace(admin, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("keeps financial history immutable and verifies required database security after schema reapplication", async () => {
    const { owner, operator, business } = await setup();
    await approve(operator, "domestic");
    const original = await tax.calculate(owner, business.id, request());
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect((await tax.workspace(owner, business.id)).calculations).toEqual([
      original,
    ]);
    for (const table of [
      "tax_rule_revision",
      "tax_rule_decision",
      "tax_calculation",
    ]) {
      await expect(
        h.runtime.query(`UPDATE ${table} SET actor_id=actor_id`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        h.runtime.query(`DELETE FROM ${table}`),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await h.admin.query(
      "GRANT UPDATE(snapshot) ON tax_calculation TO app_runtime",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await secureDatabase(h.admin);
    await verifyRuntimeRole(h.runtime);
    await h.admin.query(
      "ALTER TABLE tax_rule_decision NO FORCE ROW LEVEL SECURITY",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await secureDatabase(h.admin);
    await verifyRuntimeRole(h.runtime);
  });
});
