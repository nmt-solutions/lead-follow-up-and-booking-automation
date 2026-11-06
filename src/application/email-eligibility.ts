import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  addEmailSuppressionSchema,
  emailActionRefSchema,
  emailContentReviewSchema,
  publishEmailPolicySchema,
  saveRecipientFactsSchema,
} from "../models/email-eligibility";
import type { createEmailEligibilityRepository } from "../db/email-eligibility-repository";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const p = schema.safeParse(value);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
/** Authenticated commands cannot accept allow flags or choose a dispatch purpose. */
export function createEmailEligibilityApplication<Credentials>(d: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createEmailEligibilityRepository>;
  clock: Clock;
}) {
  async function context(credentials: Credentials, id: unknown) {
    return {
      actor: await d.authenticate(credentials),
      businessId: parse(businessIdSchema, id),
    };
  }
  return {
    async workspace(credentials: Credentials, id: unknown) {
      const c = await context(credentials, id);
      return d.repository.workspace(c.actor, c.businessId);
    },
    async saveRecipient(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const value = parse(saveRecipientFactsSchema, input);
      if (
        value.facts.permissions.some(
          (e) => new Date(e.observedAt) > d.clock.now(),
        )
      )
        throw new ApplicationError("INVALID_INPUT");
      return d.repository.saveRecipient(c.actor, c.businessId, value);
    },
    async suppress(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.suppress(
        c.actor,
        c.businessId,
        parse(addEmailSuppressionSchema, input),
      );
    },
    async publishPolicy(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.publishPolicy(
        c.actor,
        c.businessId,
        parse(publishEmailPolicySchema, input),
      );
    },
    async reviewContent(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.reviewContent(
        c.actor,
        c.businessId,
        parse(emailContentReviewSchema, input),
      );
    },
    async evaluate(credentials: Credentials, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      return d.repository.evaluate(
        c.actor,
        c.businessId,
        parse(emailActionRefSchema, input),
      );
    },
  };
}
