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
