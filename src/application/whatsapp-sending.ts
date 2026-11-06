import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import {
  metaPermissionSchema,
  metaTemplateSelectionSchema,
  metaPlanSchema,
} from "../models/whatsapp-sending";
import type { WhatsAppSendingRepository } from "../db/whatsapp-sending-repository";
import type { OpportunityRepository } from "./opportunity-control";
import { moneySchema } from "../models/commercial-authority";

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const p = schema.safeParse(value);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
export function createWhatsAppSendingApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: WhatsAppSendingRepository;
  opportunities: OpportunityRepository;
  clock: Clock;
}) {
  async function context(credentials: Credentials, businessId: unknown) {
    return {
      actor: await d.authenticate(credentials),
      businessId: parse(z.uuid(), businessId),
    };
  }
  return {
    async recoverDue() {
      let processed = 0;
      for (const work of await d.repository.recoveryWork()) {
        try {
          await d.opportunities.reconcile(
            work.actor,
            work.businessId,
            work.actionId,
          );
          await d.opportunities.dispatch(
            work.actor,
            work.businessId,
            work.actionId,
            d.clock.now,
            {
              channels: ["whatsapp"],
              async dispatch() {
                throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
              },
            },
          );
          processed++;
        } catch (error: unknown) {
          if (
            !(error instanceof ApplicationError) ||
            ![
              "FORBIDDEN",
              "NOT_FOUND",
              "UNAUTHENTICATED",
              "MFA_REQUIRED",
            ].includes(error.code)
          )
            throw new ApplicationError("PROVIDER_UNAVAILABLE");
        }
      }
      return { processed };
    },
    async revokePermission(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(
          z.strictObject({
            permissionId: z.uuid(),
            reason: z.string().trim().min(1).max(500),
          }),
          input,
        );
      await d.repository.revokePermission(
        c.actor,
        c.businessId,
        v.permissionId,
        v.reason,
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
    async cancelPlan(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(
          z.strictObject({
            planId: z.uuid(),
            reason: z.string().trim().min(1).max(500),
          }),
          input,
        );
      await d.repository.cancelPlan(c.actor, c.businessId, v.planId, v.reason);
      return d.repository.workspace(c.actor, c.businessId);
    },
    async bindReplyTemplate(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(
          z.strictObject({ actionId: z.uuid(), templateId: z.uuid() }),
          input,
        );
      await d.repository.bindReplyTemplate(
        c.actor,
        c.businessId,
        v.actionId,
        v.templateId,
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
    async estimate(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(
          moneySchema.extend({
            actionId: z.uuid(),
            reference: z.string().regex(/^[A-Z][A-Z0-9-]{5,100}$/),
            observedAt: z.iso.datetime(),
            validUntil: z.iso.datetime(),
          }),
          input,
        );
      await d.repository.estimate(c.actor, c.businessId, v);
      return d.repository.workspace(c.actor, c.businessId);
    },
    async template(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId);
      await d.repository.template(
        c.actor,
        c.businessId,
        parse(metaTemplateSelectionSchema, input),
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
    async savePlan(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId);
      await d.repository.savePlan(
        c.actor,
        c.businessId,
        parse(metaPlanSchema, input),
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
    async decide(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId),
        v = parse(
          z.strictObject({
            planId: z.uuid(),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            approved: z.boolean(),
          }),
          input,
        );
      await d.repository.decide(
        c.actor,
        c.businessId,
        v.planId,
        v.hash,
        v.approved,
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
    async start(credentials: Credentials, businessId: unknown, input: unknown) {
      const c = await context(credentials, businessId),
        v = parse(
          z.strictObject({
            planId: z.uuid(),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
          }),
          input,
        );
      await d.repository.start(c.actor, c.businessId, v.planId, v.hash);
      return d.repository.workspace(c.actor, c.businessId);
    },
    async reconcile(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId);
      await d.repository.reconcile(
        c.actor,
        c.businessId,
        parse(z.strictObject({ actionId: z.uuid() }), input).actionId,
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
    async workspace(credentials: Credentials, businessId: unknown) {
      const c = await context(credentials, businessId);
      return d.repository.workspace(c.actor, c.businessId);
    },
    async permission(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId);
      await d.repository.permission(
        c.actor,
        c.businessId,
        parse(metaPermissionSchema, input),
      );
      return d.repository.workspace(c.actor, c.businessId);
    },
  };
}
