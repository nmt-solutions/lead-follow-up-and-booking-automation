import { z } from "zod";

const text = z
  .string()
  .trim()
  .min(1, "Enter the information to review.")
  .max(4000);
const label = z
  .string()
  .trim()
  .min(1, "Enter a name, question or field label.")
  .max(200);
export const knowledgeConfigurationSchema = z
  .strictObject({
    offerings: z.array(z.strictObject({ name: label, details: text })).max(50),
    answers: z
      .array(z.strictObject({ question: label, answer: text }))
      .max(100),
    missingInformation: z.array(label).max(100),
    goal: z.enum(["booking", "rfq"]),
    qualification: z
      .array(
        z.strictObject({
          key: z
            .string()
            .regex(
              /^[a-z][a-z0-9_]{0,59}$/,
              "Use a lowercase field key starting with a letter.",
            ),
          label,
          type: z.enum(["text", "number", "email"]),
          required: z.boolean(),
        }),
      )
      .max(50),
    escalation: z.strictObject({ name: label, email: z.email().max(254) }),
  })
  .superRefine((configuration, context) => {
    const groups = [
      configuration.offerings.map((entry) => entry.name),
      [
        ...configuration.answers.map((entry) => entry.question),
        ...configuration.missingInformation,
      ],
      configuration.qualification.map((entry) => entry.key),
    ];
    for (const values of groups) {
      const normalized = values.map((value) => value.toLowerCase());
      if (new Set(normalized).size !== normalized.length)
        context.addIssue({
          code: "custom",
          message: "Use distinct offering names, questions and field keys.",
        });
    }
  });
export const knowledgeDecisionSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646),
  note: z.string().trim().min(1, "Enter a reason for this change.").max(1000),
});
export const knowledgeDraftSchema = knowledgeDecisionSchema.extend({
  configuration: knowledgeConfigurationSchema,
});
export const knowledgeRevisionSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  version: z.number().int().positive(),
  action: z.enum(["draft", "approved", "retired"]),
  configuration: knowledgeConfigurationSchema,
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
});
export const knowledgeWorkspaceSchema = z.object({
  version: z.number().int().nonnegative(),
  current: knowledgeRevisionSchema.nullable(),
  history: z.array(knowledgeRevisionSchema),
  canManage: z.boolean(),
});
export type KnowledgeConfiguration = z.infer<
  typeof knowledgeConfigurationSchema
>;
export type KnowledgeRevision = z.infer<typeof knowledgeRevisionSchema>;
export type KnowledgeWorkspace = z.infer<typeof knowledgeWorkspaceSchema>;
export type KnowledgeDecision = z.infer<typeof knowledgeDecisionSchema>;
export type KnowledgeDraft = z.infer<typeof knowledgeDraftSchema>;
export const knowledgeEvaluationSchema = z.strictObject({
  question: z.string().trim().max(200),
  channel: z.enum(["email", "whatsapp"]),
  fields: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
      z.string().trim().max(4000),
    )
    .refine((fields) => Object.keys(fields).length <= 100),
});
export type KnowledgeEvaluationInput = z.infer<
  typeof knowledgeEvaluationSchema
>;

/** A lookup/qualification decision, never a send, commercial authorization or confirmed outcome. */
export function evaluateKnowledge(
  state: KnowledgeWorkspace,
  input: KnowledgeEvaluationInput,
) {
  const current = state.current;
  if (!current)
    return {
      status: "setup_required",
      answer: null,
      escalation: null,
      goal: null,
      version: null,
      offerings: [],
      missingFields: [],
      invalidFields: [],
      nextAction:
        "Ask an Owner or Admin to approve Business knowledge and an escalation contact.",
    };
  const configuration = current.configuration;
  const question = input.question.toLowerCase();
  const approved = configuration.answers.find(
    (entry) => entry.question.toLowerCase() === question,
  );
  const draft = state.history.at(-1);
  const unapproved =
    draft?.action === "draft" &&
    draft.configuration.answers.some(
      (entry) => entry.question.toLowerCase() === question,
    );
  const valueFor = (key: string) =>
    Object.hasOwn(input.fields, key) ? input.fields[key] : undefined;
  const missingFields = configuration.qualification
    .filter((field) => field.required && !valueFor(field.key))
    .map(({ key, label }) => ({ key, label }));
  const invalidFields = configuration.qualification
    .filter((field) => {
      const value = valueFor(field.key);
      if (!value) return false;
      if (field.type === "email") return !z.email().safeParse(value).success;
      if (field.type === "number")
        return (
          !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ||
          !Number.isFinite(Number(value))
        );
      return false;
    })
    .map(({ key }) => key);
  return {
    status: approved
      ? "approved"
      : unapproved
        ? "unapproved"
        : "missing_information",
    answer: approved?.answer ?? null,
    version: current.version,
    goal: configuration.goal,
    offerings: configuration.offerings,
    escalation: configuration.escalation,
    missingFields,
    invalidFields,
    nextAction: approved
      ? "Collect any missing or invalid qualification fields; apply current commercial and channel authority before acting."
      : "Ask the approved escalation contact for a reviewed answer; do not invent one.",
  };
}

export function knowledgeState(
  history: KnowledgeRevision[],
  canManage: boolean,
): KnowledgeWorkspace {
  const latestAuthority = history.findLast(
    (revision) => revision.action !== "draft",
  );
  return {
    history,
    version: history.at(-1)?.version ?? 0,
    current: latestAuthority?.action === "approved" ? latestAuthority : null,
    canManage,
  };
}
