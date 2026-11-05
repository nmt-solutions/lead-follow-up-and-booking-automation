# Business profile application

Implements [issue #3](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3).

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
reapplies and verifies policy conditions, grants, forced RLS and the deferred membership constraint.
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
list only the owner's Businesses. Open one to edit its name, offering, Home market
and website. Optional fields may be empty. No industry or geography is preselected.

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
- The repository rechecks owner membership inside each protected transaction.
  `set_config(..., true)` binds actor and Business context to that same connection
  and transaction. `FORCE ROW LEVEL SECURITY` additionally checks both actor
  membership and Business ID. Missing context denies access. The runtime startup
  check refuses an owner, superuser, RLS-bypass role or disabled row security.
- Business creation inserts owner membership and profile in one transaction. The
  membership foreign key is deferred; its unique owner constraint prevents an
  insertion from joining an existing owned Business. Runtime grants permit neither
  membership updates/deletes nor profile ID changes. Policies live in `src/db/schema.ts`;
  `src/db/setup.ts` owns the grants, forced RLS and deferred constraint. Both are
  applied by `db-push` and by the test harness.
- Membership supports the Owner role in this slice. Team invitations, other roles,
  ownership transfers and privileged Platform Operator access are later work.
- Web and worker code share `createBusinessApplication` and the same repository.
  A future Trigger task must obtain its actor from verified, persisted job ownership,
  validate its payload, and invoke these commands with current membership. A job's
  arbitrary `userId` is never authentication. This flow queues no jobs and accepts
  no provider events. It adds no discovery runtime or alternative durable scheduler.
- JSON commands require the configured same origin, bounded JSON bodies and
  validated profile fields. Missing and inaccessible Businesses have the same
  public error. Diagnostics contain an allowlisted failure code and server-generated
  request ID; credentials, email links, private profiles and raw provider errors
  are never serialized to application logs or public failures.

## Tests and checks

The confirmed primary seam from issue #1 is the public application workflow:
commands, queries, authentication and their HTTP adapter. `tests/business.test.ts`
uses the real application, Better Auth, Drizzle schema push and native PostgreSQL,
with a restricted runtime login. No internal repository or domain module is mocked.
The external email adapter records sign-in deliveries, and the controlled clock
drives profile timestamps and authentication expiry. Worker composition is exercised
at the same application seam with a trusted actor derived from a real session.

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
