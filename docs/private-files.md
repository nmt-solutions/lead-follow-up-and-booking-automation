# Private Business files

Issue #8 adds Business-owned private files. Owner/Admin sessions need the existing MFA policy and `files.manage` to reserve, upload or delete. Current members have `files.read`; they can see ownership/status and download completed files. Platform operator status alone grants no Business access.

## Readiness and configuration

File operations remain unavailable until all settings in `.env.example` are supplied. Existing metadata remains readable. No storage allowances, prices, file limits, retention periods or link lifetimes are supplied as production defaults.

1. Create an R2 Standard bucket **in the US jurisdiction**. A location hint is insufficient. Disable both public `r2.dev` access and every public custom domain. Provision bucket-scoped object read/write credentials. Configure `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, then explicitly attest the private US setup with `R2_PRIVATE_US_CONFIRMED=true`. This is an operator attestation, not an automated audit of Cloudflare settings. The application constructs only `https://<account>.us.r2.cloudflarestorage.com`; jurisdiction cannot be changed on an existing bucket. No Virginia/state/data-center placement is promised.
2. Set `FILE_POLICY_JSON` to a JSON object containing the following fields. Choose and approve actual values before activation; there is intentionally no ready-to-copy numeric production policy.

   | Field                     | Meaning                                                                                                 |
   | ------------------------- | ------------------------------------------------------------------------------------------------------- |
   | `maxBytes`                | Nonempty file's maximum byte length, within the deployed web host's request, memory and response bounds |
   | `allowedTypes`            | Explicit nonempty subset of `application/pdf`, `image/png`, `image/jpeg`, `text/plain`                  |
   | `uploadTtlSeconds`        | Lifetime of a single upload reservation; shorter than retention                                         |
   | `accessTtlSeconds`        | Operator-approved short-lived download grant; shorter than retention                                    |
   | `retentionSeconds`        | Access/retention deadline measured from the reservation, snapshotted per file                           |
   | `recordRetentionSeconds`  | Time to retain deleted metadata and attributed requests after confirmed deletion                        |
   | `operationTimeoutSeconds` | Deadline for each R2 request; SDK retries are disabled                                                  |
   | `cleanupGraceSeconds`     | Delay protecting against an in-flight/ambiguous upload; must exceed the request timeout                 |

   Durations must fit the database's integer and the runtime's timer representation; their numeric validation bounds are technical representation limits, not recommended product settings. Policy changes apply to new reservations; existing retention/deletion deadlines remain snapshotted. Revoking an allowed MIME type or lowering the upload limit also affects completion of pending uploads.

3. Configure `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`, deploy the task in `src/trigger/file-cleanup.ts` using Trigger.dev, and attach an explicitly chosen recurring schedule to `private-business-file-cleanup`. Configure the same runtime database, storage and policy environment on the worker. No cron interval is invented here. After verifying the deployed task and attached schedule, set `FILE_CLEANUP_SCHEDULE_CONFIRMED=true` on web and worker and exercise a deletion. The task handles up to 50 due objects per run, with one concurrent scheduled run; provision the interval, provider timeout and worker duration for the expected backlog. Monitor deletion failures and overdue `cleanupAfter` values. The code and database are not proof that a live schedule has been deployed.

The account/bucket fingerprint pins persisted operations to their configured bucket. Do not switch buckets/accounts while objects remain without an explicit migration/offboarding plan. Missing/mismatched live settings do not route to a deterministic adapter. Deterministic providers exist only in isolated tests.

## Lifecycle and access

- `POST /api/businesses/:businessId/files` validates metadata, authorizes management and reserves a private upload. Only a hash of the random upload token is persisted. The response includes the token and expiry; callers send it in `x-file-token` to `PUT .../files/:fileId/content` with the exact MIME type and bytes. Tokens and provider URLs never enter query strings or saved file metadata.
- The application bounds upload bytes while reading, checks declared size, configured MIME and basic file signatures (or strict UTF-8 without NUL for text), and issues a single conditional `PutObject` with server-owned Business/file/owner/checksum metadata. Only confirmed writes become `ready`. Failed or interrupted writes remain unavailable with visible cleanup eligibility. Upload tokens cannot overwrite completed objects. Signature checks are not a malware scanner or full document parser; downloads are attachments with `nosniff` and sandbox headers.
- `POST .../files/:fileId/access` creates a random, hashed, actor-bound expiring access grant. `GET .../files/:fileId/content` requires the grant header **and the current authenticated session**, Business membership and MFA where required. The application checks completion and retention, retrieves private bytes through SigV4-authenticated R2 requests, validates provider metadata/checksum and rechecks current authorization/state/expiry before releasing them. It uses attachment/no-store headers. This application grant is not a public object URL or an R2 presigned bearer URL; downloaded copies cannot be revoked.
- `POST .../files/:fileId/delete` immediately stops new downloads. A durable cleanup run deletes the private object and confirms deletion in PostgreSQL. In-flight reads recheck state before releasing bytes; responses already delivered cannot be recalled.
- Expired/uncompleted/ambiguous uploads and retention-expired files become cleanup work. Worker payloads cannot choose actors, timestamps, Businesses or keys. Narrow security-definer database functions select persisted due work, use row locks and compare-and-set leases, record outbound deletion attempts and confirm outcomes. This policy authority permits required deletion after the uploading user leaves or signs out; it cannot download a file. Failed deletes stay visible and retry after their persisted lease. A worker crash after provider acceptance safely repeats idempotent `DeleteObject`. A configured grace period is required for ambiguous in-flight writes; provider/worker outages can delay physical deletion. Access still stops at its application deadline.
- Confirmed-deleted metadata, access grants and request attribution are purged under the snapshotted record-retention setting. Raw credentials, raw grant tokens, object URLs and file contents are never saved in application diagnostics. Failures expose an allowlisted code and request ID. Trigger task errors omit database/provider exceptions.

## Usage and persistence

`business_file`, `file_access` and `file_usage` use forced RLS. Runtime mutation grants are limited; the runtime cannot assume the schema owner. Business-scoped transactions recheck current capabilities on every operation. Cleanup functions are internal system boundaries with fixed search paths and no public execution grant.

The UI attributes attempted put/get/delete requests to the Business and configured account/bucket. Attempts are persisted **before** outbound calls; ambiguous failures/crashes remain unconfirmed instead of appearing successful. Reserved bytes for uploading/unconfirmed/deleting objects are counted conservatively until confirmed deletion. These are application observations, not exact provider billing or byte-time meters. R2 allowances are account-wide across Businesses/buckets; no Business receives its own free tier. Reconcile actual account usage in Cloudflare. Attribution is retained only for the configured record-retention period.

Apply additive schema updates through the accepted `pnpm db-push` owner/direct connection and security reapplication workflow. No destructive reset or migration files are used. The worker uses the same restricted runtime role as the application.

## Verification and user workflow

Automated tests use real isolated PostgreSQL, real authentication/MFA and the application API with a controlled clock and deterministic storage. They cover completion, metadata/bytes, current roles/MFA and membership revocation, cross-Business requests, invalid files, replay and expiry, private HTTP responses, retention, ambiguous writes, cleanup retries/leases/purge and in-flight deletion/expiry. Schema reapplication is exercised without resetting data.

The user owns browser/UI validation and acceptance. From a Business profile, open **Private Business files**. Before activation, expect a setup-required notice and disabled live actions. After explicit activation, upload an allowed file, refresh, download the same bytes, inspect ownership/retention and request deletion. Expect unavailable access immediately, followed by confirmed deletion after cleanup. Test an expired/incomplete upload, unsupported MIME/size, a foreign Business/file ID, Salesperson management denial and an Owner/Admin session lacking MFA. Inspect cleanup failure/retry status with an intentionally unavailable storage provider in a suitable test environment. An open `in-test` issue means implementation is finished and human acceptance is pending.

## Provider contracts checked

Checked against current primary documentation on 2026-11-05:

- [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/): US jurisdiction and jurisdiction-specific S3 endpoints; location hints do not guarantee placement.
- [R2 bucket creation](https://developers.cloudflare.com/r2/buckets/create-buckets/): validate the provider's bucket-name format before activation.
- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/): conditional `PutObject`, metadata, private GET and deletion support.
- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/): direct signed URLs are bearer access until expiry; the application instead uses authenticated, persisted expiring grants.
- [R2 data security](https://developers.cloudflare.com/r2/reference/data-security/) and [public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/): retain private bucket access; verify public settings before activation.
- [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/): provider lifecycle deletion is asynchronous; it does not replace application access deadlines or confirmed cleanup state. No bucket-wide lifecycle rule is silently installed.
- [Trigger.dev scheduled tasks](https://trigger.dev/docs/tasks/scheduled): tasks need an attached schedule; the optional cron is not an automatic schedule.
