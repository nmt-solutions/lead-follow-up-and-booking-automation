# Authentication options on Neon

Comparison checked against official sources on 2026-11-05. Decision: app-hosted Better Auth with Neon PostgreSQL, using current-scope RBAC and incremental plugins. Privileged owners/admins require MFA before production access; enterprise SSO/SCIM is deferred. Next.js, Vercel Pro, and Trigger.dev remain selected.

## WorkOS AuthKit

Ordinary business onboarding does not require a positive monthly product minimum within AuthKit's free band: email/password, Google/Microsoft social login, organizations, memberships, invitations, MFA, and RBAC are included through 1 million MAUs. Organizations are unlimited. Production still requires a payment method and billing setup, even if the configured AuthKit usage costs USD 0. [Pricing](https://workos.com/pricing), [production environments](https://workos.com/docs/authkit/environments), [billing setup](https://workos.com/docs/dashboard/billing), [organizations](https://workos.com/docs/authkit/users-organizations).

Enterprise SAML/OIDC SSO and Directory Sync are separate products, each starting at USD 125 per connection per month; a custom authentication domain is USD 99/month. Those fees must not be confused with ordinary team invitations or Google/Microsoft social sign-in. FGA pricing needs separate verification if required. [Pricing](https://workos.com/pricing).

WorkOS operates the auth infrastructure. We still integrate the UI/session flow, supply production OAuth credentials, map organization membership to Business access, and enforce application/database authorization. A WorkOS login domain is separate from the customer's email-sending domain.

## Neon Managed Better Auth

This is Neon's managed authentication service built on Better Auth, not the app-hosted library and not the legacy Stack Auth-based implementation. The service is generally available; its Organization plugin remains beta/partial. Auth identities, sessions, and configuration live in the project's database. [About](https://neon.com/docs/auth/about), [roadmap](https://neon.com/docs/auth/roadmap).

Auth includes 60,000 MAUs per Free project and 1 million per Launch/Scale project; database compute, storage, recovery, and transfer still follow the selected Neon plan. The included auth allowance is not unlimited database infrastructure. [Auth allowance](https://neon.com/docs/auth/about), [plans](https://neon.com/docs/introduction/plans).

Managed organizations support membership and invitations with fixed owner/admin/member roles. Custom organization roles/permissions, teams, and server-side organization hooks are not currently supported in that managed plugin. Application-owned resource permissions remain possible but must be built and tested by us. MFA is currently coming soon; a phone OTP login method is not proof of multi-factor authentication. Managed enterprise SAML/SCIM capability was not verified and must not be assumed from upstream Better Auth plugins. [Organization plugin](https://neon.com/docs/auth/guides/plugins/organization), [roadmap](https://neon.com/docs/auth/roadmap).

Next.js integration is supported. We own route/UI integration, trusted origins, cookie secrets, production OAuth applications, and production email-provider setup. Branching can copy auth records/configuration/credentials, so development and preview data handling needs deliberate isolation. [Next.js setup](https://neon.com/docs/auth/quick-start/nextjs-api-only), [production checklist](https://neon.com/docs/auth/production-checklist), [auth branching](https://neon.com/docs/auth/branching-authentication).

## App-hosted Better Auth with Neon

Run the maintained Better Auth library inside the Next.js application on managed hosting, using Neon PostgreSQL. This does not inherently require a separate auth VM or writing authentication protocols from scratch. The framework is MIT licensed, with no per-MAU framework license charge; hosting, database, email, and engineering remain costs. [License](https://raw.githubusercontent.com/better-auth/better-auth/main/LICENSE.md), [installation](https://better-auth.com/docs/installation).

The organization plugin supports organizations, memberships, invitations, teams, and custom roles/permissions. The maintained library also provides social login, 2FA, and passkey capabilities. SSO and SCIM packages are MIT licensed; SSO includes OIDC/OAuth2/SAML support. These are app-operated protocol/plugin capabilities, not a promise of turnkey managed directory integration. Optional paid managed infrastructure is a separate product. [Organizations](https://better-auth.com/docs/plugins/organization), [2FA](https://better-auth.com/docs/plugins/2fa), [SSO](https://better-auth.com/docs/plugins/sso), [SCIM](https://better-auth.com/docs/plugins/scim), [optional infrastructure pricing](https://better-auth.com/pricing).

We own auth endpoint deployment, schema/migrations, secrets, security updates, session configuration, provider credentials, verification/reset/invitation email delivery, and production rate-limit storage/proxy configuration. In-memory limiting is not a shared limit across serverless instances. SCIM requires a driver supporting native interactive transactions; verify the selected Neon driver before enabling it. [Rate limiting](https://better-auth.com/docs/concepts/rate-limit), [PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql), [SCIM requirements](https://better-auth.com/docs/plugins/scim).

## Decision criteria

- First decide whether enterprise SSO/SCIM and application MFA are launch requirements.
- For ordinary B2B login, organizations, invitations, and roles, WorkOS has a genuine no-charge AuthKit band; paying for enterprise products is not required merely to onboard a Business.
- App-hosted Better Auth offers broader plugin/configuration ownership and free protocol libraries, with application-owned operations.
- Managed Neon Auth reduces auth-service operations but its current organization/MFA limits need to fit the launch requirements.
- Keep mailbox OAuth consent and lifecycle separate from basic application login. WorkOS can facilitate additional OAuth scopes, but ordinary sign-in alone does not authorize reading/sending mail.
- All choices require Business-scoped application authorization and tested PostgreSQL access policies; authentication alone does not isolate tenant records.

The selected option is app-hosted Better Auth. Introduce optional plugins as requirements arise, implement privileged-user MFA before production use, and keep application/database Business authorization explicit.
