# Privileged access policy

Better Auth provides only the required magic-link and two-factor plugins. TOTP enrollment requires confirmation; encrypted authenticator secrets and recovery codes remain server-side. Recovery codes are displayed during enrollment or explicit regeneration, consumed atomically by Better Auth, and never sent by email. Optional OTP delivery, trusted-device shortcuts and enterprise SSO are disabled or absent.

Magic links establish primary identity. They do not establish MFA. `createSessionAccess` checks authoritative persisted sessions, the current verified factor, enrollment, expiry and current Business/operator roles. Client-supplied assurance fields are ignored. A newly signed-in session must challenge again, even if another session is verified. Enrollment and authenticator replacement rotate the session through Better Auth; proofs bind to the current factor, so old proofs cannot survive its removal/replacement.

Every Owner/Admin session requires MFA before application access. Creating Business ownership also requires MFA. Salespeople can use their current sales scope without enrollment; if they enroll, their sessions must verify too. Promotion immediately activates the privileged requirement. All current profile, team, invitation, integration/billing/authority capability and platform access boundaries use this policy, with existing role checks and forced Business RLS retained. No live integration, billing mutation or durable job is introduced here.

Business assurance lasts at most 12 hours and never outlives its session. Security changes, secret retrieval and recovery-code regeneration require verification within 15 minutes. Initial enrollment requires primary sign-in within 15 minutes. Authenticator verification remains available to refresh assurance. Database-backed auth rate limits and per-account attempt limits apply to challenges.

## Platform operators

Session enumeration and revocation also require MFA within 15 minutes for privileged or enrolled actors. Primary identity/status and signing out the current session stay available. Assurance includes a fingerprint of the attempted encrypted factor secret, so concurrent replacement of a pending setup cannot make an old challenge verify a newer secret, even when Better Auth reuses the factor row ID.

An operator must have a current explicit `platform_operator` grant provisioned through the schema-owner connection, plus MFA within 15 minutes. Tax and reconciliation grants are independent and checked on each operation. Business Owner/Admin roles cannot confer these grants. Operator status never grants Business membership or bypasses RLS. Revocation takes effect on the next request; session revocation prevents further verification and access.

## Recovery and readiness

An unused recovery code can verify an authenticated session. Reused/invalid codes leave it unverified. Replacing a lost authenticator requires recent MFA, invalidates the old authenticator/codes and blocks protected access until replacement enrollment is confirmed. Other sessions bound to the removed factor lose assurance. Missing both authenticator and codes provides no email-only or automatic operator bypass; any manual recovery must be reviewed outside the product and must preserve current identity/Business/operator authorization. No unaudited recovery endpoint is enabled.

Security status calls out missing enrollment or session verification. Team status identifies every Owner/Admin missing enrollment. MFA readiness remains incomplete for those actors; a satisfied MFA prerequisite does not claim that other provider/policy/production prerequisites are complete. Responses and diagnostics contain allowlisted errors and request IDs, never codes, tokens, setup keys or provider payloads.
