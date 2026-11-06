import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import {
  handoffMailto,
  handoffEvidenceKinds,
  type EmailHandoff,
  type prepareHandoffSchema,
  type handoffRefSchema,
  type useHandoffSchema,
  type bindHandoffSchema,
} from "../models/email-handoffs";
import { campaignHash, createCampaignRepository } from "./campaign-repository";
import type { Database } from "./runtime";
import { requireCapability, scoped, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  campaignRevision,
  emailHandoff,
  emailHandoffEvidence,
  gmailManualMessage,
} from "./schema";
import {
  handoffObservations,
  appendHandoffObservation,
  reconcileHandoffReplies,
} from "./email-handoff-observations";

type Handoff = typeof emailHandoff.$inferSelect;
export function createEmailHandoffRepository(database: Database, clock: Clock) {
  const campaigns = createCampaignRepository(database, clock);
  function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    run: (tx: Transaction, role: string) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return run(tx, role);
      },
      { lock: true },
    );
  }
  async function load(tx: Transaction, businessId: string, id: string) {
    const [row] = await tx
      .select()
      .from(emailHandoff)
      .where(
        and(eq(emailHandoff.businessId, businessId), eq(emailHandoff.id, id)),
      );
    if (!row) throw new ApplicationError("NOT_FOUND");
    return row;
  }
  async function content(tx: Transaction, row: Handoff) {
    const [r] = await tx
      .select()
      .from(campaignRevision)
      .where(
        and(
          eq(campaignRevision.businessId, row.businessId),
          eq(campaignRevision.id, row.revisionId),
        ),
      );
    if (
      !r ||
      r.payloadHash !== row.payloadHash ||
      campaignHash(r.snapshot) !== r.payloadHash
    )
      throw new ApplicationError("CONFLICT");
    const recipient = r.snapshot.recipients.find(
      (c) => c.contactId === row.contactId,
    );
    if (!recipient) throw new ApplicationError("CONFLICT");
    const step = r.snapshot.steps[0];
    const mailto = handoffMailto(recipient.address, step.subject, step.body);
    if (!mailto) throw new ApplicationError("INVALID_INPUT");
    return { r, recipient, step, mailto };
  }
  async function evidence(tx: Transaction, row: Handoff) {
    const records = await tx
      .select()
      .from(emailHandoffEvidence)
      .where(
        and(
          eq(emailHandoffEvidence.businessId, row.businessId),
          eq(emailHandoffEvidence.handoffId, row.id),
        ),
      );
    return records
      .sort(
        (a, b) =>
          a.at.getTime() - b.at.getTime() ||
          handoffEvidenceKinds.indexOf(a.kind) -
            handoffEvidenceKinds.indexOf(b.kind),
      )
      .map((e) => ({
        id: e.id,
        kind: e.kind,
        actorId: e.actorId,
        at: e.at.toISOString(),
        source: e.source,
      }));
  }
  async function view(tx: Transaction, row: Handoff): Promise<EmailHandoff> {
    const c = await content(tx, row);
    return {
      id: row.id,
      revisionId: row.revisionId,
      payloadHash: row.payloadHash,
      contactId: row.contactId,
      recipient: c.recipient.address,
      subject: c.step.subject,
      body: c.step.body,
      fromAddress: c.r.snapshot.sender.fromAddress,
      at: row.at.toISOString(),
      mailto: c.mailto,
      evidence: await evidence(tx, row),
      ...(await handoffObservations(tx, row, clock.now())),
    };
  }
  return {
    workspace(actor: WorkIdentity, businessId: string) {
      return scope(actor, businessId, async (tx, role) => {
        const rows = await tx
          .select()
          .from(emailHandoff)
          .where(eq(emailHandoff.businessId, businessId))
          .orderBy(asc(emailHandoff.at), asc(emailHandoff.id));
        return {
          canBind: role === "owner" || role === "admin",
          handoffs: await Promise.all(rows.map((row) => view(tx, row))),
        };
      });
    },
    prepare(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof prepareHandoffSchema>,
    ) {
      return campaigns.withApprovedAction(
        actor,
        businessId,
        input,
        async (tx, review) => {
          const [seen] = await tx
            .select()
            .from(emailHandoff)
            .where(
              and(
                eq(emailHandoff.businessId, businessId),
                eq(emailHandoff.revisionId, input.revisionId),
                eq(emailHandoff.contactId, input.recipient.contactId),
              ),
            );
          if (seen) return view(tx, seen);
          if (
            !handoffMailto(
              review.recipient.address,
              review.step.subject,
              review.step.body,
            )
          )
            throw new ApplicationError("INVALID_INPUT");
          const row = {
            id: randomUUID(),
            businessId,
            revisionId: input.revisionId,
            payloadHash: input.payloadHash,
            contactId: input.recipient.contactId,
            actorId: actor.userId,
            at: clock.now(),
          };
          await tx.insert(emailHandoff).values(row);
          await tx
            .insert(emailHandoffEvidence)
            .values({
              id: randomUUID(),
              businessId,
              handoffId: row.id,
              kind: "prepared",
              sourceKey: "prepared",
              actorId: actor.userId,
              at: row.at,
            });
          return view(tx, row);
        },
      );
    },
    async use(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof useHandoffSchema>,
    ) {
      // This initial read reveals no draft; the locked consumption below rechecks every gate before returning it.
      const ref = await scope(actor, businessId, async (tx) => {
        const row = await load(tx, businessId, input.handoffId),
          c = await content(tx, row);
        return {
          revisionId: row.revisionId,
          payloadHash: row.payloadHash,
          recipient: {
            prospectId: c.recipient.prospectId,
            contactId: c.recipient.contactId,
            address: c.recipient.address,
          },
          stepIndex: 0,
        };
      });
      return campaigns.withApprovedAction(actor, businessId, ref, async (tx) =>
        view(tx, await load(tx, businessId, input.handoffId)),
      );
    },
    markSent(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof handoffRefSchema>,
    ) {
      return scope(actor, businessId, async (tx) => {
        const row = await load(tx, businessId, input.handoffId);
        await tx
          .insert(emailHandoffEvidence)
          .values({
            id: randomUUID(),
            businessId,
            handoffId: row.id,
            kind: "user_marked_sent",
            sourceKey: `user:${actor.userId}`,
            actorId: actor.userId,
            at: clock.now(),
          })
          .onConflictDoNothing();
        return view(tx, row);
      });
    },
    bindSent(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof bindHandoffSchema>,
    ) {
      return scope(actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "integrations.manage");
        const row = await load(tx, businessId, input.handoffId);
        const current = await handoffObservations(tx, row, clock.now());
        if (current.visibility === "unavailable")
          throw new ApplicationError("CONFLICT");
        const candidate = current.candidates.find(
          (c) => c.id === input.observationId,
        );
        if (!candidate) throw new ApplicationError("NOT_FOUND");
        const previous = (await evidence(tx, row)).find(
          (e) => e.kind === "sent_folder_observed",
        );
        if (
          previous &&
          (previous.source?.messageRef !== candidate.source.messageRef ||
            previous.source.mailboxId !== candidate.source.mailboxId)
        )
          throw new ApplicationError("CONFLICT");
        await appendHandoffObservation(
          tx,
          actor,
          row,
          "sent_folder_observed",
          candidate.source,
          clock.now(),
        );
        // Resolves only this manually reviewed outgoing record. Inbox association review remains independent.
        await tx
          .update(gmailManualMessage)
          .set({ state: "applied" })
          .where(
            and(
              eq(gmailManualMessage.businessId, businessId),
              eq(gmailManualMessage.id, candidate.id),
            ),
          );
        await reconcileHandoffReplies(tx, actor, businessId, clock.now());
        return view(tx, row);
      });
    },
  };
}
