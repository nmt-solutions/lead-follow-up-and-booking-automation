# Sending identities and reply readiness

The Business page links to **Sending identities**. Owners and Admins manage setup; current members can inspect their Business's status. Current session, role and MFA are checked again inside each protected transaction. Setup writes and email dispatch share the Business lock.

## Setup contract

Address origin (`customer_mailbox`, `customer_domain`, `service_provided`) is separate from purpose (`dedicated_outreach`, `ordinary_sales`). Each identity selects intended uses, an exact sending address/connection and a reply route. The reply route selects a reply-reading connection and an email inbox. Its identity is the explicit response sender for that inbox; conflicting selections fail instead of choosing a fallback. Business and platform identification accompany the sender/team name.

Settings alone never establish control, verification or readiness. An authenticated check invokes the injected mail adapter outside the tenant transaction. Its strict observation binds the Business, identity version, sending connection version, reply route version and reply connection version. Persistence rechecks current authorization, all settings and the previously observed evidence generation. Concurrent or changed setup rejects stale results. Evidence retains adapter provenance and the inspected configuration; expired or negative proof blocks sending. Invalid/failed refreshes replace earlier healthy proof with unavailable/unknown checks. Public diagnostics contain allowlisted status and request IDs, never provider errors or private mail.

The following remain separate checks: control of the From identity; customer-domain verification; SPF; DKIM; DMARC alignment; sending grant; delivery transport; reply-reading grant; selected inbox synchronization; reply capture; sender health. Calendar grants and authenticated imports establish none of these mail capabilities. All required checks must pass for the selected use. First contact additionally requires a customer-controlled dedicated outreach identity. Service-provided identities cannot pass first contact even if an adapter or client asks for it; trial, inbound and existing-conversation uses require explicit configuration and adapter approval. No price, allowance or trial terms are inferred.

The existing guarded email response dispatch reads this current state under its lock after current policy, actor, session, association and takeover checks. It also requires the transport's adapter key and live/fixture mode to match persisted proof. Its outbound envelope includes the explicit From, reply-to, Business/platform identification and evidence reference. This sender capability does not grant recipient/market eligibility, suppression clearance or outreach approval; those remain separate requirements.

## Current limits and test fixtures

Production composition uses the unconfigured mail adapter and has no enabled email response transport. Saving settings or selecting Gmail/Microsoft/domain/service modes cannot activate a provider, acquire mail rights or send a message. There is no Resend prospecting fallback. Gmail/Graph OAuth, actual synchronization, reply ingestion/recovery and live domain/transport verification belong to subsequent integration issues. No DNS or mail mutation is performed by this setup flow.

`tests/support/senders.ts` supplies deterministic adapter observations through the real application seam and restricted PostgreSQL persistence with the harness clock. Fixture readiness is labelled as fixture-only and does not claim live health. Application tests cover configuration/reload, independent checks, stale and changed settings, actor/Business/MFA isolation and observable dispatch effects. UI validation and acceptance remain human-owned.

## Primary guidance rechecked 2026-11-06

- [Google sender requirements](https://support.google.com/mail/answer/81126?hl=en): authentication, From alignment, accurate identification and receiver requirements are separate from mailbox authorization. The product spec requires SPF and DKIM with DMARC alignment; the baseline does not relax that policy based on volume.
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes): sending and reading are separate permissions, with production verification requirements for applicable scopes.
- [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference): mail permissions remain separate from calendar permissions. Provider selection does not establish consent or a working connection.
