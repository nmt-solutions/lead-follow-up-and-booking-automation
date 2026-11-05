# Business profile and team application

Implements [issue #3](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3)
and team access from [issue #4](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4).

## Local setup

Use Node 26.12.0 (see `.node-version`) and pnpm 12.14.0. Direct dependencies and the
lockfile are pinned. `pnpm install --frozen-lockfile` installs the application and test
tools. Embedded PostgreSQL is a development dependency, not a production database.
On another supported platform, approve its `@embedded-postgres/<platform>` install
script with `pnpm approve-builds <package> --yes` if pnpm requests it. Only esbuild
and the Windows PostgreSQL package need install scripts on the current platform.

Copy `.env.example` to `.env` (or `.env.local`) and supply the following privately:

| Variable             | Purpose                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | Neon pooled connection using `app_runtime`                                                  |
| `DATABASE_ADMIN_URL` | Database owner connection, used only by `db-push`; Neon pooled URLs are converted to direct |
| `BETTER_AUTH_URL`    | Exact application origin; localhost for development, HTTPS in production                    |
| `BETTER_AUTH_SECRET` | Independently generated random secret, at least 32 characters                               |
| `RESEND_API_KEY`     | Transactional email API key                                                                 |
| `AUTH_EMAIL_FROM`    | Verified sender email address                                                               |

Run `pnpm db-push`. This prepares the restricted role, runs `drizzle-kit push`, then
reapplies and verifies policy conditions, grants, forced RLS, the membership role
check and the deferred membership constraint.
Always use this command for schema changes; do not generate or apply migrations.
Push compares the live database with `src/db/schema.ts`, including its RLS policies.
It does not use `--force`; review any destructive-change prompt before proceeding.
The pinned Drizzle push omits policy `USING` / `WITH CHECK` expressions, so the
security step reapplies them directly from the schema. Protected Business access
is paused during the push and restored only after that transaction succeeds. If a
push fails or is cancelled, fix the cause and rerun `pnpm db-push` to restore access.

The schema owner must be able to create a PostgreSQL role. Setup creates `app_runtime` with
`NOLOGIN`, no schema ownership, no superuser privileges and no RLS bypass. Enable
login and set its password privately through the database administration interface,
then use that role's pooled URL as `DATABASE_URL`. Do not grant it membership in
the schema owner role, `neon_superuser`, or any bypass role. In a shared PostgreSQL
cluster, provision a dedicated application database and review the pre-existing
`app_runtime` role before pushing. Keep `DATABASE_ADMIN_URL` out of the deployed
application environment; only the schema-management environment needs it.

Both URLs use `sslmode=verify-full` on Neon. The shared connection normalizer also
converts `prefer`, `require` and `verify-ca` to explicit full certificate and hostname
verification, avoiding pg's SSL-alias warning and preserving verification after a
future pg upgrade. It never disables certificate validation. The command loads
process variables first, then `.env.local`, then `.env`.

Run `pnpm dev`, open `/sign-in`, and request an email link. A successful sign-in
opens `/businesses`; the first visit presents the creation form. Subsequent visits
list only the member's Businesses. Open one to edit its name, offering, Home market
and website. Salespeople receive a read-only profile. Optional fields may be empty.
No industry or geography is preselected.

Owners and Admins can open **Manage team access** from a Business profile. Invite
a teammate by email, choose a role and an expiry of 1–30 days (default seven),
review delivery status, revoke pending invitations and remove access. Only an
Owner can grant or change Admin access; Admins manage Salespeople. The Owner
cannot be demoted or removed through team management. Ownership transfer is not
part of this flow.

The invitation email links to `/invitations` with its token in the URL fragment.
The recipient signs in with the invited email, reviews the Business and role and
explicitly accepts. The sign-in email preserves the invitation in its callback;
switching email signs out on the same page without discarding the invitation.
Accepted links cannot be reused. Expired or revoked invitations grant no access.

Missing email/database/auth configuration visibly disables sign-in. There is no
console-token fallback and no fake successful email delivery. Configure a real
verified Resend sender to exercise live email; tests use an in-process mail adapter
and never contact Resend. No cloud resources are provisioned by these scripts.

## Persistence and authorization

- Better Auth stores users, sessions, single-use hashed sign-in tokens and shared
  rate limits through its Drizzle adapter with `transaction: true`. Links expire
  after ten minutes. Session-cookie caching is disabled so sign-out is immediate.
- Every application command authenticates through an injected identity adapter.
  HTTP passes request headers to Better Auth; it never accepts a caller-supplied
  actor. A URL's Business ID is a lookup request, not proof of access.
- The repository rechecks current membership and the required capability inside
  each protected transaction, including profile writes and team/audit reads.
  `set_config(..., true)` binds actor and Business context to that same connection
  and transaction. `FORCE ROW LEVEL SECURITY` additionally checks both actor
  membership and Business ID. Missing context denies access. The runtime startup
  check refuses an owner, superuser, RLS-bypass role or disabled row security.
- Business creation inserts owner membership and profile in one transaction. The
  membership foreign key is deferred; its unique owner constraint prevents an
  insertion from joining an existing owned Business. Runtime grants permit only
  role updates and authorized non-Owner removal, never membership identity or
  profile ID changes. Policies live in `src/db/schema.ts`;
  `src/db/setup.ts` owns the grants, forced RLS and deferred constraint. Both are
  applied by `db-push` and by the test harness.
- Owner and Admin capabilities include Business billing reads/management,
  integrations and Commercial authority; Salespeople receive profile reads and
  sales work. The capability service is an authorization boundary, not an
  implementation of the later billing, integration or sales modules. Those
  modules must check their capability inside the transaction that accesses data,
  using `requireCapability`, rather than treating an earlier access response as a
  reusable grant.
- Membership policies use two narrow security-definer helpers with an empty
  search path. A schema-owner-only SELECT policy lets those helpers read forced
  RLS membership even when that owner has no superuser/BYPASSRLS privileges.
  The runtime cannot assume the owner role; the helpers expose only the current
  actor's Business role and a boolean invitation-authority check. Public execution
  of the helpers is revoked. The security step also updates the existing
  owner-only membership CHECK because the pinned Drizzle push does not update its
  expression. Schema definitions remain the source of truth for these policies
  and checks.
- Team writes, invitation acceptance and notification claims use a PostgreSQL
  transaction advisory lock per Business. An accepted invitation inserts one
  membership and consumes the invitation atomically. Acceptance requires the
  token hash, a matching verified email, unexpired pending status and a currently
  authorized inviter. Removing/demoting an inviter revokes their outstanding
  invitations, including across later re-promotion.
- `team_audit` is append-only for the runtime and readable only by that Business's
  current Owner/Admin. Invitations, acceptance, expiration, revocation, notification
  outcomes and membership changes retain actor, subject, time and role-change
  details. Removed teammates lose audit access while their audit records remain.
- Platform grants live separately in `platform_operator`. The runtime has no
  write privileges for these grants, and Business invitations/roles cannot confer
  them. Authorization separately requires an MFA-verified identity adapter and
  the current persisted tax/reconciliation capability. A platform grant never
  grants ordinary Business access. Live platform access returns `SETUP_REQUIRED`
  until a real privileged MFA adapter is configured, per ADR 0002; the tests use
  explicit trusted MFA fixtures. No global financial operations are activated here.
- Web and worker code share `createBusinessApplication` and the same repository.
  A future Trigger task must obtain its actor from verified, persisted job ownership,
  validate its payload, and invoke these commands with current membership. A job's
  arbitrary `userId` is never authentication. `createTeamApplication` also supports
  trusted worker composition; delivery attempts recheck current membership and
  invitation state instead of trusting a stale job's original authorization.
  This flow sends invitations synchronously and queues no jobs or provider events.
  Future durable scheduling still belongs to Trigger.dev.
- JSON commands require the configured same origin, bounded JSON bodies and
  validated profile fields. Missing and inaccessible Businesses have the same
  public error. Diagnostics contain an allowlisted failure code and server-generated
  request ID; credentials, email links, private profiles and raw provider errors
  are never serialized to application logs or public failures.

## Invitation notification delivery

Invitation state commits before contacting Resend. Tokens are HMAC-derived from
the server secret and invitation ID; only SHA-256 token hashes are persisted.
Recipient, role, Business name and expiry are fixed at invitation creation so
retries preserve the same provider payload. Renaming a Business does not change
an already issued invitation's email content.

The Resend adapter uses a stable `Idempotency-Key` per invitation and a ten-second
deadline, checks HTTP status and validates the provider response. Delivery failures
remain `unconfirmed`; saving an invitation does not claim the email was sent.
Explicit retries recheck membership, inviter authority, pending status and expiry.
Concurrent attempts are leased in PostgreSQL; interrupted attempts may be reclaimed
after a minute. Retries stop after 24 hours from invitation creation, within
[Resend's documented idempotency window](https://resend.com/changelog/idempotency-keys).
After that, revoke the invitation and create a new one. Provider errors, tokens
and credentials never enter the public response or diagnostics.

Revocation cannot retract an email already accepted by a provider. It prevents
accepting the link and prevents subsequent dispatch claims. There is no assumed
distributed transaction between PostgreSQL and Resend.

## Tests and checks

The confirmed primary seam from issue #1 is the public application workflow:
commands, queries, authentication and their HTTP adapter. `tests/business.test.ts`
uses the real application, Better Auth, Drizzle schema push and native PostgreSQL,
with a restricted runtime login. No internal repository or domain module is mocked.
The external email adapter records sign-in deliveries, and the controlled clock
drives profile timestamps and authentication expiry. Worker composition is exercised
at the same application seam with a trusted actor derived from a real session.

`tests/team.test.ts` exercises team lifecycle, verified-recipient previews,
role permissions, protected Owner/Admin boundaries, cross-Business isolation,
revocation with stale web/worker identities, immutable audit access, expired links,
concurrent invitation/acceptance, deterministic provider idempotency with ambiguous
acceptance, platform/MFA fixtures, and upgrade from the owner-only role check.
It also exercises a schema owner without superuser/BYPASSRLS privileges. Tests
assert application-visible state and captured external deliveries; raw owner SQL
is used only for infrastructure and operator-grant fixtures.

`pnpm test` starts an isolated PostgreSQL 17 cluster on a loopback port, applies the
same schema and security setup, and stops/removes that temporary cluster afterwards. It needs no
Docker, Neon credentials or external services. Run a focused file with
`pnpm test tests/business.test.ts`. `pnpm typecheck` generates Next route types before
checking TypeScript, so it also works before the first build.

Use `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` for
verification. Format only changed files when working on a small patch to avoid
rewriting unrelated planning documents.

## Activation boundaries

This implements the first private profile flow, not the whole parent product.
Live Neon and Resend credentials are deployment inputs. Production hosting must
preserve Better Auth's trusted origin, secure cookies, shared database rate limiting
and trusted proxy/IP headers. Privileged production access still requires the MFA
work selected in ADR 0002 before that access is introduced. Discovery, outreach,
commercial actions, paid plans and scheduled work are not enabled by saving a profile.

Integration references: [Better Auth magic links](https://better-auth.com/docs/plugins/magic-link),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[Resend email API](https://resend.com/docs/api-reference/emails/send-email).
