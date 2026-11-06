# Customer-owned WhatsApp onboarding

Issue #38 implements direct Meta Cloud API Tech Provider onboarding under ADR 0008. Business Owners/Admins with current MFA use **Business → WhatsApp identity**. No BSP, platform credit line, prepaid Meta credit, message sending, webhook processing or durable messaging task is activated by this feature.

## Ownership and billing

The Business records its Meta portfolio ID, international number, existing Cloud API / Business App / assisted-new-number path, and actual provisioning/control/transfer terms. Explicit acceptance records customer control and direct customer-paid Meta billing. These are declarations, separate from provider evidence. Assisted setup does not purchase a number, grant carrier control or promise a transfer. The customer must retain the SIM/OTP, carrier and Meta administrator access under its recorded arrangement.

The Business pays Meta with its own payment method. Our subscription and automation allowances exclude Meta usage; the same customer-paid charge is excluded from operator spend. The onboarding query exposes that billing classification explicitly. Quotes, usage accounting and messaging policy belong to their own tickets. Prices are linked to Meta instead of copied into defaults.

## Operator configuration

All settings in `.env.example` default to unavailable. Record actual platform business verification, Tech Provider access verification, App Review/Advanced Access and a published app before setting the four approval flags. Configure the selected app ID/secret, Facebook Login for Business Embedded Signup configuration ID, supported Graph version and AES-256-GCM key ID/JSON key map (64 hex characters per key). Register the application's actual HTTPS domain and SDK/login configuration at Meta. Configuration is server-only; the browser receives the public app/config IDs and Graph version only after an authorized start command.

Embedded Signup uses v4, session info version 3 and a one-use authorization code, exchanged immediately on the server with the empty redirect URI used by Meta's JS SDK example. The local state expires after ten minutes and binds the Business, connection version, actor and exact authenticated session. Incomplete `FINISH_ONLY_WABA`, missing assets, errors and cancellation persist an incomplete state. Browser asset IDs are hints: the server debugs the token, verifies the expected app and permissions, checks the customer's owned WABAs and verifies number membership and the expected phone number through Graph.

Required permissions are `business_management` (customer asset ownership check), `whatsapp_business_management` and `whatsapp_business_messaging`. Missing/revoked permissions, expired tokens, stale evidence, account review, Business verification and unregistered/unverified numbers remain separate blockers. A verified but unregistered Cloud API number can be registered by an explicit customer action with its six-digit PIN. No PIN is stored. Ambiguous registration clears proof and requires a read-only status refresh before any retry.

Customer tokens are encrypted with Business/connection/version authenticated data. Keep historical keys during rotation. Public responses/audit diagnostics never contain authorization codes, tokens, PINs or provider payloads. Owner/Admin checks and session/MFA validation run on each scoped transaction, including after external I/O. Reads are also restricted to Owners/Admins because this is account administration. RLS, restricted column grants, tenant-scoped foreign keys and an exclusive number binding back those boundaries. No tenant transaction remains open during Graph requests.

## Coexistence and readiness

Business App requests use `featureType: whatsapp_business_app_onboarding`. They remain unavailable unless the operator has actually approved that onboarding path. A normal `FINISH` cannot establish coexistence: the provider must return `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` and the selected number must report `is_on_biz_app: true`. Unknown, unsupported, mismatched or incomplete cases cannot appear ready. The UI does not promise all Business App features, history import or manual-app activity capture. The deterministic fixture tests this exact completion/inspection path; it is not live account validation.

`onboardingReady` requires every independent current check and configured operator prerequisite. Evidence expires within five minutes for the Graph adapter and never outlives a known token expiry. Failed refreshes invalidate older positive proof. The Graph adapter deliberately reports **customer payment method: not verified**: a valid token, message health or customer declaration cannot prove which payment method or credit arrangement Meta bills. Complete account-specific customer-payment verification at Meta before launch; this implementation does not invent a payment-ownership API or treat that external gate as passed. The deterministic provider can supply independent payment evidence to verify the full application contract.

`automationReady` is always false in #38. Account authorization does not establish recipient permission, approved templates, customer-service windows, webhook intake, history synchronization, human takeover or delivery readiness. Those capabilities must be configured and verified in their own implementation scope. This separation also prevents onboarding from silently enabling production messaging.

Disconnect removes local credentials, current evidence and pending callback eligibility. It leaves the customer account and number intact, without deregistration, transfer, WABA-wide unsubscribe or removing other providers. The Business can separately revoke the app through Meta Business settings. Saving changed terms or starting a fresh connection invalidates previous local proof; the append-only event log retains the accepted terms and safe operation history.

## Database and verification

Schema additions: `whatsapp_connection`, `whatsapp_oauth`, `whatsapp_event`; no backfill or destructive migration. Run the configured `pnpm db-push` on the reviewed integration schema during rollout. The test harness applies and reapplies the complete schema to disposable PostgreSQL, secures the runtime role and runs the public application commands against real restricted persistence.

Automated coverage uses deterministic Meta responses, a controlled clock and real authentication/MFA. No live Meta sign-in, number registration, billing change, coexistence/historical sync or message send is asserted. Browser/UI validation and human acceptance are pending.

## Primary provider references

- [Meta's current Tech Provider sample](https://github.com/fbsamples/business-messaging-sample-tech-provider-app): `app/components/ClientDashboard.tsx` (v4/extras), `Fbl4bLauncher.tsx` (session/code ordering), `app/api/beUtils.ts` (code exchange, registration and number inspection). Reviewed 2026-11-06; production code validates and sanitizes more strictly than the sample.
- [Meta Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation) and [Tech Provider onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider).
- [Meta Business App coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users).
- [Meta's official Postman collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup) and [WhatsApp pricing](https://business.whatsapp.com/products/platform-pricing).

The developer documentation URLs returned HTTP 429 during implementation. Endpoint/SDK behavior was checked against Meta's current first-party sample and official collection; account-specific production approval and supported coexistence must still be verified at activation.
