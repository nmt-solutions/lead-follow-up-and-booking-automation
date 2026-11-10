# Enable customer email and calendar connections

Customers choose Google or Microsoft, approve access on the provider page, and return to Lead Relay. They do not create sending identities, enter technical IDs, or configure mailbox records.

The operator must register the shared callbacks once. Provider registration and production credentials cannot be supplied by a customer's consent screen.

| Integration        | Authorized redirect URI                                                         | Enable after registration                        |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| Gmail              | `https://leadrelay.nmtsolutions.in/api/connections/gmail/callback`              | `GMAIL_FIXED_CALLBACK_ENABLED=true`              |
| Google Calendar    | `https://leadrelay.nmtsolutions.in/api/connections/google-calendar/callback`    | `GOOGLE_CALENDAR_FIXED_CALLBACK_ENABLED=true`    |
| Outlook email      | `https://leadrelay.nmtsolutions.in/api/connections/microsoft/callback`          | `MICROSOFT_MAIL_FIXED_CALLBACK_ENABLED=true`     |
| Microsoft Calendar | `https://leadrelay.nmtsolutions.in/api/connections/microsoft-calendar/callback` | `MICROSOFT_CALENDAR_FIXED_CALLBACK_ENABLED=true` |

Use the corresponding OAuth client for each integration. If the deployment uses another `BETTER_AUTH_URL`, use that exact origin instead. Keep registered legacy callbacks while existing integrations still use them.

1. In [Google Auth Platform clients](https://console.cloud.google.com/auth/clients), open the confidential web client used by the integration. Add the appropriate Google URI above to **Authorized redirect URIs** and save. Keep the API, consent, verification, and production prerequisites described in [Gmail](gmail.md) and [Google Calendar](google-calendar.md).
2. In [Microsoft Entra app registrations](https://entra.microsoft.com/), open the corresponding app and add the appropriate Microsoft URI under **Authentication > Web > Redirect URIs**. Keep the delegated permissions, supported account audience, and launch prerequisites described in [Microsoft mail](microsoft-mail.md) and [Microsoft Calendar](microsoft-calendar.md).
3. Supply the approved client credentials and encryption configuration in the deployment's secret settings. Set the matching fixed-callback flag only after the URI is saved. Redeploy the application. Do not place secrets in browser code or commit them.
4. Before deployment, run `pnpm exec tsx scripts/database-security.ts secure` using the database owner's configured connection. This installs the guarded first-account binding and preserves forced row-level security. The normal `pnpm db-mig` workflow also installs it. No table migration is needed for this change.
5. Validate with a permitted test account: connect, approve access, confirm the verified email, check the connection, and disconnect. Repeat for a calendar and select a supported work calendar. Decline one consent attempt and confirm retry is available. Connecting must not import old email or send outreach.

Until fixed callbacks are enabled, established integrations retain their existing callback behavior. New self-service email buttons remain unavailable until both the provider configuration and its fixed callback are enabled. Customers can continue using the rest of the app.

Initial synchronization has separate worker and usage requirements. Saved email consent remains valid if initial sync cannot be queued; the UI keeps follow-ups paused until actual reply visibility is current. Approved message and sending-health checks remain in force.

Reference: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Microsoft redirect URI registration](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).
