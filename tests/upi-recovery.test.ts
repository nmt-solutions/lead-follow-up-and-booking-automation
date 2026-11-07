import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { fundedUpiFixture, upiFixturePolicy } from "./support/upi";
import { recoveryFixture } from "./support/recovery";
import { recoverySchemaDefinitionHash } from "../src/recovery/postgres";
import { createReachChangeApplication } from "../src/application/reach-changes";
import { createReachChangeRepository } from "../src/db/reach-change-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import type { Pool } from "pg";
import { recoveryTaxFilingFixture } from "./support/recovery-tax-filings";
import { createSellerDocumentApplication } from "../src/application/seller-documents";
import { createSellerDocumentRepository } from "../src/db/seller-document-repository";
import { fixtureIssuer } from "./support/seller-issuer";
import { createMemoryStorage } from "./support/storage";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { recoveryCapacityFixture } from "./support/recovery-capacity";

describe.each(["physical", "reviewed_schema_repair"] as const)(
  "UPI history through %s recovery",
  (mode) => {
    let h: Awaited<ReturnType<typeof createHarness>>;
    let f: Awaited<ReturnType<typeof fundedUpiFixture>>;
    let r: Awaited<ReturnType<typeof recoveryFixture>>;
    let owner: Headers, customer: Headers, operationId: string;
    let before: Record<string, unknown[]>;
    let filings: Awaited<ReturnType<typeof recoveryTaxFilingFixture>>;
    let capacity: Awaited<ReturnType<typeof recoveryCapacityFixture>>;
    let filingBefore: unknown[],
      copies: { id: string; bytes: Buffer; retained: boolean }[];
    const filingTables = [
      "tax_filing_export",
      "tax_filing_policy",
      "tax_filing_policy_decision",
      "tax_filing_intent",
      "tax_filing_event",
      "tax_filing_evidence",
      "tax_filing_bytes",
      "tax_filing_access",
      "tax_remittance_allocation",
      "tax_remittance_review",
    ];
    async function retainedFilings(pool: Pool) {
      const rows = [];
      for (const table of filingTables)
        rows.push({
          table,
          rows: (
            await pool.query(
              `SELECT to_jsonb(r) body FROM public.${table} r ORDER BY id`,
            )
          ).rows,
        });
      return rows;
    }
    const tables = [
      "reach_change",
      "reach_change_event",
      "subscription_payment",
      "subscription_payment_event",
      "subscription_payment_history",
      "subscription_period",
      "subscription_lifecycle_event",
    ];
    async function retained(pool: Pool) {
      const records: Record<string, unknown[]> = {};
      for (const table of tables)
        records[table] = (
          await pool.query(
            `SELECT to_jsonb(r) body FROM public.${table} r WHERE business_id=$1 ORDER BY id`,
            [f.business.id],
          )
        ).rows.map((r) => r.body);
      return records;
    }
    beforeAll(async () => {
      h = await createHarness();
      f = await fundedUpiFixture(h);
      const actor = await h.authenticate(f.operator);
      await h.admin.query(
        "UPDATE platform_operator SET documents=true WHERE user_id=$1",
        [actor.userId],
      );
      const storage = createMemoryStorage(),
        documents = createSellerDocumentApplication({
          authenticate: h.authenticate,
          authenticatePlatform: h.access.authenticatePlatform,
          repository: createSellerDocumentRepository(
            runtimeDatabase(h.runtime),
          ),
          clock: h.clock,
          storage,
          mode: "fixture",
          policy: {
            accountScope: "upi-recovery-files",
            maxBytes: 1000000,
            accessTtlSeconds: 60,
            recoveryLeaseSeconds: 60,
          },
        });
      const issuer = await documents.saveIssuer(f.operator, {
        expectedVersion: 0,
        configuration: fixtureIssuer,
        note: "Recovery fixture issuer",
      });
      await documents.decideIssuer(f.operator, {
        revisionId: issuer.revisions[0].id,
        expectedVersion: 0,
        outcome: "approved",
        note: "Recovery fixture legal review",
      });
      for (const period of [f.original, f.period])
        await documents.issue(f.owner, f.business.id, {
          periodId: period.id,
          requestKey: randomUUID(),
        });
      copies = [...storage.objects.values()].map((o) => ({
        id: o.metadata.fileId,
        bytes: Buffer.from(o.bytes),
        retained: true,
      }));
      h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
      capacity = await recoveryCapacityFixture(h, f);
      filings = await recoveryTaxFilingFixture(h, { native: f.upi });
      filingBefore = await retainedFilings(h.admin);
    });
    beforeAll(async () => {
      before = await retained(h.admin);
      h.clock.set(new Date(vi.getRealSystemTime()).toISOString());
      owner = await h.signIn(`upi-recovery-${randomUUID()}@example.com`);
      const reviewed = await recoverySchemaDefinitionHash(h.admin);
      if (mode === "reviewed_schema_repair")
        await h.admin.query(
          "ALTER TABLE public.business DROP CONSTRAINT business_name_length",
        );
      r = await recoveryFixture(h, owner, f.business.id, copies);
      customer = await h.signIn("tax-owner@example.com");
      if (mode === "reviewed_schema_repair")
        Object.assign(r.plan, { appliedSchemaHash: reviewed });
      const op = await r.request();
      operationId = op.id;
      await r.advance(operationId, 1);
      // A real native cancellation occurs after this archive's cutoff on the ORIGINAL account.
      await f.payments.refresh(customer, f.business.id, {
        actionId: f.change.snapshot.replacementActionId,
      });
      await f.payments.cancel(customer, f.business.id, {
        actionId: f.change.snapshot.replacementActionId,
        requestKey: randomUUID(),
      });
    });
    afterAll(async () => {
      await r?.close();
      await h?.close();
    });
    it("physically restores original accounts, distinct customer mapping, immutable attempts, signed proof, captured money and private validation history", async () => {
      await r.advance(operationId, 1);
      expect(await retained(r.target.admin)).toEqual(before);
      expect(await retainedFilings(r.target.admin)).toEqual(filingBefore);
      expect(JSON.stringify(before.reach_change_event)).toContain("sessionId");
      expect(JSON.stringify(before.subscription_payment)).toContain("cust_upi");
      expect(JSON.stringify(before.subscription_period)).toContain(
        '"method":"upi"',
      );
      expect(f.mutations.at(-1)).toMatchObject({
        account: "upi",
        path: "/v1/subscriptions/sub_fixture1/cancel",
      });
      expect(f.mutations).toHaveLength(4);
    });
    describe("current-source inspection with quarantined queues", () => {
      beforeAll(async () => {
        if (mode === "reviewed_schema_repair")
          r.controls.schemaRunner = () =>
            r.target.reapplySchema({ allowQuarantined: true });
        await r.advance(operationId, 2);
      });
      it("preserves all original UPI rows after managed security/repair, omits private merchant and approval data and refuses restored authority", async () => {
        expect(await retained(r.target.admin)).toEqual(before);
        expect(await retainedFilings(r.target.admin)).toEqual(filingBefore);
        await verifyRuntimeRole(r.target.runtime, { allowQuarantined: true });
        await expect(verifyRuntimeRole(r.target.runtime)).rejects.toMatchObject(
          { code: "SETUP_REQUIRED" },
        );
        const inspection = await r
          .application()
          .inspect(owner, { businessId: f.business.id, operationId });
        expect(JSON.stringify(inspection)).not.toContain("sessionId");
        expect(JSON.stringify(inspection)).not.toContain(
          "fixture account settings/MCC/PSP support",
        );
        expect(JSON.stringify(inspection)).not.toContain("upi-api-secret");
        expect(JSON.stringify(inspection)).not.toContain(filings.marker);
        await capacity.assertRestored(r.target, inspection);
        const targetFilings = filings.application(
          runtimeDatabase(r.target.runtime),
        ).filings;
        expect(
          (await targetFilings.workspace(filings.operator)).intents.find(
            (i) => i.id === filings.filing.intent.id,
          )?.report,
        ).toEqual(filings.originalReport);
        await expect(
          filings.readExpiredOriginal(runtimeDatabase(r.target.runtime)),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await h.admin.query(
          "UPDATE platform_operator SET tax=false WHERE user_id=$1",
          [filings.actor.userId],
        );
        await expect(
          targetFilings.workspace(filings.operator),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await h.admin.query(
          "UPDATE platform_operator SET tax=true WHERE user_id=$1",
          [filings.actor.userId],
        );
        const changes = createReachChangeApplication({
          authenticate: async (credentials: Headers) => {
            await h.team.requireBusinessCapability(
              credentials,
              f.business.id,
              "billing.manage",
            );
            return h.access.authenticateForWork(credentials);
          },
          authenticatePlatform: async (credentials: Headers) => {
            await h.team.requirePlatformCapability(
              credentials,
              "reconciliation.manage",
            );
            return h.access.authenticatePlatformForWork(credentials);
          },
          repository: createReachChangeRepository(
            runtimeDatabase(r.target.runtime),
            h.clock,
          ),
          gateway: f.gateway,
          policy: upiFixturePolicy,
          clock: h.clock,
        });
        expect(
          (await f.changes.workspace(customer, f.business.id)).changes[0].state,
        ).toBe("applied");
        await expect(
          changes.workspace(customer, f.business.id),
        ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
        await expect(
          changes.execute(customer, f.business.id, {
            changeId: f.change.id,
            requestKey: randomUUID(),
          }),
        ).rejects.toBeDefined();
        // Restore the original model instant so the old source session/review is
        // otherwise eligible. The native target remains fenced by PostgreSQL.
        const instant = h.clock.now().toISOString();
        h.clock.set("2026-11-05T09:00:00.000Z");
        try {
          expect(
            (await f.payments.workspace(f.owner, f.business.id)).actions.length,
          ).toBeGreaterThan(0);
          expect(
            (await r.target.runtime.query("SHOW transaction_read_only")).rows[0]
              .transaction_read_only,
          ).toBe("on");
          const restoredPayments = createSubscriptionPaymentApplication({
            authenticate: h.access.authenticateForWork,
            authenticatePlatform: h.access.authenticatePlatformForWork,
            repository: createSubscriptionPaymentRepository(
              runtimeDatabase(r.target.runtime),
            ),
            gateway: f.gateway,
            clock: h.clock,
          });
          await expect(
            restoredPayments.cancel(f.owner, f.business.id, {
              actionId: f.change.snapshot.replacementActionId,
              requestKey: randomUUID(),
            }),
          ).rejects.toMatchObject({ cause: { code: "25006" } });
          expect(f.mutations).toHaveLength(4);
        } finally {
          h.clock.set(instant);
        }
        const actor = await h.authenticate(customer);
        await h.admin.query(
          "UPDATE membership SET role='salesperson' WHERE business_id=$1 AND user_id=$2",
          [f.business.id, actor.userId],
        );
        await expect(
          changes.workspace(customer, f.business.id),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const reconciler = await h.signIn("upi-current-reconciler@example.com");
        await h.provisionOperator(reconciler, {
          tax: false,
          reconciliation: true,
        });
        const current = await f.payments.operatorRefresh(
          reconciler,
          f.business.id,
          { actionId: f.change.snapshot.replacementActionId },
        );
        expect(current.lifecycle?.state).toBe("cancelled");
        expect(f.mutations).toHaveLength(4);
      });
    });
  },
);
