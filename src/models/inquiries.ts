import { z } from "zod";
import { opportunityMailEvidenceSchema } from "./opportunity-mail";
import {
  informationalReplyTemplates,
  validQualificationValue,
  type KnowledgeConfiguration,
} from "./knowledge";

export const inquiryFactSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
  value: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .refine((value) => !value.includes("\0")),
  messageId: z.uuid(),
  quote: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .refine((value) => !value.includes("\0")),
});
/** Selection/extraction proposals only. There is deliberately no free-form reply or tool call. */
export const inquiryOutputSchema = z.strictObject({
  kind: z.literal("inquiry"),
  answerIndexes: z.array(z.number().int().nonnegative()).max(30),
  offeringIndexes: z.array(z.number().int().nonnegative()).max(30),
  facts: z.array(inquiryFactSchema).max(100),
  unsupported: z.boolean(),
});
export type InquiryOutput = z.infer<typeof inquiryOutputSchema>;
export type InquiryFact = z.infer<typeof inquiryFactSchema>;
export const processInquirySchema = z.strictObject({ messageId: z.uuid() });
export const inquirySnapshotSchema = z.strictObject({
  controlVersion: z.number().int().nonnegative(),
  knowledgeVersion: z.number().int().positive().nullable(),
  profileId: z.uuid().nullable(),
  activationVersion: z.number().int().nonnegative(),
  messages: z.array(
    z.strictObject({
      id: z.uuid(),
      associationVersion: z.number().int(),
      correctionVersion: z.number().int(),
      sequence: z.number().int(),
    }),
  ),
});
export type InquirySnapshot = z.infer<typeof inquirySnapshotSchema>;
export const inquiryResultSchema = z.strictObject({
  status: z.enum(["processing", "ready", "handoff", "stale"]),
  reason: z.string(),
  body: z.string().nullable(),
  goal: z.enum(["booking", "rfq"]).nullable(),
  qualification: z.enum(["incomplete", "qualified", "review_required"]),
  facts: z.array(inquiryFactSchema),
  missing: z.array(z.string()),
  citations: z.array(
    z.strictObject({
      kind: z.enum(["answer", "offering"]),
      index: z.number().int().nonnegative(),
      text: z.string(),
    }),
  ),
  proposal: inquiryOutputSchema.nullable(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  escalationEmail: z.string().nullable(),
  nextAction: z.string(),
});
export type InquiryResult = z.infer<typeof inquiryResultSchema>;
export const inquiryRunSchema = inquiryResultSchema.extend({
  reply: z.strictObject({
    nativeGmail: z.boolean(),
    recipient: z.string(),
    subject: z.string(),
    fromAddress: z.string().nullable(),
    replyTo: z.string().nullable(),
  }),
  id: z.uuid(),
  messageId: z.uuid(),
  actorId: z.string(),
  at: z.iso.datetime(),
  knowledgeVersion: z.number().int().positive().nullable(),
  profileId: z.uuid().nullable(),
  executionId: z.uuid().nullable(),
  action: z
    .strictObject({
      id: z.uuid(),
      state: z.enum(["pending", "committed", "dispatched", "cancelled"]),
      reason: z.string().nullable(),
      dueAt: z.iso.datetime(),
      email: opportunityMailEvidenceSchema.nullable().optional(),
    })
    .nullable(),
});
export type InquiryRun = z.infer<typeof inquiryRunSchema>;
export const inquiryWorkspaceSchema = z.strictObject({
  runs: z.array(inquiryRunSchema),
  canProcess: z.boolean(),
  latestMessageId: z.uuid().nullable(),
  nextAction: z.string(),
});
export type InquiryWorkspace = z.infer<typeof inquiryWorkspaceSchema>;

export const initialInquiryResult: InquiryResult = {
  status: "processing",
  reason: "processing",
  body: null,
  goal: null,
  qualification: "incomplete",
  facts: [],
  missing: [],
  citations: [],
  proposal: null,
  ownerId: null,
  ownerName: null,
  escalationEmail: null,
  nextAction:
    "Processing; interrupted work needs human review before a new evaluation.",
};

// Prices, commitments and commercial execution remain human work in this workflow.
// #22 owns structured amounts/limits. Neither a model classification nor an answer citation grants that authority.
const commercial =
  /(?:\b(?:price|pricing|cost|quote|quotation|discount|order|payment|pay|charge|free|complimentary|guarantee|confirm(?:ed)?|booked|reserved|refund|deposit|rate|fee|rupees?|dollars?|usd|inr|eur|gbp)\b|[$€£₹]|\d\s*%)/i;
export function inquiryDecision(input: {
  configuration: KnowledgeConfiguration;
  messages: { id: string; text: string }[];
  previousFacts: InquiryFact[];
  proposal: InquiryOutput;
}): InquiryResult {
  const { configuration: c, messages, previousFacts, proposal } = input;
  const base: InquiryResult = {
    ...initialInquiryResult,
    goal: c.goal,
    facts: [...previousFacts],
    citations: [],
    proposal,
  };
  const handoff = (reason: string): InquiryResult => ({
    ...base,
    status: "handoff",
    reason,
    qualification: "review_required",
    nextAction:
      "Review the inquiry and evidence, then reply manually or correct setup and explicitly hand back.",
  });
  for (const fact of previousFacts) {
    const field = c.qualification.find((v) => v.key === fact.key);
    if (
      !field ||
      !inquiryFactSchema.safeParse(fact).success ||
      !validQualificationValue(field.type, fact.value)
    )
      return handoff("qualification_rules_changed");
  }
  if (proposal.unsupported) return handoff("unsupported_request");
  const facts = [...previousFacts];
  const explicitFacts: InquiryFact[] = [];
  const structuredMessages = new Set<string>();
  for (const message of messages) {
    let structured = true;
    const candidates: InquiryFact[] = [];
    for (const raw of message.text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let recognized = c.answers.some(
        (answer) => answer.question.toLowerCase() === line.toLowerCase(),
      );
      for (const field of c.qualification) {
        const label = [field.key, field.label].find((v) =>
          line.startsWith(`${v}: `),
        );
        if (!label) continue;
        recognized = true;
        const value = line.slice(label.length + 2).trim();
        if (value) {
          const candidate = inquiryFactSchema.safeParse({
            key: field.key,
            value,
            messageId: message.id,
            quote: line,
          });
          if (!candidate.success) return handoff("unsafe_qualification");
          candidates.push(candidate.data);
        }
      }
      if (!recognized) structured = false;
    }
    if (structured) {
      structuredMessages.add(message.id);
      explicitFacts.push(...candidates);
    } else if (candidates.length) return handoff("ambiguous_qualification");
  }
  for (const candidate of [...proposal.facts, ...explicitFacts]) {
    const field = c.qualification.find((v) => v.key === candidate.key);
    const message = messages.find((v) => v.id === candidate.messageId);
    // An exact quote alone is not semantic proof. Only explicit, complete field assignments
    // are auto-applied. Natural-language/negated/ambiguous extraction remains reviewable.
    const explicit =
      field &&
      message?.text
        .split(/\r?\n/)
        .some(
          (line) =>
            line.trim() === candidate.quote &&
            [field.key, field.label].some(
              (label) => candidate.quote === `${label}: ${candidate.value}`,
            ),
        );
    if (
      !field ||
      !explicit ||
      !structuredMessages.has(candidate.messageId) ||
      !validQualificationValue(field.type, candidate.value)
    )
      return handoff("unsafe_qualification");
    const existing = facts.find((v) => v.key === candidate.key);
    if (existing && existing.value !== candidate.value)
      return handoff("conflicting_qualification");
    if (!existing) facts.push(candidate);
  }
  base.facts = facts;
  for (const [kind, indexes] of [
    ["answer", proposal.answerIndexes],
    ["offering", proposal.offeringIndexes],
  ] as const) {
    for (const index of new Set(indexes)) {
      const text =
        kind === "answer"
          ? c.answers[index]?.answer
          : c.offerings[index]?.details;
      if (!text) return handoff("unsafe_model_output");
      const use =
        kind === "answer"
          ? c.answers[index].inquiryReply
          : c.offerings[index].inquiryReply;
      base.citations.push({ kind, index, text });
      if (use !== "informational") return handoff("answer_review_required");
      // A keyword classifier cannot establish non-commercial meaning. Free-form
      // approved text is reviewable, never an evaluation:null dispatch bypass.
      if (!informationalReplyTemplates.some((template) => template === text))
        return handoff("answer_review_required");
    }
  }
  const latest = messages.at(-1)?.text ?? "";
  if (commercial.test(latest)) return handoff("commercial_review_required");
  if (
    c.missingInformation.some((question) =>
      latest.toLowerCase().includes(question.toLowerCase()),
    ) ||
    (!base.citations.length &&
      !proposal.facts.length &&
      !explicitFacts.some((fact) => fact.messageId === messages.at(-1)?.id))
  )
    return handoff("knowledge_unavailable");
  const missing = c.qualification.filter(
    (v) => v.required && !facts.some((fact) => fact.key === v.key),
  );
  const body = base.citations.map((v) => v.text);
  if (missing.length)
    body.push(
      `Please provide ${missing.map((v) => JSON.stringify(v.label)).join(", ")}.`,
    );
  else
    body.push(
      c.goal === "rfq"
        ? "Your requirements are ready for quotation-request review. A quotation has not been issued."
        : "Your requirements are ready for booking review. An appointment has not been confirmed.",
    );
  if (body.join("\n\n").length > 8000) return handoff("response_too_long");
  return {
    ...base,
    status: "ready",
    reason: "grounded_response",
    body: body.join("\n\n"),
    missing: missing.map((v) => v.key),
    qualification: missing.length ? "incomplete" : "qualified",
    nextAction: missing.length
      ? "Await the missing requirements."
      : c.goal === "rfq"
        ? "Review requirements for a quotation request."
        : "Review the booking request with the authoritative booking system.",
  };
}
