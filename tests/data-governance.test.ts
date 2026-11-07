import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { createMemoryStorage } from "./support/storage";
import { runtimeDatabase } from "../src/db/runtime";
import { verifyRuntimeRole } from "../src/db/runtime";
import { createDataGovernanceApplication } from "../src/application/data-governance";
import { createDataGovernanceRepository } from "../src/db/data-governance-repository";
import { createNotificationApplication } from "../src/application/notifications";
import { createNotificationRepository } from "../src/db/notification-repository";
import { notificationVault } from "../src/notifications/vault";
import { createAuth } from "../src/auth/auth";
import { createTeamApplication } from "../src/application/team";
import { createTeamRepository } from "../src/db/team-repository";
import { invitationTokens } from "../src/auth/invitation-tokens";
import type { DataPolicy } from "../src/models/data-governance";
import { createInboxApplication } from "../src/application/inbox";
import { createInboxRepository } from "../src/db/inbox-repository";
import { normalizedInquiryAdapter } from "../src/inbox/adapter";
import { createFileApplication } from "../src/application/files";
import { createFileRepository } from "../src/db/file-repository";
import { createSenderApplication } from "../src/application/senders";
import { createSenderRepository } from "../src/db/sender-repository";
import { unavailableSenderAdapter } from "../src/senders/adapter";
import { createMailboxApplication } from "../src/application/mailboxes";
import { createMailboxRepository } from "../src/db/mailbox-repository";
import { unavailableMailboxProvider } from "../src/mailboxes/provider";
import { createGmailApplication } from "../src/application/gmail";
import { createGmailConnection } from "../src/gmail/connection";
import { gmailFixture } from "./support/gmail";
import { createDataRevoker } from "../src/server/data-revoker";
import { createDataGovernanceHttp } from "../src/http/data-governance";
import { campaignFixture } from "./support/campaigns";
import { financialExportFixture } from "./support/governance-financial";
import { metaSendingFixture } from "./support/meta-sending";
import { googleFixture } from "./support/google-calendar";
import { microsoftFixture } from "./support/microsoft-calendar";
import { createGoogleCalendarApplication } from "../src/application/google-calendar";
import { createMicrosoftCalendarApplication } from "../src/application/microsoft-calendar";
import type { createSellerDocumentApplication } from "../src/application/seller-documents";
import type { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import type {
  NativeCleanup,
  RevocationOutcome,
} from "../src/models/data-governance";

describe("Business data export and offboarding at the public application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  const storage = createMemoryStorage();
  let policy: DataPolicy;
  let withdrawn = false;
  let documents:
    ReturnType<typeof createSellerDocumentApplication<Headers>> | undefined;
  let cancel:
    | ReturnType<typeof createSubscriptionPaymentApplication<Headers>>["cancel"]
    | undefined;
  const app = (
    revoke: (target: NativeCleanup) => Promise<RevocationOutcome> = async () =>
      "confirmed",
  ) =>
    createDataGovernanceApplication({
      authenticate: h.access.authenticatePrivileged,
      repository: createDataGovernanceRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage,
      policy: () => (withdrawn ? null : policy),
      revoke,
      documents,
      cancel,
    });
  beforeEach(async () => {
    h = await createHarness();
    withdrawn = false;
    documents = undefined;
    cancel = undefined;
    policy = {
      id: "fixture-reviewed-terms",
      version: 1,
      businessIds: [],
      mode: "fixture",
      reviewedBy: "fixture legal and contract reviewer",
      evidence: ["fixture executed retention agreement"],
      effectiveFrom: "2026-11-01T00:00:00Z",
      effectiveUntil: "2027-11-01T00:00:00Z",
      access: "owner_admin",
      afterCancellation: true,
      preserveFinancial: true,
      retention: {
        retainedRecords: "source_contract",
        financialEvidenceUntil: "2027-11-01T00:00:00Z",
        evidence: "fixture financial preservation review",
      },
      exportSeconds: 3600,
      grantSeconds: 60,
      maxBytes: 2_000_000,
      maxRows: 200,
      storageScope: "fixture-private-bucket",
      sourceRights: [],
      deletion: {
        generalFiles: true,
        notBefore: "2026-11-01T00:00:00Z",
        holds: [],
        evidence: "fixture approved general-file disposal",
      },
      nativeRevocation: true,
      maxAttempts: 3,
      retrySeconds: 1,
    };
    storage.objects.clear();
    storage.effects.length = 0;
    storage.afterGet = null;
    storage.afterPut = null;
    storage.failDelete = false;
    storage.failAfterDelete = false;
  });
  afterEach(async () => h?.close());
  async function nativeMailbox(
    owner: Headers,
    businessId: string,
    google = gmailFixture(),
  ) {
    const database = runtimeDatabase(h.runtime);
    const senders = createSenderApplication({
      authenticate: h.access.authenticateForWork,
      repository: createSenderRepository(database, h.clock),
      adapter: unavailableSenderAdapter,
      clock: h.clock,
    });
    const connection = await senders.saveConnection(owner, businessId, {
      id: null,
      expectedVersion: 0,
      configuration: {
        label: "Sales",
        provider: "gmail",
        account: google.control.email,
        enabled: true,
      },
    });
    const mailboxes = createMailboxApplication({
      authenticate: h.access.authenticateForWork,
      repository: createMailboxRepository(database, h.clock),
      provider: unavailableMailboxProvider,
      clock: h.clock,
    });
    const mailbox = await mailboxes.save(owner, businessId, {
      id: null,
      expectedVersion: 0,
      configuration: {
        connectionId: connection.id,
        requestedRead: true,
        requestedSend: false,
        enabled: true,
        scope: { kind: "folders", refs: ["Label_sales"] },
        history: null,
      },
    });
    const gmail = createGmailApplication({
      access: h.access,
      connection: createGmailConnection(database, {
        clock: h.clock,
        configuration: google.configuration,
        fetch: google.fetch,
      }),
    });
    const start = await gmail.start(owner, businessId, mailbox.id);
    await gmail.callback(owner, businessId, mailbox.id, {
      state: new URL(start.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    });
    return { google, gmail, mailboxes, mailbox };
  }

  it("creates a bounded private actor-bound export with verifiable coverage and denies foreign or replayed grants", async () => {
    const owner = await h.signIn("data-owner@example.com"),
      other = await h.signIn("data-other@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "Retained steel",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    const b = await h.application.createBusiness(other, {
      name: "Private B",
      offering: "Private offering",
      homeMarket: "",
      website: "",
    });
    policy.businessIds = [a.id];
    policy.evidence.push(
      "https://identity.example/sign-in/private-policy-capability?token=private-policy-token",
      "password=private-policy-password",
    );
    const created = await app().export(owner, a.id, {
      requestKey: randomUUID(),
    });
    const grant = await app().access(owner, a.id, created.id);
    await expect(
      app().download(other, a.id, created.id, grant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      app().download(owner, b.id, created.id, grant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await app().download(owner, a.id, created.id, grant.token);
    const text = new TextDecoder().decode(result.bytes);
    const bundle = JSON.parse(text);
    expect(bundle.manifest).toMatchObject({
      format: "business-retained-data/v1",
      businessId: a.id,
      infrastructureBackup: false,
      coverage: "partial",
    });
    expect(bundle.records.business[0]).toMatchObject({
      id: a.id,
      name: "Retained steel",
    });
    expect(text).not.toContain("Private offering");
    expect(text).not.toMatch(/private-policy-(?:capability|token|password)/);
    expect(
      JSON.stringify((await app().workspace(owner, a.id)).policy),
    ).not.toMatch(/private-policy-(?:capability|token|password)/);
    expect(text).not.toMatch(
      /upload_hash|session_id|credentials|state_hash|execution_key|dispatch_key/,
    );
    await expect(
      app().download(owner, a.id, created.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect(storage.effects.map((e) => e.action)).toEqual(["put", "get"]);
  });

  it("preserves global and multi-Business notification facts while explicitly excluding their private capabilities from customer exports", async () => {
    h.clock.set(
      (
        await h.admin.query("select statement_timestamp() at")
      ).rows[0].at.toISOString(),
    );
    const owner = await h.signIn("data-notification-owner@example.com"),
      identity = await h.access.primary(owner),
      database = runtimeDatabase(h.runtime);
    await h.admin.query(
      "insert into platform_operator(user_id,notifications) values($1,true)",
      [identity.user.id],
    );
    const configuration = {
      account: "data-notification-account",
      mode: "production" as const,
      from: "auth@platform.example",
      domainId: randomUUID(),
      apiKey: "fixture-data-notification-key",
      origin: "http://localhost:3000",
    };
    let nativeCalls = 0;
    const notifications = createNotificationApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createNotificationRepository(database),
      configuration,
      vault: notificationVault({
        activeKey: "v1",
        keys: { v1: Buffer.alloc(32, 19) },
      }),
      provider: {
        inspect: async () => {
          nativeCalls++;
          throw new Error("fixture setup intentionally unapproved");
        },
        send: async () => {
          nativeCalls++;
          throw new Error("fixture setup intentionally unapproved");
        },
      },
    });
    const team = createTeamApplication({
      authenticate: h.authenticate,
      authenticatePlatform: h.access.authenticatePlatform,
      repository: createTeamRepository(database),
      clock: h.clock,
      tokens: invitationTokens("data-notification-invitation-fixture"),
      mailer: notifications.invitationMailer,
      origin: configuration.origin,
    });
    const businesses = [];
    for (const name of ["Stopped Business", "Continuing Business"]) {
      const b = await h.application.createBusiness(owner, {
        name,
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
      businesses.push(b);
      await team.invite(owner, b.id, {
        email: `${businesses.length}-private-invite@example.com`,
        role: "salesperson",
      });
    }
    const auth = createAuth({
      database,
      baseURL: configuration.origin,
      secret: "data-notification-authentication-fixture",
      mailer: notifications.signInMailer,
    });
    await auth.api.signInMagicLink({
      body: { email: "private-global-auth@example.com" },
      headers: new Headers({ origin: configuration.origin }),
    });
    const before = await notifications.workspace(owner);
    expect(before.notices).toHaveLength(3);
    expect(before.notices.filter((n) => n.businessId === null)).toHaveLength(1);
    const b = businesses[0];
    policy.businessIds = [b.id];
    await app().offboard(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: policy.version,
      confirmStop: true,
      deleteGeneralFiles: true,
      cancellation: null,
    });
    await app().cleanup();
    expect(
      (await notifications.workspace(owner)).notices.map((n) => n.id).sort(),
    ).toEqual(before.notices.map((n) => n.id).sort());
    expect(
      (await notifications.businessWorkspace(owner, businesses[1].id)).notices,
    ).toHaveLength(1);
    expect(
      (await team.getTeam(owner, businesses[1].id)).invitations[0].status,
    ).toBe("pending");
    const exported = await app().export(owner, b.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(owner, b.id, exported.id),
      bytes = await app().download(owner, b.id, exported.id, grant.token),
      text = new TextDecoder().decode(bytes.bytes),
      bundle = JSON.parse(text);
    for (const notice of before.notices) expect(text).not.toContain(notice.id);
    expect(text).not.toContain(businesses[1].id);
    expect(text).not.toContain("private-global-auth@example.com");
    expect(text).not.toMatch(/token=|capability|sealed/);
    expect(bundle.manifest.omissions).toContain(
      "Authentication, invitation and transactional notification ledgers are outside this customer export; their independent global or Business history and payload-retention authority remain unchanged.",
    );
    expect(nativeCalls).toBe(0);
  });

  it("fences new intake immediately, retains conversations, cleans only approved general files and can reopen without reviving old connections", async () => {
    const owner = await h.signIn("offboard@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Offboarding",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const inbox = createInboxApplication({
      authenticate: h.authenticate,
      repository: createInboxRepository(runtimeDatabase(h.runtime)),
      adapter: normalizedInquiryAdapter,
      clock: h.clock,
    });
    const connection = await inbox.addConnection(owner, b.id, {
      label: "Approved import",
      channel: "email",
      conversationRefs: [],
    });
    const message = {
      eventId: "retained",
      messageRef: "retained",
      conversationRef: "need-steel",
      senderRef: "buyer@example.com",
      senderName: "Steel buyer",
      geography: "US",
      kind: "direct_inquiry",
      subject: "Need steel",
      text: "Keep this conversation password=private-never-export https://identity.example/sign-in/private-path-capability",
      occurredAt: h.clock.now().toISOString(),
    };
    await inbox.capture(owner, b.id, connection.id, message);
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      storage,
      clock: h.clock,
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: policy.storageScope,
      },
    });
    const general = await files.beginUpload(owner, b.id, {
      name: "disposable.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      b.id,
      general.file.id,
      general.token,
      new TextEncoder().encode("hello"),
    );
    const billing = await files.beginUpload(owner, b.id, {
      name: "tax-support.txt",
      purpose: "billing",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      b.id,
      billing.file.id,
      billing.token,
      new TextEncoder().encode("proof"),
    );
    const request = await app().offboard(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: true,
      cancellation: null,
    });
    expect((await app().workspace(owner, b.id)).stopped).toBe(true);
    await app().cleanup();
    expect((await app().workspace(owner, b.id)).offboarding[0]).toMatchObject({
      id: request.id,
      steps: expect.arrayContaining([
        expect.objectContaining({ kind: "file", state: "complete" }),
      ]),
    });
    expect(
      storage.objects.has(`business-files/${b.id}/${general.file.id}`),
    ).toBe(false);
    expect(
      storage.objects.has(`business-files/${b.id}/${billing.file.id}`),
    ).toBe(true);
    h.clock.set("2026-11-05T10:02:00Z");
    const retainedEvidenceGrant = await files.createAccess(
      owner,
      b.id,
      billing.file.id,
    );
    expect(
      new TextDecoder().decode(
        (
          await files.download(
            owner,
            b.id,
            billing.file.id,
            retainedEvidenceGrant.token,
          )
        ).bytes,
      ),
    ).toBe("proof");
    const exported = await app().export(owner, b.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(owner, b.id, exported.id);
    const result = JSON.parse(
      new TextDecoder().decode(
        (await app().download(owner, b.id, exported.id, grant.token)).bytes,
      ),
    );
    expect(result.records.inbox_message[0].content.text).toContain(
      "Keep this conversation",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private-never-export|private-path-capability/,
    );
    await expect(
      inbox.capture(owner, b.id, connection.id, {
        ...message,
        eventId: "late",
        messageRef: "late",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await app().reopen(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirm: true,
    });
    expect((await app().workspace(owner, b.id)).stopped).toBe(false);
    await expect(
      inbox.capture(owner, b.id, connection.id, {
        ...message,
        eventId: "old-after-reopen",
        messageRef: "old-after-reopen",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("disconnects the real Gmail grant before a failed revocation and resumes the original bounded cleanup after restart", async () => {
    const owner = await h.signIn("native-offboard@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Native",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const f = await nativeMailbox(owner, b.id),
      revoker = createDataRevoker({
        fetch: f.google.fetch,
        gmail: f.google.configuration,
        google: null,
        meta: null,
      });
    const input = {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    };
    const result = await app(revoker).offboard(owner, b.id, input);
    expect((await f.gmail.read(owner, b.id, f.mailbox.id)).status).toBe(
      "disconnected",
    );
    expect(
      f.google.calls.filter((c) => c.url.pathname === "/revoke"),
    ).toHaveLength(0);
    f.google.control.revokeError = 503;
    await app(revoker).cleanup();
    expect((await app().workspace(owner, b.id)).offboarding[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "gmail",
          state: "retry",
          tokenWiped: false,
          attempts: 1,
        }),
      ]),
    );
    await expect(
      app().reopen(owner, b.id, {
        requestKey: randomUUID(),
        policyId: policy.id,
        policyVersion: 1,
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    f.google.control.revokeError = 0;
    await app(revoker).cleanup();
    expect((await app().workspace(owner, b.id)).offboarding[0]).toMatchObject({
      id: result.id,
      steps: expect.arrayContaining([
        expect.objectContaining({
          kind: "gmail",
          state: "complete",
          outcome: "confirmed",
          tokenWiped: true,
          attempts: 2,
        }),
      ]),
    });
    expect(await app().offboard(owner, b.id, input)).toEqual(result);
    expect(
      f.google.calls.filter((c) => c.url.pathname === "/revoke"),
    ).toHaveLength(2);
    await h.reapplySchema();
    expect((await app().workspace(owner, b.id)).offboarding[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "gmail",
          state: "complete",
          tokenWiped: true,
        }),
      ]),
    );
  });
  it("leaves another Business's shared Google identity linked without sending global revocation", async () => {
    const owner = await h.signIn("shared-offboard@example.com"),
      other = await h.signIn("shared-other@example.com");
    const a = await h.application.createBusiness(owner, {
        name: "A",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      }),
      b = await h.application.createBusiness(other, {
        name: "B",
        offering: "Scissors",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [a.id];
    const f = await nativeMailbox(owner, a.id),
      g = await nativeMailbox(other, b.id);
    await app().offboard(owner, a.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    });
    const revoker = createDataRevoker({
      fetch: f.google.fetch,
      gmail: f.google.configuration,
      google: null,
      meta: null,
    });
    await app(revoker).cleanup();
    expect(
      f.google.calls.filter((c) => c.url.pathname === "/revoke"),
    ).toHaveLength(0);
    expect((await g.gmail.read(other, b.id, g.mailbox.id)).status).toBe(
      "connected",
    );
    expect((await app().workspace(owner, a.id)).offboarding[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "gmail",
          state: "incomplete",
          outcome: "shared_identity",
          tokenWiped: true,
        }),
      ]),
    );
  });
  it("requires the current receiving Admin after storage I/O and blocks disclosure when policy is withdrawn", async () => {
    const owner = await h.signIn("receiving-owner@example.com"),
      admin = await h.signIn("receiving-admin@example.com");
    const b = await h.application.createBusiness(owner, {
      name: "Receiving",
      offering: "Steel",
      homeMarket: "US",
      website: "",
    });
    policy.businessIds = [b.id];
    await h.team.invite(owner, b.id, {
      email: "receiving-admin@example.com",
      role: "admin",
    });
    const invite = h.invitations.sent.at(-1)!;
    const token = new URLSearchParams(new URL(invite.url).hash.slice(1)).get(
      "token",
    );
    await h.team.accept(admin, { token });
    const exported = await app().export(admin, b.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(admin, b.id, exported.id);
    await expect(
      app().download(owner, b.id, exported.id, grant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    storage.afterGet = async () => {
      await h.team.changeRole(owner, b.id, {
        userId: (await h.authenticate(admin)).userId,
        role: "salesperson",
      });
    };
    await expect(
      app().download(admin, b.id, exported.id, grant.token),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    storage.afterGet = null;
    const own = await app().export(owner, b.id, { requestKey: randomUUID() }),
      ownGrant = await app().access(owner, b.id, own.id);
    storage.afterGet = async () => {
      withdrawn = true;
    };
    await expect(
      app().download(owner, b.id, own.id, ownGrant.token),
    ).rejects.toMatchObject({ code: "DATA_POLICY_REQUIRED" });
    expect((await app().workspace(owner, b.id)).policy).toBe(null);
    await expect(
      app().offboard(owner, b.id, {
        requestKey: randomUUID(),
        policyId: policy.id,
        policyVersion: 1,
        confirmStop: true,
        deleteGeneralFiles: true,
        cancellation: null,
      }),
    ).rejects.toMatchObject({ code: "DATA_POLICY_REQUIRED" });
    expect((await app().workspace(owner, b.id)).stopped).toBe(false);
  });
  it("denies expired and altered signed downloads while keeping export grants single-use", async () => {
    const owner = await h.signIn("expired-export@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Expiry",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    policy.grantSeconds = 1;
    const exported = await app().export(owner, b.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(owner, b.id, exported.id);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(
      app().download(owner, b.id, exported.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    const second = await app().access(owner, b.id, exported.id);
    const object = storage.objects.get(
      `business-exports/${b.id}/${exported.id}.json`,
    )!;
    object.bytes = new TextEncoder().encode("foreign tampered bytes");
    await expect(
      app().download(owner, b.id, exported.id, second.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    await expect(
      app().download(owner, b.id, exported.id, second.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect(storage.effects.filter((e) => e.action === "get")).toHaveLength(1);
  });
  it("denies a policy that expires during storage I/O using database time even when the application clock is stale", async () => {
    const owner = await h.signIn("expired-policy-export@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Policy expiry",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const at = (
      await h.admin.query<{ at: Date }>("select statement_timestamp() at")
    ).rows[0].at;
    policy.effectiveUntil = new Date(at.getTime() + 3000).toISOString();
    const exported = await app().export(owner, b.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(owner, b.id, exported.id);
    storage.afterGet = async () => {
      await new Promise((resolve) => setTimeout(resolve, 3100));
    };
    await expect(
      app().download(owner, b.id, exported.id, grant.token),
    ).rejects.toMatchObject({ code: "DATA_POLICY_REQUIRED" });
    expect(storage.effects.filter((e) => e.action === "get")).toHaveLength(1);
    await expect(app().access(owner, b.id, exported.id)).rejects.toMatchObject({
      code: "DATA_POLICY_REQUIRED",
    });
  });

  it("blocks destruction without policy and cannot use an application future clock to bypass deletion dates or holds", async () => {
    const owner = await h.signIn("retention-owner@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Retention",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      storage,
      clock: h.clock,
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: policy.storageScope,
      },
    });
    const held = await files.beginUpload(owner, b.id, {
      name: "held.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      b.id,
      held.file.id,
      held.token,
      new TextEncoder().encode("legal"),
    );
    const future = await files.beginUpload(owner, b.id, {
      name: "future.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      b.id,
      future.file.id,
      future.token,
      new TextEncoder().encode("later"),
    );
    const input = {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: true,
      cancellation: null,
    };
    const deletion = policy.deletion!;
    policy.deletion = null;
    await expect(app().offboard(owner, b.id, input)).rejects.toMatchObject({
      code: "DATA_POLICY_REQUIRED",
    });
    policy.deletion = {
      ...deletion,
      holds: [held.file.id],
      notBefore: "2099-01-01T00:00:00Z",
    };
    await app().offboard(owner, b.id, input);
    h.clock.set("2099-01-01T00:00:00Z");
    expect(await app().cleanup()).toMatchObject({ attempted: 0 });
    await files.cleanup();
    expect(storage.effects.filter((e) => e.action === "delete")).toEqual([]);
    expect(storage.objects.has(`business-files/${b.id}/${held.file.id}`)).toBe(
      true,
    );
    expect(
      storage.objects.has(`business-files/${b.id}/${future.file.id}`),
    ).toBe(true);
  });
  it("exports repeated retained discovery with original relations after paid reach expires and omits sources without explicit rights", async () => {
    const f = await campaignFixture(h);
    policy.businessIds = [f.business.id];
    await f.discover();
    const first = await app().export(f.owner, f.business.id, {
        requestKey: randomUUID(),
      }),
      firstGrant = await app().access(f.owner, f.business.id, first.id);
    const omitted = JSON.parse(
      new TextDecoder().decode(
        (
          await app().download(
            f.owner,
            f.business.id,
            first.id,
            firstGrant.token,
          )
        ).bytes,
      ),
    );
    expect(omitted.records.discovery_observation).toEqual([]);
    expect(
      omitted.manifest.sources.find(
        (s: { source: string }) => s.source === "discovery_observation",
      ),
    ).toMatchObject({ total: 2, included: 0, omitted: 2 });
    policy.version = 2;
    policy.sourceRights = [
      {
        adapterId: "campaign-research-fixture",
        scopeRef: "campaign-research-fixture",
        evidence:
          "fixture executed per-source export and post-cancellation rights",
        export: true,
        afterCancellation: true,
        sourceOrigins: ["https://fabricator.example"],
      },
    ];
    const identity = await h.auth.api.getSession({ headers: f.owner });
    h.clock.set("2026-12-06T09:00:00Z");
    const refreshed = await h.signIn(identity!.user.email);
    const exported = await app().export(refreshed, f.business.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(refreshed, f.business.id, exported.id);
    const bundle = JSON.parse(
      new TextDecoder().decode(
        (
          await app().download(
            refreshed,
            f.business.id,
            exported.id,
            grant.token,
          )
        ).bytes,
      ),
    );
    expect(bundle.records.discovery_prospect).toHaveLength(1);
    expect(bundle.records.discovery_observation).toHaveLength(2);
    expect(
      new Set(
        bundle.records.discovery_observation.map(
          (o: { prospect_id: string }) => o.prospect_id,
        ),
      ).size,
    ).toBe(1);
    expect(bundle.records.discovery_observation[0].data.evidence[0].url).toBe(
      "https://fabricator.example/about",
    );
    expect(bundle.records.discovery_source[0].rights.adapterId).toBe(
      "campaign-research-fixture",
    );
  });
  it("exports byte-exact private invoices and credits after confirmed cancellation and preserves financial history through cleanup and reapplication", async () => {
    const f = await financialExportFixture(h, storage, policy.storageScope);
    documents = f.documents;
    cancel = f.payments.cancel;
    policy.businessIds = [f.business.id];
    await app().offboard(f.owner, f.business.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: true,
      cancellation: {
        actionId: f.action.id,
        requestKey: randomUUID(),
        confirmed: true,
      },
    });
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).actions[0].lifecycle
        ?.cancellation?.status,
    ).toBe("confirmed");
    await app().cleanup();
    const exported = await app().export(f.owner, f.business.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(f.owner, f.business.id, exported.id),
      bundle = JSON.parse(
        new TextDecoder().decode(
          (
            await app().download(
              f.owner,
              f.business.id,
              exported.id,
              grant.token,
            )
          ).bytes,
        ),
      );
    expect(bundle.records.subscription_period[0]).toMatchObject({
      payment_id: "pay_export",
      charge: { paymentId: "pay_export", charge: f.period.charge!.charge },
    });
    expect(JSON.stringify(bundle)).not.toContain("https://rzp.io/i/fixture1");
    expect(JSON.stringify(bundle)).not.toContain("operationKey");
    expect(
      bundle.records.seller_document
        .map((d: { kind: string }) => d.kind)
        .sort(),
    ).toEqual(["credit_note", "invoice"]);
    for (const doc of [f.invoice, f.credit]) {
      const attachment = bundle.attachments.find(
        (a: { documentId: string }) => a.documentId === doc.id,
      );
      expect(Buffer.from(attachment.base64, "base64")).toEqual(
        Buffer.from(
          storage.objects.get(`seller-documents/${f.business.id}/${doc.id}`)!
            .bytes,
        ),
      );
    }
    await h.reapplySchema();
    expect(
      (await documents.workspace(f.owner, f.business.id)).documents.find(
        (d) => d.id === f.invoice.id,
      )?.snapshot,
    ).toEqual(f.invoice.snapshot);
    expect(
      (await f.payments.workspace(f.owner, f.business.id)).periods[0].charge,
    ).toEqual(f.period.charge);
    expect(
      f.native.requests.filter(
        (r) => r.path.endsWith("/cancel") && r.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("reconciles a lost Meta unsubscribe acknowledgement after restart without deleting customer assets or claiming consent removal", async () => {
    const f = await metaSendingFixture(h, "export-offboard");
    policy.businessIds = [f.businessId];
    let subscribed = true,
      deletes = 0;
    const revoker = createDataRevoker({
      gmail: null,
      google: null,
      meta: {
        providerKey: "deterministic-direct-meta",
        appId: "900001",
        appSecret: "fixture",
        configId: "900002",
        graphVersion: "v25.0",
        activeKeyId: "test",
        keys: { test: "ab".repeat(32) },
      },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(`/v25.0/${f.assets.wabaId}/subscribed_apps`);
        if (init?.method === "DELETE") {
          deletes++;
          subscribed = false;
          throw new Error("private lost provider acknowledgement");
        }
        return Response.json({
          data: subscribed
            ? [{ whatsapp_business_api_data: { id: "900001" } }]
            : [],
        });
      },
    });
    await app(revoker).offboard(f.credentials, f.businessId, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    });
    expect(
      (await f.onboarding.workspace(f.credentials, f.businessId)).connection
        ?.status,
    ).toBe("disconnected");
    await app(revoker).cleanup();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await app(revoker).cleanup();
    expect(deletes).toBe(1);
    const state = await app().workspace(f.credentials, f.businessId);
    expect(state.offboarding[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "meta",
          state: "incomplete",
          outcome: "subscription_removed",
          tokenWiped: true,
          control: expect.stringContaining("No transfer"),
        }),
      ]),
    );
    expect(f.meta.registrations).toHaveLength(0);
    const step = state.offboarding[0].steps.find((s) => s.kind === "meta")!;
    for (const reference of [
      "https://identity.example/auth/private-path",
      "Bearer private-manual-token",
      "secret:private-manual-token",
    ])
      await expect(
        app().recordEvidence(f.credentials, f.businessId, {
          stepId: step.id,
          fact: "number_control_reviewed",
          reference,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await app().recordEvidence(f.credentials, f.businessId, {
      stepId: step.id,
      fact: "number_control_reviewed",
      reference: "CUSTOMER-REVIEW-2026-11",
    });
    const updated = (
      await app().workspace(f.credentials, f.businessId)
    ).offboarding[0].steps.find((s) => s.id === step.id)!;
    expect(updated.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: "number_control_reviewed",
          evidence: "CUSTOMER-REVIEW-2026-11",
          actorId: (await h.authenticate(f.credentials)).userId,
        }),
      ]),
    );
    expect(updated.outcome).toBe("subscription_removed");
    expect(updated.state).toBe("incomplete");
  });
  it("requires every runtime ledger privilege, denies unscoped cleanup authority and preserves approved scope through replaceable-UNIQUE reapplication", async () => {
    const owner = await h.signIn("data-security@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Security",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const request = await app().offboard(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    });
    const exported = await app().export(owner, b.id, {
        requestKey: randomUUID(),
      }),
      grant = await app().access(owner, b.id, exported.id);
    await expect(
      h.runtime.query("select public.start_business_offboarding($1)", [
        request.id,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.runtime.query("select secret from business_data_step"),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await h.runtime.query(
          "select count(*)::int n from business_data_export",
        )
      ).rows[0].n,
    ).toBe(0);
    for (const privilege of ["SELECT", "INSERT"]) {
      await h.admin.query(
        `revoke ${privilege} on public.business_data_export from app_runtime`,
      );
      await expect(verifyRuntimeRole(h.runtime)).rejects.toThrow(
        "Business data security is incomplete",
      );
      await h.admin.query(
        `grant ${privilege} on public.business_data_export to app_runtime`,
      );
    }
    await h.admin.query(
      "alter table public.business_data_export add constraint business_data_export_scope unique using index business_data_export_scope",
    );
    await h.reapplySchema();
    await verifyRuntimeRole(h.runtime);
    const bytes = (await app().download(owner, b.id, exported.id, grant.token))
      .bytes;
    expect(
      JSON.parse(new TextDecoder().decode(bytes)).records.business[0].id,
    ).toBe(b.id);
    expect((await app().workspace(owner, b.id)).offboarding[0].id).toBe(
      request.id,
    );
  });
  it("rejects a missing cleanup lease, keeps lost Google revocation acknowledgement incomplete after bounded retries and wipes the retained token copy", async () => {
    const owner = await h.signIn("lost-google@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Lost acknowledgement",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    policy.maxAttempts = 2;
    const f = await nativeMailbox(owner, b.id);
    let revokes = 0;
    const revoker = createDataRevoker({
      gmail: f.google.configuration,
      google: null,
      meta: null,
      fetch: async (input, init) => {
        if (new URL(String(input)).pathname !== "/revoke")
          return f.google.fetch(input, init);
        revokes++;
        if (revokes === 1)
          throw new Error("Lost accepted revoke acknowledgement");
        return Response.json({ error: "invalid_token" }, { status: 400 });
      },
    });
    const guardedRevoker = async (target: NativeCleanup) => {
      for (const invalidLease of [null, randomUUID()])
        await h.runtime.query(
          "select public.finish_business_data_cleanup($1,$2,'confirmed')",
          [target.id, invalidLease],
        );
      expect((await app().workspace(owner, b.id)).offboarding[0].steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: target.id,
            state: "working",
            tokenWiped: false,
          }),
        ]),
      );
      return revoker(target);
    };
    await app(guardedRevoker).offboard(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    });
    await app(guardedRevoker).cleanup();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await app(guardedRevoker).cleanup();
    expect((await app().workspace(owner, b.id)).offboarding[0].steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "gmail",
          state: "incomplete",
          outcome: "unconfirmed",
          attempts: 2,
          tokenWiped: true,
        }),
      ]),
    );
    await app(revoker).cleanup();
    expect(revokes).toBe(2);
  });
  it("fences native Google and Microsoft calendars, revokes only supported Google scope and preserves honest manual Microsoft consent removal", async () => {
    const owner = await h.signIn("calendar-offboard@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Calendars",
        offering: "Services",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const g = googleFixture(),
      m = microsoftFixture(h.clock),
      database = runtimeDatabase(h.runtime);
    const google = createGoogleCalendarApplication({
        database,
        access: h.access,
        clock: h.clock,
        configuration: g.configuration,
        fetch: g.fetch,
      }),
      microsoft = createMicrosoftCalendarApplication({
        database,
        access: h.access,
        clock: h.clock,
        configuration: m.configuration,
        fetch: m.fetch,
      });
    const gs = await google.start(owner, b.id, {
      returnPath: `/businesses/${b.id}/calendar`,
    });
    const gc = {
      state: new URL(gs.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    };
    await google.callback(owner, b.id, gc);
    await google.select(owner, b.id, { calendarId: "dedicated@example.com" });
    const ms = await microsoft.start(owner, b.id, {
      returnPath: `/businesses/${b.id}/calendar`,
    });
    m.control.nonce = new URL(ms.authorizationUrl).searchParams.get("nonce")!;
    const mc = {
      state: new URL(ms.authorizationUrl).searchParams.get("state"),
      code: "fixture-code",
    };
    await microsoft.callback(owner, b.id, mc);
    await microsoft.select(owner, b.id, { calendarId: "primary" });
    const calls = m.calls.length;
    await app().offboard(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirmStop: true,
      deleteGeneralFiles: false,
      cancellation: null,
    });
    const revoker = createDataRevoker({
      fetch: g.fetch,
      gmail: null,
      google: g.configuration,
      meta: null,
    });
    await app(revoker).cleanup();
    const steps = (await app().workspace(owner, b.id)).offboarding[0].steps;
    expect(steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "google_calendar",
          state: "complete",
          outcome: "confirmed",
          tokenWiped: true,
        }),
        expect.objectContaining({
          kind: "microsoft_calendar",
          state: "incomplete",
          outcome: "manual_required",
          tokenWiped: true,
        }),
      ]),
    );
    expect(
      g.calls.filter((c) => new URL(c.url).pathname === "/revoke"),
    ).toHaveLength(1);
    expect(m.calls).toHaveLength(calls);
    await app().reopen(owner, b.id, {
      requestKey: randomUUID(),
      policyId: policy.id,
      policyVersion: 1,
      confirm: true,
    });
    await expect(google.callback(owner, b.id, gc)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(microsoft.callback(owner, b.id, mc)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect((await google.read(owner, b.id)).status).not.toBe("ready");
    expect((await microsoft.read(owner, b.id)).status).not.toBe("ready");
  });
  it("enforces same-origin bounded commands and delivers a private attachment with the grant kept out of the URL", async () => {
    const owner = await h.signIn("http-data@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "HTTP",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const diagnostics: { requestId: string; code: string }[] = [];
    const http = createDataGovernanceHttp({
      application: app(),
      origin: "http://localhost:3000",
      reportFailure: (d) => diagnostics.push(d),
    });
    const request = (
      path: string,
      body: unknown,
      origin = "http://localhost:3000",
    ) =>
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: {
          cookie: owner.get("cookie")!,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const base = `/api/businesses/${b.id}/data`;
    const denied = await http.command(
      request(
        base,
        { command: "export", input: { requestKey: randomUUID() } },
        "https://foreign.example",
      ),
      b.id,
    );
    expect(denied.status).toBe(403);
    expect(storage.effects).toEqual([]);
    const invalid = await http.command(
      request(base, {
        command: "export",
        input: { requestKey: randomUUID(), businessId: randomUUID() },
      }),
      b.id,
    );
    expect(invalid.status).toBe(400);
    const created = await http.command(
      request(base, { command: "export", input: { requestKey: randomUUID() } }),
      b.id,
    );
    expect(created.status).toBe(200);
    const exported = await created.json();
    const access = await http.grant(
        request(`${base}/${exported.data.id}/access`, {}),
        b.id,
        exported.data.id,
      ),
      grant = await access.json();
    const download = await http.download(
      request(`${base}/${exported.data.id}/content`, {
        token: grant.data.token,
      }),
      b.id,
      exported.data.id,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("Cache-Control")).toContain("no-store");
    expect(download.headers.get("Content-Disposition")).toContain(
      "attachment;",
    );
    expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await download.json()).manifest.businessId).toBe(b.id);
    expect(JSON.stringify(diagnostics)).not.toContain(grant.data.token);
  });
  it("reconciles an accepted private export PUT after a lost acknowledgement and keeps a concurrent replay on the same immutable artifact", async () => {
    const owner = await h.signIn("export-put-reconcile@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Export retry",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    const originalPut = storage.put.bind(storage);
    storage.put = async (key, object) => {
      if (storage.objects.has(key))
        throw new Error("Conditional write conflict");
      return originalPut(key, object);
    };
    try {
      storage.failAfterPut = true;
      const input = { requestKey: randomUUID() };
      const created = await app().export(owner, b.id, input);
      storage.failAfterPut = false;
      const repeated = await Promise.all([
        app().export(owner, b.id, input),
        app().export(owner, b.id, input),
      ]);
      expect(repeated).toEqual([created, created]);
      const grant = await app().access(owner, b.id, created.id);
      expect(
        JSON.parse(
          new TextDecoder().decode(
            (await app().download(owner, b.id, created.id, grant.token)).bytes,
          ),
        ).records.business[0].name,
      ).toBe("Export retry");
      expect(storage.effects.filter((e) => e.action === "put")).toHaveLength(1);
      const concurrentInput = { requestKey: randomUUID() };
      let concurrent: Promise<{ id: string }> | undefined;
      storage.afterPut = async () => {
        storage.afterPut = null;
        concurrent = app().export(owner, b.id, concurrentInput);
        await concurrent;
      };
      const original = await app().export(owner, b.id, concurrentInput);
      expect(await concurrent).toEqual(original);
      expect(storage.effects.filter((e) => e.action === "put")).toHaveLength(2);
    } finally {
      storage.put = originalPut;
      storage.failAfterPut = false;
      storage.afterPut = null;
    }
  });
  it("exports later bounded parts instead of permanently omitting retained conversations beyond the row limit", async () => {
    const owner = await h.signIn("export-parts@example.com"),
      b = await h.application.createBusiness(owner, {
        name: "Parts",
        offering: "Steel",
        homeMarket: "US",
        website: "",
      });
    policy.businessIds = [b.id];
    policy.maxRows = 1;
    const inbox = createInboxApplication({
        authenticate: h.authenticate,
        repository: createInboxRepository(runtimeDatabase(h.runtime)),
        adapter: normalizedInquiryAdapter,
        clock: h.clock,
      }),
      connection = await inbox.addConnection(owner, b.id, {
        label: "Sales",
        channel: "email",
        conversationRefs: [],
      });
    for (const id of ["one", "two"])
      await inbox.capture(owner, b.id, connection.id, {
        eventId: id,
        messageRef: id,
        conversationRef: id,
        senderRef: `${id}@example.com`,
        senderName: id,
        geography: "US",
        kind: "direct_inquiry",
        subject: id,
        text: `Retained ${id}`,
        occurredAt: h.clock.now().toISOString(),
      });
    const bundles = [];
    for (const part of [1, 2]) {
      const exported = await app().export(owner, b.id, {
          requestKey: randomUUID(),
          part,
        }),
        grant = await app().access(owner, b.id, exported.id);
      bundles.push(
        JSON.parse(
          new TextDecoder().decode(
            (await app().download(owner, b.id, exported.id, grant.token)).bytes,
          ),
        ),
      );
    }
    expect(bundles.map((b) => b.manifest.part)).toEqual([1, 2]);
    expect(bundles.map((b) => b.manifest.hasMore)).toEqual([true, false]);
    expect(
      new Set(
        bundles.flatMap((b) =>
          b.records.inbox_message.map((m: { id: string }) => m.id),
        ),
      ).size,
    ).toBe(2);
    expect(
      bundles[1].manifest.sources.find(
        (s: { source: string }) => s.source === "inbox_message",
      ),
    ).toMatchObject({ total: 2, included: 1, offset: 1 });
  });
});
