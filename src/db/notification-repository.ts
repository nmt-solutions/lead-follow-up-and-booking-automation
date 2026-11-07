import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  noticePurposeSchema,
  noticeStateSchema,
  notificationSetupSchema,
  notificationTermsSchema,
  noticeViewSchema,
  type NoticeDraft,
  type NoticeWork,
  type NoticeClaim,
  type NotificationSetup,
  type NotificationTerms,
  type NoticeState,
} from "../models/notifications";
import type { Database } from "./runtime";
import { scoped } from "./scope";
import type { NotificationReceipt } from "../notifications/webhook";

export type NotificationBinding = {
  account: string;
  mode: string;
  from: string;
  domainId: string;
  keyRef: string;
  receiverRef: string;
};
const workSchema = z.object({ id: z.uuid(), capability: z.uuid() });
const sourceSchema = z.object({
  expiresAt: z.coerce.date(),
  recipientDigest: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  email: z.email().optional(),
  businessName: z.string().optional(),
  role: z.string().optional(),
  invitationExpiresAt: z.coerce.date().optional(),
});
const claimSchema = workSchema.extend({
  lease: z.uuid(),
  account: z.string(),
  purpose: noticePurposeSchema,
  sourceId: z.string(),
  sealed: z.string(),
  now: z.coerce.date(),
  expiresAt: z.coerce.date(),
  key: z.string(),
  keyRef: z.string(),
});
const stateSchema = z.object({
  setup: notificationSetupSchema.nullable(),
  setupCheckedAt: z.string().nullable(),
  setupFresh: z.boolean(),
  terms: notificationTermsSchema.nullable(),
  notices: z.array(noticeViewSchema),
  pendingReservations: z.number(),
});
export function createNotificationRepository(database: Database) {
  async function operator<T>(
    actor: Actor,
    fn: (tx: Parameters<Parameters<typeof scoped>[3]>[0]) => Promise<T>,
  ) {
    return scoped(database, actor, "", async (tx) => {
      const r = await tx.execute(
        sql`select public.notification_operator() as allowed`,
      );
      if (r.rows[0]?.allowed !== true) throw new ApplicationError("FORBIDDEN");
      return fn(tx);
    });
  }
  return {
    retry(actor: Actor, account: string, id: string) {
      return operator(actor, async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_retry(${account},${id}::uuid) as value`,
        );
        if (!r.rows[0]?.value) throw new ApplicationError("NOT_FOUND");
        return workSchema.parse(r.rows[0].value);
      });
    },
    async time() {
      const r = await database.execute(
        sql`select statement_timestamp() as now`,
      );
      return z.coerce.date().parse(r.rows[0]?.now);
    },
    receive(binding: NotificationBinding, receipt: NotificationReceipt) {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_receive(${binding.account},${binding.receiverRef},${JSON.stringify(receipt)}::jsonb) as accepted`,
        );
        if (r.rows[0]?.accepted !== true)
          throw new ApplicationError("FORBIDDEN");
      });
    },
    selectTerms(actor: Actor, account: string, terms: NotificationTerms) {
      return operator(actor, async (tx) => {
        await tx.execute(
          sql`select public.notification_select_terms(${account},${JSON.stringify(terms)}::jsonb)`,
        );
      });
    },
    beginSetup(actor: Actor, binding: NotificationBinding) {
      return operator(actor, async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_begin_setup(${binding.account},${JSON.stringify(binding)}::jsonb) as value`,
        );
        if (!r.rows[0]?.value) throw new ApplicationError("CONFLICT");
        return workSchema.parse(r.rows[0].value);
      });
    },
    saveSetup(
      actor: Actor,
      binding: NotificationBinding,
      inspection: NoticeWork,
      setup: NotificationSetup,
    ) {
      return operator(actor, async (tx) => {
        await tx.execute(
          sql`select public.notification_save_setup(${binding.account},${JSON.stringify({ ...binding, inspectionId: inspection.id, inspectionCapability: inspection.capability })}::jsonb,${JSON.stringify(setup)}::jsonb)`,
        );
      });
    },
    source(
      draft: Pick<
        NoticeDraft,
        "purpose" | "sourceId" | "authority" | "actorId" | "businessId"
      >,
    ) {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_source(${draft.purpose},${draft.sourceId},${draft.authority},${draft.actorId},${draft.businessId}::uuid) as value`,
        );
        return r.rows[0]?.value ? sourceSchema.parse(r.rows[0].value) : null;
      });
    },
    enqueue(draft: NoticeDraft, binding: NotificationBinding) {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_enqueue(${JSON.stringify(draft)}::jsonb,${JSON.stringify(binding)}::jsonb,${draft.sealed}) as value`,
        );
        if (!r.rows[0]?.value) throw new ApplicationError("FORBIDDEN");
        return workSchema.parse(r.rows[0].value);
      });
    },
    claim(
      work: NoticeWork,
      binding: NotificationBinding,
    ): Promise<NoticeClaim | null> {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_claim(${work.id}::uuid,${work.capability}::uuid,${JSON.stringify(binding)}::jsonb) as value`,
        );
        return r.rows[0]?.value ? claimSchema.parse(r.rows[0].value) : null;
      });
    },
    gate(claim: NoticeClaim) {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_gate(${claim.id}::uuid,${claim.capability}::uuid,${claim.lease}::uuid) as allowed`,
        );
        return r.rows[0]?.allowed === true;
      });
    },
    finish(
      claim: NoticeClaim,
      state: NoticeState,
      providerId: string | null,
      wait: number,
    ) {
      return database.transaction(async (tx) => {
        await tx.execute(
          sql`select public.notification_finish(${claim.id}::uuid,${claim.capability}::uuid,${claim.lease}::uuid,${state},${providerId},${Math.ceil(Math.min(wait, 2147483000))}::integer)`,
        );
      });
    },
    outcome(work: NoticeWork) {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_outcome(${work.id}::uuid,${work.capability}::uuid) as value`,
        );
        return z
          .object({
            state: noticeStateSchema,
            providerId: z.string().nullable(),
          })
          .parse(r.rows[0]?.value);
      });
    },
    work(account: string): Promise<NoticeWork[]> {
      return database.transaction(async (tx) => {
        const r = await tx.execute(
          sql`select * from public.notification_work(${account})`,
        );
        return z.array(workSchema).parse(r.rows);
      });
    },
    prune() {
      return database.transaction(async (tx) => {
        await tx.execute(sql`select public.notification_prune()`);
      });
    },
    workspace(actor: Actor, account: string) {
      return operator(actor, async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_workspace(${account},NULL::uuid) as value`,
        );
        if (!r.rows[0]?.value) throw new ApplicationError("FORBIDDEN");
        return stateSchema.parse(r.rows[0].value);
      });
    },
    businessWorkspace(actor: Actor, account: string, businessId: string) {
      return scoped(database, actor, businessId, async (tx) => {
        const r = await tx.execute(
          sql`select public.notification_workspace(${account},${businessId}::uuid) as value`,
        );
        if (!r.rows[0]?.value) throw new ApplicationError("FORBIDDEN");
        const state = stateSchema.parse(r.rows[0].value);
        return {
          notices: state.notices,
          sendingReady: state.setup?.sendingReady === true && state.setupFresh,
        };
      });
    },
  };
}
