# Account setup and sign-in

Sign-up collects first name, last name, account type, and a company name for company accounts. These are profile fields and never create Business membership or platform grants. Existing accounts keep their current access.

Email/password sign-up uses Better Auth's native password hashing, with a 12–128 character password. The client requests a native email-verification link after account creation. Password sign-in requires a verified email. Verification starts a primary session, then `/security` enrolls an authenticator using a locally rendered QR code or a manual key. Recovery codes appear after successful verification.

Native verification is deliberate: Better Auth revokes unproven credentials when an unverified account is promoted through a magic link. Using native email verification preserves the signup password. Optional magic links remain available for existing accounts and password recovery.

Verification email uses the existing private transactional outbox. Its source is an expiring `email-verification:` hash in `verification`, bound to the unverified user and recipient. The notification authority becomes invalid when that email is verified. The signed verification URL stays inside the sealed notification payload; it must never enter logs or operator diagnostics. `pnpm db-mig` installs the updated authority function and the additive nullable profile columns.

Password sign-in for an enrolled account creates only a signed, ten-minute two-factor challenge. The native handler consumes it before creating a session. The application stamps MFA assurance only after the successful challenge and only if the verified factor still matches the factor captured before verification. Authenticator and single-use recovery codes use the same compact verification screen.

Password recovery sends a magic link to the account email. The user must then verify their authenticator or recovery code before `/api/security/password` can save a password. This endpoint requires verified email and persisted MFA proof younger than 15 minutes. It rechecks the proof after hashing, saves the credential, and revokes other sessions in one transaction. Native password mutation routes are blocked so they cannot bypass this workflow. No email-only password reset is configured.

## Manual acceptance

UI validation is pending and belongs to the user:

1. Create Company and Personal accounts. Company name should appear only for Company and prefill the business name. Verify email, confirm the password, scan the QR code or use the manual key, verify a code, and save recovery codes.
2. Sign out and sign in with email/password. Only the authenticator input and recovery-code alternative should be shown. Try a wrong code, then a valid code. A consumed recovery code must fail on reuse.
3. Use Forgot password. The email link alone must not save a new password. Complete MFA, save a new password, and confirm the old password and other sessions no longer work.
4. Continue through full-screen business, email, calendar, and first-search setup. Skip each optional step and use Set up later. Reopen Finish setup from the business overview. Provider consent cancellation must return to the same step, and calendar selection must survive the callback.
5. Review the first search's saved product, customers, and area. Running it requires explicit query/usage approval. Unconfigured services must allow continuing later. Check keyboard entry, mobile sidebar controls, and reduced-motion behavior.
