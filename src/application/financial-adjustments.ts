import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import type { createFinancialAdjustmentRepository } from "../db/financial-adjustment-repository";
import { ApplicationError } from "../models/application-error";
import {
  FinancialWriteNotAttempted,
  adjustmentCommandSchema,
  reviewAdjustmentSchema,
  disputeActionSchema,
  disputeIntentSchema,
  reviewCreditSchema,
  creditBasisSchema,
  currentAdjustmentPolicy,
  type FinancialGateway,
  type FinancialWork,
  type AdjustmentIntent,
} from "../models/financial-adjustments";
import type { createSellerDocumentApplication } from "./seller-documents";
import { isDeepStrictEqual } from "node:util";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new ApplicationError("INVALID_INPUT");
  return r.data;
}

export function createFinancialAdjustmentApplication<
  Credentials,
>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: ReturnType<typeof createFinancialAdjustmentRepository>;
  clock: Clock;
  gateway: FinancialGateway;
  documents: ReturnType<
    typeof createSellerDocumentApplication<Credentials>
  > | null;
}) {
  const { repository, clock, gateway } = dependencies;
  async function context(
    credentials: Credentials,
    businessId: unknown,
    operator = true,
  ) {
    const actor = await (operator
      ? dependencies.authenticatePlatform(credentials)
      : dependencies.authenticate(credentials));
    const parsed = z.uuid().safeParse(businessId);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
    await dependencies.repository.authorize(actor, parsed.data, operator);
    return { actor, businessId: parsed.data };
  }
  function policy(intent?: AdjustmentIntent) {
    const selected = currentAdjustmentPolicy(
      gateway.policy,
      clock.now(),
      gateway.account,
      gateway.mode,
    );
    if (intent && !isDeepStrictEqual(selected, intent.policy))
      throw new ApplicationError("SETUP_REQUIRED");
    return selected;
  }
  const worker = (work: FinancialWork) => ({ userId: "", work });
  async function reconcile(work: FinancialWork, allowReopen = false) {
    const read = await repository.read(worker(work), work.business_id, work.id);
    const skip =
      read.events.filter((e) => e.kind === "scan").at(-1)?.detail.skip ?? 0;
    const result = await gateway
      .poll(read.row.intent, read.view.observation, skip)
      .catch(async (error: unknown) => {
        await repository.recordIssue(
          work,
          "native_reconciliation_requires_review",
          clock.now(),
        );
        throw error;
      });
    await repository.record(
      worker(work),
      work.business_id,
      work.id,
      result.observation,
      clock.now(),
      result.skip,
      allowReopen,
    );
    for (const event of read.events.filter(
      (e) => e.kind === "dispute_action",
    )) {
      const command = disputeIntentSchema.parse(event.detail.command);
      if (
        read.events.some(
          (e) =>
            e.key === `resolved:${command.input.requestKey}` ||
            e.key === `unattempted:${command.input.requestKey}`,
        )
      )
        continue;
      const confirmation = await gateway.confirmDispute(
        read.row.intent,
        command,
      );
      await repository.record(
        worker(work),
        work.business_id,
        work.id,
        confirmation.observation,
        clock.now(),
      );
      if (confirmation.confirmed)
        await repository.disputeConfirmed(
          worker(work),
          work.business_id,
          work.id,
          command.input.requestKey,
          clock.now(),
        );
    }
  }
  async function current(
    credentials: Credentials,
    businessId: unknown,
    id: string,
  ) {
    const ctx = await context(credentials, businessId);
    return repository.read(ctx.actor, ctx.businessId, id);
  }
  return {
    queue: async (credentials: Credentials) =>
      repository.queue(await dependencies.authenticatePlatform(credentials)),
    notificationFeed: async (credentials: Credentials) =>
      repository.notificationFeed(
        await dependencies.authenticatePlatform(credentials),
      ),
    async details(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(adjustmentCommandSchema, input),
        saved = await current(credentials, businessId, data.caseId);
      return {
        ...saved.row.intent,
        creditReviews: saved.events
          .filter((e) => e.kind === "credit_review")
          .map((e) => creditBasisSchema.parse(e.detail.review)),
        commands: saved.events
          .filter((e) => e.kind === "dispute_action")
          .map((e) => {
            const command = disputeIntentSchema.parse(e.detail.command);
            return {
              ...command,
              documents: command.documents.map(
                ({ documentId, sha256, contentType }) => ({
                  documentId,
                  sha256,
                  contentType,
                }),
              ),
            };
          }),
      };
    },
    async evidence(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(
          z.strictObject({
            caseId: z.uuid(),
            requestKey: z.uuid(),
            documentId: z.string().regex(/^doc_[A-Za-z0-9]+$/),
          }),
          input,
        ),
        saved = await current(credentials, businessId, data.caseId);
      const event = saved.events.find(
          (e) => e.key === `action:${data.requestKey}`,
        ),
        doc = event
          ? disputeIntentSchema
              .parse(event.detail.command)
              .documents.find((d) => d.documentId === data.documentId)
          : null;
      if (!doc) throw new ApplicationError("NOT_FOUND");
      return {
        bytes: Buffer.from(doc.base64, "base64"),
        contentType: doc.contentType,
        name: `${doc.documentId}.${doc.contentType === "application/pdf" ? "pdf" : doc.contentType === "image/png" ? "png" : "jpg"}`,
      };
    },
    async withdraw(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(adjustmentCommandSchema, input),
        ctx = await context(credentials, businessId);
      return repository.withdraw(
        ctx.actor,
        ctx.businessId,
        data.caseId,
        clock.now(),
      );
    },
    async workspace(
      credentials: Credentials,
      businessId: unknown,
      operator = false,
    ) {
      const ctx = await context(credentials, businessId, operator);
      let ready = false;
      try {
        policy();
        ready = true;
      } catch {
        /* The saved history stays available. */
      }
      return {
        ...(await repository.workspace(ctx.actor, ctx.businessId, operator)),
        policy: operator ? gateway.policy : null,
        ready,
      };
    },
    async review(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const ctx = await context(credentials, businessId),
        data = parse(reviewAdjustmentSchema, input),
        p = policy();
      if (data.kind === "refund" && !p.normalRefunds)
        throw new ApplicationError("SETUP_REQUIRED");
      return repository.review(ctx.actor, ctx.businessId, data, p, clock.now());
    },
    async reviewCredit(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(reviewCreditSchema, input),
        ctx = await context(credentials, businessId);
      return repository.reviewCredit(
        ctx.actor,
        ctx.businessId,
        data,
        clock.now(),
      );
    },
    async execute(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(adjustmentCommandSchema, input),
        saved = await current(credentials, businessId, data.caseId),
        intent = saved.row.intent;
      if (saved.row.kind !== "refund")
        throw new ApplicationError("INVALID_INPUT");
      if (saved.view.state === "withdrawn")
        throw new ApplicationError("CONFLICT");
      if (saved.view.observation) return saved.view;
      if (saved.view.started) return saved.view;
      if (!policy(intent).normalRefunds)
        throw new ApplicationError("SETUP_REQUIRED");
      const payment = await gateway
        .validate(intent)
        .catch(async (error: unknown) => {
          await context(credentials, businessId);
          throw error;
        });
      if (
        BigInt(payment.refundedMinor) +
          BigInt(intent.allocation.totals.totalMinor) >
        BigInt(intent.invoice.snapshot.totals.totalMinor)
      )
        throw new ApplicationError("CONFLICT");
      const ctx = await context(credentials, businessId);
      policy(intent);
      if (
        !(await repository.start(
          ctx.actor,
          ctx.businessId,
          data.caseId,
          clock.now(),
          payment.refundedMinor,
        ))
      )
        return (await current(credentials, businessId, data.caseId)).view;
      const work = {
        id: saved.row.id,
        business_id: saved.row.businessId,
        recovery_key: saved.row.recoveryKey,
      };
      let observation = null;
      try {
        observation = await gateway.refund(intent, async () => {
          await context(credentials, businessId);
          policy(intent);
        });
      } catch (error: unknown) {
        if (error instanceof FinancialWriteNotAttempted)
          await repository.notAttempted(work, clock.now());
      }
      await repository.record(
        worker(work),
        work.business_id,
        work.id,
        observation,
        clock.now(),
      );
      return (await current(credentials, businessId, data.caseId)).view;
    },
    async refresh(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(adjustmentCommandSchema, input),
        saved = await current(credentials, businessId, data.caseId);
      if (saved.row.kind === "dispute" || saved.view.started)
        await reconcile({
          id: saved.row.id,
          business_id: saved.row.businessId,
          recovery_key: saved.row.recoveryKey,
        }).catch(async (error: unknown) => {
          await context(credentials, businessId);
          throw error;
        });
      return (await current(credentials, businessId, data.caseId)).view;
    },
    async dispute(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(disputeActionSchema, input),
        saved = await current(credentials, businessId, data.caseId),
        intent = saved.row.intent;
      if (saved.row.kind !== "dispute")
        throw new ApplicationError("INVALID_INPUT");
      const previous = saved.events.find(
        (e) => e.key === `action:${data.requestKey}`,
      );
      if (previous) {
        if (
          !isDeepStrictEqual(
            disputeIntentSchema.parse(previous.detail.command).input,
            data,
          )
        )
          throw new ApplicationError("CONFLICT");
        return saved.view;
      }
      const p = policy(intent);
      if (data.action === "accept" ? !p.acceptDisputes : !p.contestDisputes)
        throw new ApplicationError("SETUP_REQUIRED");
      const command = await gateway
          .prepareDispute(intent, data)
          .catch(async (error: unknown) => {
            await context(credentials, businessId);
            throw error;
          }),
        ctx = await context(credentials, businessId);
      policy(intent);
      if (
        !(await repository.startDispute(
          ctx.actor,
          ctx.businessId,
          data.caseId,
          command,
          clock.now(),
        ))
      )
        return (await current(credentials, businessId, data.caseId)).view;
      const work = {
        id: saved.row.id,
        business_id: saved.row.businessId,
        recovery_key: saved.row.recoveryKey,
      };
      try {
        const result = await gateway.dispute(intent, command, async () => {
          await context(credentials, businessId);
          policy(intent);
        });
        await repository.record(
          worker(work),
          work.business_id,
          work.id,
          result.observation,
          clock.now(),
        );
        if (result.confirmed)
          await repository.disputeConfirmed(
            worker(work),
            work.business_id,
            work.id,
            data.requestKey,
            clock.now(),
          );
      } catch (error: unknown) {
        if (error instanceof FinancialWriteNotAttempted)
          await repository.notAttempted(work, clock.now(), data.requestKey);
      }
      return (await current(credentials, businessId, data.caseId)).view;
    },
    financialFeed: async (credentials: Credentials) =>
      repository.financialFeed(
        await dependencies.authenticatePlatform(credentials),
      ),
    receipts: async (credentials: Credentials) =>
      repository.receipts(await dependencies.authenticatePlatform(credentials)),
    event: async (input: { body: Uint8Array; headers: Headers }) =>
      repository.capture(await gateway.authenticateEvent(input)),
    async credit(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const data = parse(adjustmentCommandSchema, input),
        saved = await current(credentials, businessId, data.caseId),
        intent = saved.row.intent,
        o = saved.view.observation;
      const basisEvent = saved.events
          .filter((e) => e.kind === "credit_review")
          .at(-1),
        basis = basisEvent
          ? creditBasisSchema.parse(basisEvent.detail.review)
          : null;
      if (
        saved.view.reviewRequired ||
        !o ||
        !(
          o.status === "processed" ||
          (o.status === "lost" &&
            intent.policy.disputeLostCredit &&
            (basis !== null ||
              o.deductedMinor === intent.allocation.totals.totalMinor))
        )
      )
        throw new ApplicationError("CONFLICT");
      if (!dependencies.documents)
        throw new ApplicationError("SELLER_DOCUMENT_SETUP_REQUIRED");
      const document = await dependencies.documents.adjust(
        credentials,
        saved.row.businessId,
        {
          invoiceId: saved.row.invoiceId,
          periodId: saved.row.periodId,
          paymentId: intent.period.paymentId,
          requestKey: intent.key,
          adjustmentId: saved.row.id,
          source: { kind: saved.row.kind, reference: o.nativeId },
          reason: `Provider-confirmed ${saved.row.kind} adjustment`,
          evidence: [`razorpay:${o.nativeId}`],
          lines: basis?.input.lines ?? intent.input.lines,
        },
      );
      if (
        !isDeepStrictEqual(
          document.snapshot.totals,
          basis?.allocation.totals ?? intent.allocation.totals,
        )
      )
        throw new ApplicationError("CONFLICT");
      const ctx = await context(credentials, businessId);
      return repository.creditRecorded(
        ctx.actor,
        ctx.businessId,
        saved.row.id,
        document.id,
        clock.now(),
      );
    },
    async recover() {
      const receipts = await repository.receiptWork(
        gateway.account,
        gateway.mode,
      );
      let failed = 0;
      for (const work of receipts) {
        try {
          await reconcile(
            work,
            work.event_name === "payment.dispute.action_required",
          );
          await repository.receiptDone(work, work.receipt_id, clock.now());
        } catch {
          failed++;
        }
      }
      const pending = await repository.pending(gateway.account, gateway.mode);
      for (const work of pending) {
        try {
          await reconcile(work);
        } catch {
          failed++;
        }
      }
      return { attempted: pending.length + receipts.length, failed };
    },
  };
}
