import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { createBillingApplication } from "../src/application/billing";
import { createBillingRepository } from "../src/db/billing-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createFileApplication } from "../src/application/files";
import { createFileRepository } from "../src/db/file-repository";
import { createMemoryStorage } from "./support/storage";
import { createBillingHttp } from "../src/http/billing";
import { verifyRuntimeRole } from "../src/db/runtime";
import { secureDatabase } from "../src/db/setup";

describe("Business billing profiles at the application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let billing: ReturnType<typeof createBillingApplication<Headers>>;
  beforeEach(async () => {
    h = await createHarness();
    billing = createBillingApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createBillingRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
    });
  });
  afterEach(async () => h?.close());

  const details = {
    indiaTaxTreatment: "standard",
    legalName: "Example legal entity",
    registrationNumber: "",
    address: {
      line1: "1 Market Street",
      line2: "",
      city: "Pune",
      region: "MH",
      postalCode: "411001",
      country: "IN",
    },
    invoiceContact: { name: "Accounts", email: "accounts@example.com" },
    businessStatus: "business",
    taxIdentifierStatus: "unknown",
    taxIdentifiers: [],
    evidence: [],
  };
  async function setup() {
    const owner = await h.signIn("billing-owner@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "Example",
      offering: "Steel",
      homeMarket: "United States",
      website: "",
    });
    return { owner, business };
  }

  it("accepts an attributable domestic declaration without inventing document verification or granting operator authority", async () => {
    const { owner, business } = await setup();
    const { evidence, ...facts } = details;
    void evidence;
    const input = {
      expectedVersion: 0,
      expectedReviewVersion: 0,
      acceptedTerms: true,
      profile: { ...facts, taxIdentifierStatus: "not_applicable" },
    };
    const state = await billing.confirm(owner, business.id, input);
    expect(state).toMatchObject({
      status: "reviewed",
      version: 1,
      reviewVersion: 1,
      issues: [],
      current: {
        evidence: [],
        profile: {
          evidence: [],
          declaration: { version: "2026-11-10", acceptedTerms: true },
        },
      },
    });
    expect(state.reviews[0].note).toBe(
      "Customer-declared billing details; no independent identity or tax verification.",
    );
    await expect(
      billing.confirm(owner, business.id, input),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      billing.review(owner, business.id, {
        expectedVersion: 1,
        expectedReviewVersion: 1,
        outcome: "reviewed",
        findings: [],
        note: "Pretend operator review",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      billing.save(owner, business.id, {
        expectedVersion: 1,
        note: "Forged declaration",
        profile: state.current!.profile,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const actor = await h.authenticate(owner);
    const client = await h.runtime.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "select set_config('app.actor_id',$1,true),set_config('app.business_id',$2,true)",
        [actor.userId, business.id],
      );
      await expect(
        client.query(
          "insert into billing_profile_review(id,business_id,profile_id,profile_version,version,outcome,findings,note,actor_id,actor_name,at) values(gen_random_uuid(),$1,$2,1,2,'reviewed','[]','Pretend operator review',$3,'Owner',now())",
          [business.id, state.current!.id, actor.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rejects outsider and salesperson declarations, unsupported countries and incomplete or inconsistent tax facts", async () => {
    const { owner, business } = await setup();
    const { evidence, ...facts } = details;
    void evidence;
    const input = {
      expectedVersion: 0,
      expectedReviewVersion: 0,
      acceptedTerms: true,
      profile: { ...facts, taxIdentifierStatus: "not_applicable" },
    };
    const outsider = await h.signIn("billing-outsider-declaration@example.com");
    const salesperson = await invite(
      owner,
      business.id,
      "billing-sales-declaration@example.com",
      "salesperson",
    );
    await expect(
      billing.confirm(outsider, business.id, input),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      billing.confirm(salesperson, business.id, input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const profile of [
      { ...input.profile, address: { ...facts.address, country: "US" } },
      { ...input.profile, legalName: "" },
      { ...input.profile, taxIdentifierStatus: "provided", taxIdentifiers: [] },
    ])
      await expect(
        billing.confirm(owner, business.id, { ...input, profile }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await billing.workspace(owner, business.id)).version).toBe(0);
  });

  function fileApplication() {
    const storage = createMemoryStorage();
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage,
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: "billing-fixture",
      },
    });
    return { storage, files };
  }
  async function invite(
    owner: Headers,
    businessId: string,
    email: string,
    role: "admin" | "salesperson",
  ) {
    const headers = await h.signIn(email);
    await h.team.invite(owner, businessId, { email, role });
    const message = h.invitations.sent.at(-1)!;
    await h.team.accept(headers, {
      token: new URLSearchParams(new URL(message.url).hash.slice(1)).get(
        "token",
      ),
    });
    return headers;
  }

  it("saves incomplete details explicitly and preserves each billing snapshot independently of discovery geography", async () => {
    const { owner, business } = await setup();
    expect(await billing.workspace(owner, business.id)).toMatchObject({
      version: 0,
      current: null,
      status: "missing",
    });
    const first = await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Initial billing details",
      profile: details,
    });
    expect(first).toMatchObject({
      version: 1,
      status: "missing",
      currency: "INR",
      classification: "india",
    });
    expect(first.issues).toContain("tax_identifier_status");
    h.clock.set("2026-11-05T09:01:00Z");
    const next = await billing.save(owner, business.id, {
      expectedVersion: 1,
      note: "Move legal billing address",
      profile: {
        ...details,
        legalName: "Changed legal entity",
        address: { ...details.address, country: "US" },
      },
    });
    expect(next).toMatchObject({
      version: 2,
      currency: "USD",
      classification: "international",
      status: "missing",
    });
    const saved = await billing.workspace(owner, business.id);
    expect(
      saved.history.map((entry) => ({
        name: entry.profile.legalName,
        country: entry.profile.address.country,
        at: entry.at,
      })),
    ).toEqual([
      {
        name: "Example legal entity",
        country: "IN",
        at: "2026-11-05T09:00:00.000Z",
      },
      {
        name: "Changed legal entity",
        country: "US",
        at: "2026-11-05T09:01:00.000Z",
      },
    ]);
    expect(
      (await h.application.getProfile(owner, business.id)).homeMarket,
    ).toBe("United States");
    await expect(
      billing.save(owner, business.id, {
        expectedVersion: 1,
        note: "Stale save",
        profile: details,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("attaches only completed financial evidence owned by the Business and keeps it private from salespeople", async () => {
    const { owner, business } = await setup();
    const { files, storage } = fileApplication();
    const upload = await files.beginUpload(owner, business.id, {
      name: "legal.txt",
      contentType: "text/plain",
      size: 5,
      purpose: "billing",
    });
    const profile = {
      ...details,
      evidence: [
        {
          kind: "legal_identity",
          fileId: upload.file.id,
          note: "Registration record",
        },
      ],
    };
    await expect(
      billing.save(owner, business.id, {
        expectedVersion: 0,
        note: "Pending file",
        profile,
      }),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    await files.completeUpload(
      owner,
      business.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("legal"),
    );
    const saved = await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Evidence supplied",
      profile,
    });
    expect(saved.current?.evidence[0]).toMatchObject({
      name: "legal.txt",
      fileId: upload.file.id,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const salesperson = await invite(
      owner,
      business.id,
      "billing-sales@example.com",
      "salesperson",
    );
    await expect(
      billing.workspace(salesperson, business.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await files.list(salesperson, business.id)).files).toEqual([]);
    expect((await files.list(salesperson, business.id)).usage.putAttempts).toBe(
      0,
    );
    await expect(
      files.createAccess(salesperson, business.id, upload.file.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const admin = await invite(
      owner,
      business.id,
      "billing-admin@example.com",
      "admin",
    );
    expect((await billing.workspace(admin, business.id)).version).toBe(1);
    const grant = await files.createAccess(admin, business.id, upload.file.id);
    expect(
      new TextDecoder().decode(
        (await files.download(admin, business.id, upload.file.id, grant.token))
          .bytes,
      ),
    ).toBe("legal");
    const other = await h.signIn("other-billing@example.com");
    const otherBusiness = await h.application.createBusiness(other, {
      name: "Other",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    await expect(billing.workspace(other, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      billing.save(other, otherBusiness.id, {
        expectedVersion: 0,
        note: "Foreign file",
        profile,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.team.removeMember(owner, business.id, {
      userId: (await h.authenticate(admin)).userId,
    });
    await expect(billing.workspace(admin, business.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      billing.save(admin, business.id, {
        expectedVersion: 1,
        note: "Revoked admin",
        profile: details,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      files.download(admin, business.id, upload.file.id, grant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.effects.map((effect) => effect.action)).toEqual([
      "put",
      "get",
    ]);
    await expect(
      files.deleteFile(owner, business.id, upload.file.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    h.clock.set("2026-11-05T11:00:00Z");
    const afterDeletion = await billing.workspace(owner, business.id);
    expect(afterDeletion.current?.evidence).toEqual(saved.current?.evidence);
    expect(afterDeletion.issues).toContain("evidence_unavailable");
  });

  it("routes missing and conflicting evidence to separately authorized operators with immutable revision-specific reviews", async () => {
    const { owner, business } = await setup();
    const operator = await h.signIn("tax-review@example.com");
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    const reconciliation = await h.signIn("bank-review@example.com");
    await h.provisionOperator(reconciliation, {
      tax: false,
      reconciliation: true,
    });
    await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Incomplete profile",
      profile: details,
    });
    await expect(billing.reviewQueue(owner)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(billing.reviewQueue(reconciliation)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(
      (await billing.reviewQueue(operator)).map((entry) => [
        entry.businessId,
        entry.status,
      ]),
    ).toEqual([[business.id, "missing"]]);
    await expect(
      billing.review(owner, business.id, {
        expectedVersion: 1,
        expectedReviewVersion: 0,
        outcome: "reviewed",
        findings: [],
        note: "Self approval",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      billing.review(operator, business.id, {
        expectedVersion: 1,
        expectedReviewVersion: 0,
        outcome: "reviewed",
        findings: [],
        note: "Incomplete",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const conflict = await billing.review(operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 0,
      outcome: "conflicting",
      findings: ["Address does not match registration"],
      note: "Compare registered address",
    });
    expect(conflict.status).toBe("conflicting");
    expect(conflict.reviews[0]).toMatchObject({
      profileVersion: 1,
      outcome: "conflicting",
      actorId: (await h.authenticate(operator)).userId,
      at: "2026-11-05T09:00:00.000Z",
    });
    const { files } = fileApplication();
    const upload = await files.beginUpload(owner, business.id, {
      name: "registration.txt",
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
    const complete = {
      ...details,
      taxIdentifierStatus: "not_applicable",
      evidence: ["legal_identity", "billing_address", "business_status"].map(
        (kind) => ({ kind, fileId: upload.file.id, note: "Supporting record" }),
      ),
    };
    expect(
      (
        await billing.save(owner, business.id, {
          expectedVersion: 1,
          note: "Resolve evidence",
          profile: complete,
        })
      ).status,
    ).toBe("pending_review");
    await expect(
      billing.review(operator, business.id, {
        expectedVersion: 1,
        expectedReviewVersion: 1,
        outcome: "reviewed",
        findings: [],
        note: "Stale revision",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const reviewed = await billing.review(operator, business.id, {
      expectedVersion: 2,
      expectedReviewVersion: 1,
      outcome: "reviewed",
      findings: [],
      note: "Identity evidence reviewed; no tax treatment assigned",
    });
    expect(reviewed.status).toBe("reviewed");
    expect(await billing.reviewQueue(operator)).toEqual([]);
    await expect(
      billing.review(operator, business.id, {
        expectedVersion: 2,
        expectedReviewVersion: 1,
        outcome: "missing",
        findings: ["Another check"],
        note: "Stale decision",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (
        await billing.save(owner, business.id, {
          expectedVersion: 2,
          note: "Contact changes",
          profile: {
            ...complete,
            invoiceContact: { name: "New accounts", email: "new@example.com" },
          },
        })
      ).status,
    ).toBe("pending_review");
    expect((await billing.workspace(owner, business.id)).reviews).toEqual(
      reviewed.reviews,
    );
    await h.provisionOperator(operator, { tax: false, reconciliation: false });
    await expect(billing.reviewQueue(operator)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows fresh tax operators to retrieve financial evidence only and rechecks grants, MFA and retention", async () => {
    const { owner, business } = await setup();
    const { files, storage } = fileApplication();
    const operator = await h.signIn("private-review@example.com");
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    const reviewFiles = createFileApplication({
      authenticate: h.access.authenticatePlatform,
      repository: createFileRepository(runtimeDatabase(h.runtime), {
        billingReview: true,
      }),
      clock: h.clock,
      storage,
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: "billing-fixture",
      },
    });
    const financial = await files.beginUpload(owner, business.id, {
      name: "financial.txt",
      contentType: "text/plain",
      size: 5,
      purpose: "billing",
    });
    const general = await files.beginUpload(owner, business.id, {
      name: "sales.txt",
      contentType: "text/plain",
      size: 5,
    });
    for (const upload of [financial, general])
      await files.completeUpload(
        owner,
        business.id,
        upload.file.id,
        upload.token,
        new TextEncoder().encode("legal"),
      );
    expect(
      (await reviewFiles.list(operator, business.id)).files.map((f) => f.name),
    ).toEqual(["financial.txt"]);
    await expect(
      reviewFiles.createAccess(operator, business.id, general.file.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await h.provisionOperator(owner, { tax: true, reconciliation: false });
    await expect(
      reviewFiles.createAccess(owner, business.id, general.file.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const grant = await reviewFiles.createAccess(
      operator,
      business.id,
      financial.file.id,
    );
    expect(
      new TextDecoder().decode(
        (
          await reviewFiles.download(
            operator,
            business.id,
            financial.file.id,
            grant.token,
          )
        ).bytes,
      ),
    ).toBe("legal");
    await expect(
      reviewFiles.beginUpload(operator, business.id, {
        name: "attempt.txt",
        contentType: "text/plain",
        size: 5,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.provisionOperator(operator, { tax: false, reconciliation: false });
    await expect(
      reviewFiles.download(
        operator,
        business.id,
        financial.file.id,
        grant.token,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    h.clock.set("2026-11-05T09:16:00Z");
    await expect(billing.reviewQueue(operator)).rejects.toMatchObject({
      code: "MFA_REQUIRED",
    });
    await h.reverifyAuthenticator(operator);
    expect((await reviewFiles.list(operator, business.id)).canManage).toBe(
      false,
    );
    h.clock.set("2026-11-05T10:01:00Z");
    await h.reverifyAuthenticator(operator);
    await expect(
      reviewFiles.createAccess(operator, business.id, financial.file.id),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect(storage.effects.map((effect) => effect.action)).toEqual([
      "put",
      "put",
      "get",
    ]);
  });

  it("validates HTTP input, rejects foreign origins and keeps errors and diagnostics safe", async () => {
    const { owner, business } = await setup();
    const http = createBillingHttp({
      application: billing,
      origin: "http://localhost:3000",
      reportFailure: (entry) => h.diagnostics.push(entry),
    });
    function request(value: unknown, origin = "http://localhost:3000") {
      const headers = new Headers(owner);
      headers.set("content-type", "application/json");
      headers.set("origin", origin);
      return new Request(
        `http://localhost:3000/api/businesses/${business.id}/billing`,
        { method: "PUT", headers, body: JSON.stringify(value) },
      );
    }
    expect(
      (
        await http.save(
          request(
            { expectedVersion: 0, note: "Valid", profile: details },
            "https://foreign.example",
          ),
          business.id,
        )
      ).status,
    ).toBe(403);
    for (const profile of [
      { ...details, taxExempt: true },
      { ...details, invoiceContact: { name: "A", email: "bad" } },
      { ...details, address: { ...details.address, country: "not-a-country" } },
      { ...details, address: { ...details.address, country: "ZZ" } },
    ]) {
      const response = await http.save(
        request({ expectedVersion: 0, note: "Invalid", profile }),
        business.id,
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("bad");
    }
    expect(
      (
        await http.save(
          request({ expectedVersion: 0, note: "Safe save", profile: details }),
          business.id,
        )
      ).status,
    ).toBe(200);
    const missing = await http.get(
      new Request("http://localhost:3000", { headers: owner }),
      "not-a-uuid",
    );
    expect(missing.status).toBe(400);
    expect(JSON.stringify(h.diagnostics)).not.toContain("accounts@example.com");
  });

  it("preserves financial history and access controls when applying the database schema again", async () => {
    const { owner, business } = await setup();
    const saved = await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Before schema reapplication",
      profile: details,
    });
    const operator = await h.signIn("schema-review@example.com");
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    const reviewed = await billing.review(operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 0,
      outcome: "missing",
      findings: ["Supply registration evidence"],
      note: "Documents not supplied",
    });
    for (const table of [
      "billing_profile_revision",
      "billing_profile_review",
    ]) {
      expect((await h.runtime.query(`SELECT id FROM ${table}`)).rows).toEqual(
        [],
      );
      await expect(
        h.runtime.query(`UPDATE ${table} SET note = 'rewrite'`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        h.runtime.query(`DELETE FROM ${table}`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(h.runtime.query(`TRUNCATE ${table}`)).rejects.toMatchObject({
        code: "42501",
      });
    }
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    expect((await billing.workspace(owner, business.id)).history).toEqual(
      saved.history,
    );
    expect((await billing.workspace(owner, business.id)).reviews).toEqual(
      reviewed.reviews,
    );
    await h.admin.query(
      "ALTER TABLE billing_profile_review DISABLE ROW LEVEL SECURITY",
    );
    await expect(verifyRuntimeRole(h.runtime)).rejects.toMatchObject({
      code: "SETUP_REQUIRED",
    });
    await h.admin.query(
      "ALTER TABLE billing_profile_review ENABLE ROW LEVEL SECURITY",
    );
    await secureDatabase(h.admin);
    await verifyRuntimeRole(h.runtime);
  });

  it("keeps contradictory declarations in review and serializes concurrent profile edits", async () => {
    const { owner, business } = await setup();
    const result = await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Unresolved declarations",
      profile: {
        ...details,
        taxIdentifierStatus: "not_applicable",
        taxIdentifiers: [
          {
            kind: "GSTIN",
            country: "IN",
            value: "customer-supplied-identifier",
          },
        ],
      },
    });
    expect(result).toMatchObject({ status: "conflicting", currency: "INR" });
    expect(result.issues).toContain("conflicting_tax_identifiers");
    const edits = await Promise.allSettled([
      billing.save(owner, business.id, {
        expectedVersion: 1,
        note: "First concurrent edit",
        profile: details,
      }),
      billing.save(owner, business.id, {
        expectedVersion: 1,
        note: "Second concurrent edit",
        profile: details,
      }),
    ]);
    expect(edits.filter((edit) => edit.status === "fulfilled")).toHaveLength(1);
    const failed = edits.find((edit) => edit.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toMatchObject({
      code: "CONFLICT",
    });
    expect((await billing.workspace(owner, business.id)).history).toHaveLength(
      2,
    );
  });
});
