import type { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  evaluateKnowledge,
  knowledgeEvaluationSchema,
  knowledgeDecisionSchema,
  knowledgeDraftSchema,
  type KnowledgeDecision,
  type KnowledgeDraft,
  type KnowledgeWorkspace,
} from "../models/knowledge";

export type KnowledgeRepository = {
  workspace(actor: Actor, businessId: string): Promise<KnowledgeWorkspace>;
  change(
    actor: Actor,
    businessId: string,
    action: "draft" | "approved" | "retired",
    input: KnowledgeDecision | KnowledgeDraft,
    at: Date,
  ): Promise<KnowledgeWorkspace>;
};
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  return parsed.data;
}

/** Classified failures: authentication, scope, INVALID_INPUT and stale-version CONFLICT. */
export function createKnowledgeApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  repository: KnowledgeRepository;
  clock: Clock;
}) {
  async function workspace(credentials: Credentials, id: unknown) {
    return dependencies.repository.workspace(
      await dependencies.authenticate(credentials),
      validate(businessIdSchema, id),
    );
  }
  async function change(
    credentials: Credentials,
    id: unknown,
    action: "draft" | "approved" | "retired",
    input: unknown,
  ) {
    const actor = await dependencies.authenticate(credentials);
    return dependencies.repository.change(
      actor,
      validate(businessIdSchema, id),
      action,
      action === "draft"
        ? validate(knowledgeDraftSchema, input)
        : validate(knowledgeDecisionSchema, input),
      dependencies.clock.now(),
    );
  }
  return {
    workspace,
    async evaluate(credentials: Credentials, id: unknown, input: unknown) {
      const parsed = validate(knowledgeEvaluationSchema, input);
      return evaluateKnowledge(await workspace(credentials, id), parsed);
    },
    async current(credentials: Credentials, id: unknown) {
      return (await workspace(credentials, id)).current;
    },
    saveDraft: (credentials: Credentials, id: unknown, input: unknown) =>
      change(credentials, id, "draft", input),
    approve: (credentials: Credentials, id: unknown, input: unknown) =>
      change(credentials, id, "approved", input),
    retire: (credentials: Credentials, id: unknown, input: unknown) =>
      change(credentials, id, "retired", input),
  };
}
