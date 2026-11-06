import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import {
  initialInquiryResult,
  inquiryDecision,
  inquiryOutputSchema,
  processInquirySchema,
} from "../models/inquiries";
import type { createInquiryRepository } from "../db/inquiry-repository";
import type { createAiApplication } from "./ai";
import type { OpportunityRepository } from "./opportunity-control";
import type { OpportunityActionProvider } from "../models/opportunity-control";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  return parsed.data;
}
/** Authenticated conventional application seam. External AI runs outside tenant transactions;
 * persisted context is rechecked before each attempt, completion and guarded channel dispatch.
 */
export function createInquiryApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createInquiryRepository>;
  ai: Pick<
    ReturnType<typeof createAiApplication<Credentials>>,
    "executeWorkflow"
  >;
  opportunityRepository: OpportunityRepository;
  provider: OpportunityActionProvider;
  clock: Clock;
}) {
  async function context(
    credentials: Credentials,
    businessId: unknown,
    id: unknown,
  ) {
    const actor = await dependencies.authenticate(credentials);
    const identity = await dependencies.authenticateForWork(credentials);
    if (identity.userId !== actor.userId)
      throw new ApplicationError("FORBIDDEN");
    return {
      actor: identity,
      businessId: parse(businessIdSchema, businessId),
      id: parse(z.uuid(), id),
    };
  }
  return {
    async reconcile(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      runId: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      const id = parse(z.uuid(), runId);
      const result = await dependencies.repository.action(
        c.actor,
        c.businessId,
        c.id,
        id,
      );
      if (!result.action) throw new ApplicationError("CONFLICT");
      await dependencies.opportunityRepository.reconcile(
        c.actor,
        c.businessId,
        result.action.id,
      );
      return dependencies.repository.action(c.actor, c.businessId, c.id, id);
    },
    async read(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      return dependencies.repository.read(c.actor, c.businessId, c.id);
    },
    async process(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      const { messageId } = parse(processInquirySchema, input);
      const prepared = await dependencies.repository.prepare(
        c.actor,
        c.businessId,
        c.id,
        messageId,
      );
      if (!prepared.fresh) return prepared.result;
      const { row, context: current, previousFacts } = prepared;
      let result = {
        ...initialInquiryResult,
        status: "handoff" as const,
        qualification: "review_required" as const,
        goal: current.knowledge?.configuration.goal ?? null,
        reason: "knowledge_setup_required",
        facts: previousFacts,
      };
      let executionId: string | null = null;
      if (current.knowledge && current.snapshot.profileId) {
        try {
          const execution = await dependencies.ai.executeWorkflow(
            c.actor,
            {
              businessId: c.businessId,
              requestKey: row.id,
              sample: {
                task: "drafting",
                purpose: "inquiry",
                label: "Associated incoming inquiry",
                text: JSON.stringify({
                  messages: current.messages.map((m) => ({
                    id: m.id,
                    text: m.text.text,
                  })),
                  previousFacts,
                }),
              },
            },
            {
              authorize: () =>
                dependencies.repository.authorize(
                  c.actor,
                  c.businessId,
                  c.id,
                  row.id,
                ),
            },
          );
          executionId = execution.id;
          const output = inquiryOutputSchema.safeParse(execution.output);
          if (execution.status === "succeeded" && output.success) {
            return dependencies.repository.complete(
              c.actor,
              c.businessId,
              c.id,
              row.id,
              inquiryDecision({
                configuration: current.knowledge.configuration,
                messages: current.messages.map((m) => ({
                  id: m.id,
                  text: m.text.text,
                })),
                previousFacts,
                proposal: output.data,
              }),
              executionId,
            );
          }
          result = {
            ...result,
            reason:
              execution.status === "setup_required"
                ? "ai_setup_required"
                : `ai_${execution.failure ?? "invalid_output"}`,
          };
        } catch (error: unknown) {
          if (
            !(error instanceof ApplicationError) ||
            ![
              "AI_SETUP_REQUIRED",
              "AI_ALLOWANCE_EXHAUSTED",
              "INVALID_INPUT",
              "CONFLICT",
            ].includes(error.code)
          )
            throw error;
          result = {
            ...result,
            reason:
              error.code === "CONFLICT"
                ? "inquiry_context_changed"
                : "ai_setup_required",
          };
        }
      } else if (current.knowledge)
        result = { ...result, reason: "ai_setup_required" };
      return dependencies.repository.complete(
        c.actor,
        c.businessId,
        c.id,
        row.id,
        result,
        executionId,
      );
    },
    async dispatch(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      runId: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      const id = parse(z.uuid(), runId);
      const result = await dependencies.repository.action(
        c.actor,
        c.businessId,
        c.id,
        id,
      );
      if (!result.action) throw new ApplicationError("CONFLICT");
      await dependencies.opportunityRepository.dispatch(
        c.actor,
        c.businessId,
        result.action.id,
        dependencies.clock.now,
        dependencies.provider,
      );
      return dependencies.repository.action(c.actor, c.businessId, c.id, id);
    },
  };
}
