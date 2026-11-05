# Approved Business knowledge

Issue #7 adds **Approved answers and qualification** from each Business profile. Owner/Admin access follows the existing session MFA policy. Salespeople can read this Business's configuration and history; only Owners/Admins can save, approve or retire it.

The offering profile and private files are source material, never automatic approval. Knowledge is a separately reviewed snapshot of offerings, answers, missing-information questions, qualification fields, conversion goal and a named email escalation contact. There are no industry branches. A qualification field has a stable key, a human question/label, a text/number/email type and a required flag.

Every draft save appends a complete revision with actor ID/name, timestamp and reason. Approval appends the exact latest saved draft as an approved revision. A draft does not replace the prior approved configuration. Every write includes `expectedVersion`; concurrent/stale changes fail with `CONFLICT`. Removing entries in a replacement draft and approving it retires those entries from current consumption. Retiring the whole configuration clears its authority while retaining history. Historical content can be loaded into the editor and saved/reviewed as a new draft.

`knowledge_revision` is append-only for the restricted runtime: SELECT/INSERT grants, Business RLS and forced RLS; no runtime UPDATE/DELETE. Version allocation and approval/retirement transitions share the existing Business transaction lock with membership changes. No knowledge jobs, provider events or outbound sends are introduced.

## Application and test adapter contract

`createKnowledgeApplication` composes the real repository, an identity adapter and clock. `workspace(credentials, businessId)` returns saved revisions and current authority. `current(credentials, businessId)` returns only the active approved revision, or null. `evaluate(credentials, businessId, input)` uses the same persisted snapshot and current scope for either email or WhatsApp:

```json
{
  "channel": "email",
  "question": "Do you deliver?",
  "fields": { "quantity": "500" }
}
```

The deterministic lookup matches the full saved question after trimming and case folding. It returns an approved answer or explicit `unapproved`, `missing_information` or `setup_required` status, together with the current approved version, offerings, goal, missing/invalid qualification fields and approved escalation contact. It never returns draft answers as authoritative. Unknown questions require escalation, including questions not yet recorded in the missing-information list. Without an active configuration, the next action is to ask an Owner/Admin to approve one and an escalation contact.

Pass the accumulated qualification values from the conversation on each evaluation; this module does not persist conversations. Required missing fields and invalid supplied number/email fields are separate. Native RFQ mode has no calendar dependency; booking mode records intent only. Returned knowledge is information, not permission to send, set prices, issue quotes, accept orders or confirm appointments. Those workflows must apply their own current authority/channel/provider checks. Semantic question retrieval, commercial authorization, conversation orchestration, calendar execution and RFQ creation remain in their respective issues.

## HTTP

All paths start with `/api/businesses/:businessId/knowledge` and use the authenticated session, current membership and no-store responses. Mutation/evaluation calls require the configured same origin and JSON content type. Inputs are strict and bounded; safe failures expose an allowlisted code/message and request ID. Diagnostics retain only code/request ID.

| Method/path      | Input                                      | Result                                                       |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------ |
| GET              | —                                          | Workspace/history/current approval and management permission |
| PUT              | `{ expectedVersion, note, configuration }` | Appended draft and workspace                                 |
| POST `/approve`  | `{ expectedVersion, note }`                | Exact latest saved draft approved                            |
| POST `/retire`   | `{ expectedVersion, note }`                | Current configuration retired                                |
| POST `/evaluate` | `{ channel, question, fields }`            | Decision using current approved knowledge                    |

Tests in `tests/knowledge.test.ts` exercise these application/HTTP boundaries using real restricted PostgreSQL persistence, real auth/MFA and membership operations, a controlled clock and deterministic external mail/storage adapters. Source/intended-flow review applies both required design skills using existing semantic Tailwind/shadcn components. Human UI validation and acceptance remain pending; no browser, visual, accessibility audit or preference emulation was performed.

## Inquiry handling (#20)

The inbox Opportunity's **Answer and qualify** section evaluates its latest associated incoming message after an accountable owner explicitly hands it back to automation. It uses the current approved knowledge and the shared approved AI drafting profile, including its existing funding, allowance, fallback and deadline rules. There is no separate inquiry model configuration or web retrieval. Evaluations, approved-source citations, qualification facts with message IDs/quotes, model proposals, handoffs and outbound action state persist in `inquiry_run` under forced Business RLS.

An offering/answer's optional `inquiryReply` is `human_review` or `informational`. Legacy revisions without this marker require human review. Enabling informational use takes effect only after approving the containing knowledge revision. Automatic replies must also match a constrained non-commercial phrase from `informationalReplyTemplates` in `src/models/knowledge.ts` verbatim; the editor lists these phrases. Other approved wording, including price/payment terms disguised as informational text, stays visible in an accountable handoff with no outbound action. A model citation or a human content classification cannot grant commercial authority. Commercial execution remains #22.

Automatic qualification accepts messages containing only configured `Label: value`/`key: value` lines and exact approved questions. It checks complete-message context, schema bounds and current field types. Other prose, quotations, examples, conflicting values and ambiguous extraction require a person; they never silently overwrite buyer facts. Valid prior facts survive subsequent messages and explicit cross-channel associations, while current requirement changes and association corrections are re-evaluated. Missing questions are generated only from current required fields. Qualified requirements are ready for booking/RFQ review; no booking, quotation request, quote or sale is created here.

Handoffs name the currently approved escalation contact's Business member when available, otherwise the current accountable owner or Business Owner. They pause the Opportunity through #19 and include a visible next action. No external notification is claimed. The channel dispatch path reuses #19's durable commitment and current-state guard, binding the text to the received message's recipient and conversation. Knowledge/profile generations, policy, current session/MFA, ownership, associations, new incoming messages and active connections are checked again before the provider call. Replays and ambiguous provider acceptance never resend automatically.

The UI prepares and displays responses; live channel transports remain unavailable and responses are explicitly unsent. A person can review the grounded information, reply through their selected channel and record the manual reply. Configured live AI uses the same #15 provider; deterministic application tests exercise the complete persisted generation-to-dispatch path independently. There is no automatic worker activation or background inquiry scheduling in this scope. Interrupted evaluations remain visible for human review; takeover followed by explicit handback permits a fresh evaluation while preserving old attempts and allowance usage.
