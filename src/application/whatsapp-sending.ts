import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import { metaPermissionSchema, metaTemplateSelectionSchema, metaPlanSchema } from "../models/whatsapp-sending";
import type { WhatsAppSendingRepository } from "../db/whatsapp-sending-repository";
import type { OpportunityRepository } from "./opportunity-control";

function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const p = schema.safeParse(value);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
export function createWhatsAppSendingApplication<Credentials>(d: { authenticate(credentials: Credentials): Promise<WorkIdentity>; repository: WhatsAppSendingRepository; opportunities: OpportunityRepository; clock: Clock }) {
  async function context(credentials: Credentials, businessId: unknown) { return { actor: await d.authenticate(credentials), businessId: parse(z.uuid(), businessId) }; }
  return {
    async template(credentials: Credentials, businessId: unknown, input: unknown) { const c=await context(credentials,businessId); await d.repository.template(c.actor,c.businessId,parse(metaTemplateSelectionSchema,input)); return d.repository.workspace(c.actor,c.businessId); },
    async savePlan(credentials: Credentials, businessId: unknown, input: unknown) { const c=await context(credentials,businessId); await d.repository.savePlan(c.actor,c.businessId,parse(metaPlanSchema,input)); return d.repository.workspace(c.actor,c.businessId); },
    async decide(credentials: Credentials, businessId: unknown, input: unknown) { const c=await context(credentials,businessId), v=parse(z.strictObject({planId:z.uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/),approved:z.boolean()}),input); await d.repository.decide(c.actor,c.businessId,v.planId,v.hash,v.approved); return d.repository.workspace(c.actor,c.businessId); },
    async start(credentials: Credentials, businessId: unknown, input: unknown) { const c=await context(credentials,businessId), v=parse(z.strictObject({planId:z.uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/)}),input); await d.repository.start(c.actor,c.businessId,v.planId,v.hash); return d.repository.workspace(c.actor,c.businessId); },
    async reconcile(credentials: Credentials, businessId: unknown, input: unknown) { const c = await context(credentials, businessId); await d.repository.reconcile(c.actor,c.businessId,parse(z.strictObject({actionId:z.uuid()}),input).actionId); return d.repository.workspace(c.actor,c.businessId); },
    async workspace(credentials: Credentials, businessId: unknown) { const c = await context(credentials, businessId); return d.repository.workspace(c.actor, c.businessId); },
    async permission(credentials: Credentials, businessId: unknown, input: unknown) { const c = await context(credentials, businessId); await d.repository.permission(c.actor, c.businessId, parse(metaPermissionSchema, input)); return d.repository.workspace(c.actor, c.businessId); },
  };
}
