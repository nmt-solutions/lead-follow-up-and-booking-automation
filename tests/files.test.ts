import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { createFileApplication } from "../src/application/files";
import { createFileRepository } from "../src/db/file-repository";
import { runtimeDatabase } from "../src/db/runtime";
import { createMemoryStorage } from "./support/storage";
import type { FilePolicy } from "../src/models/files";
import { createFilesHttp } from "../src/http/files";

describe("private Business files at the application seam", () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  const storage = createMemoryStorage();
  const policy: FilePolicy = {
    maxBytes: 1024,
    allowedTypes: ["text/plain"],
    uploadTtlSeconds: 60,
    accessTtlSeconds: 30,
    retentionSeconds: 3600,
    operationTimeoutSeconds: 5,
    cleanupGraceSeconds: 60,
    recordRetentionSeconds: 3600,
    accountScope: "test-account-bucket",
  };
  let files: ReturnType<typeof createFileApplication<Headers>>;
  beforeEach(async () => {
    h = await createHarness();
    files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      storage,
      policy,
      clock: h.clock,
    });
  });
  afterEach(async () => h?.close());
  beforeEach(() => {
    h.clock.set("2026-11-05T09:00:00Z");
    storage.effects.length = 0;
    storage.objects.clear();
    storage.failPut = false;
    storage.failAfterPut = false;
    storage.failDelete = false;
    storage.failAfterDelete = false;
    storage.afterPut = null;
    storage.afterGet = null;
  });

  it("completes a private upload and retrieves the same bytes through an authorized expiring grant", async () => {
    const owner = await h.signIn("files-owner@example.com");
    const business = await h.application.createBusiness(owner, {
      name: "File owner",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const upload = await files.beginUpload(owner, business.id, {
      name: "approved.txt",
      contentType: "text/plain",
      size: 5,
    });
    expect((await files.list(owner, business.id)).files[0]).toMatchObject({
      state: "pending",
      name: "approved.txt",
      size: 5,
    });
    await expect(
      files.createAccess(owner, business.id, upload.file.id),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    await files.completeUpload(
      owner,
      business.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("hello"),
    );
    const grant = await files.createAccess(owner, business.id, upload.file.id);
    const download = await files.download(
      owner,
      business.id,
      upload.file.id,
      grant.token,
    );
    expect(new TextDecoder().decode(download.bytes)).toBe("hello");
    const state = await files.list(owner, business.id);
    expect(state.files[0]).toMatchObject({
      state: "ready",
      retentionUntil: "2026-11-05T10:00:00.000Z",
    });
    expect(state.usage).toMatchObject({
      storedBytes: 5,
      putAttempts: 1,
      getAttempts: 1,
    });
    expect(storage.effects.map((e) => e.action)).toEqual(["put", "get"]);
    expect(storage.effects[0]).toMatchObject({
      metadata: { businessId: business.id, fileId: upload.file.id },
    });
  });

  it("denies foreign Businesses, forged grants, expired links, replayed completion and invalid files without unintended storage calls", async () => {
    const owner = await h.signIn("files-validation@example.com");
    const other = await h.signIn("files-outsider@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "A",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const b = await h.application.createBusiness(other, {
      name: "B",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    for (const input of [
      { name: "evil.svg", contentType: "image/svg+xml", size: 20 },
      { name: "large.txt", contentType: "text/plain", size: 1025 },
      { name: "../path.txt", contentType: "text/plain", size: 5 },
      {
        name: "owned.txt",
        contentType: "text/plain",
        size: 5,
        businessId: b.id,
      },
    ])
      await expect(files.beginUpload(owner, a.id, input)).rejects.toBeDefined();
    const upload = await files.beginUpload(owner, a.id, {
      name: "approved.txt",
      contentType: "text/plain",
      size: 5,
    });
    await expect(
      files.completeUpload(
        owner,
        a.id,
        upload.file.id,
        upload.token,
        new Uint8Array([0, 1, 2, 3, 4]),
      ),
    ).rejects.toMatchObject({ code: "FILE_DISALLOWED" });
    await expect(
      files.completeUpload(
        owner,
        a.id,
        upload.file.id,
        upload.token,
        new TextEncoder().encode("wrong size"),
      ),
    ).rejects.toMatchObject({ code: "FILE_DISALLOWED" });
    await expect(
      files.completeUpload(
        other,
        a.id,
        upload.file.id,
        upload.token,
        new TextEncoder().encode("hello"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(files.list(other, a.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      files.deleteFile(other, b.id, upload.file.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.effects).toEqual([]);
    await files.completeUpload(
      owner,
      a.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("hello"),
    );
    await expect(
      files.completeUpload(
        owner,
        a.id,
        upload.file.id,
        upload.token,
        new TextEncoder().encode("hello"),
      ),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    const grant = await files.createAccess(owner, a.id, upload.file.id);
    await expect(
      files.download(other, b.id, upload.file.id, grant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      files.download(owner, a.id, upload.file.id, "a".repeat(64)),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    h.clock.set("2026-11-05T09:00:30Z");
    await expect(
      files.download(owner, a.id, upload.file.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect(storage.effects.map((e) => e.action)).toEqual(["put"]);
    const pending = await files.beginUpload(owner, a.id, {
      name: "late.txt",
      contentType: "text/plain",
      size: 5,
    });
    h.clock.set("2026-11-05T09:01:30Z");
    await expect(
      files.completeUpload(
        owner,
        a.id,
        pending.file.id,
        pending.token,
        new TextEncoder().encode("hello"),
      ),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
  });

  it("recovers ambiguous uploads and cleanup failures, expires retention immediately and purges records under the configured policy", async () => {
    const owner = await h.signIn("files-cleanup@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "Cleanup",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const upload = await files.beginUpload(owner, a.id, {
      name: "uncertain.txt",
      contentType: "text/plain",
      size: 5,
    });
    storage.failAfterPut = true;
    await expect(
      files.completeUpload(
        owner,
        a.id,
        upload.file.id,
        upload.token,
        new TextEncoder().encode("hello"),
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect((await files.list(owner, a.id)).files[0]).toMatchObject({
      state: "failed",
      failure: "UPLOAD_UNCONFIRMED",
    });
    await expect(
      files.createAccess(owner, a.id, upload.file.id),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    await files.deleteFile(owner, a.id, upload.file.id);
    await files.cleanup();
    expect(storage.effects.map((e) => e.action)).toEqual(["put"]);
    h.clock.set("2026-11-05T09:01:05Z");
    storage.failDelete = true;
    await files.cleanup();
    expect((await files.list(owner, a.id)).files[0]).toMatchObject({
      state: "deleting",
      failure: "CLEANUP_FAILED",
    });
    storage.failDelete = false;
    h.clock.set("2026-11-05T09:02:10Z");
    // Advancing the application clock does not expire a DB-time worker lease.
    expect(await files.cleanup()).toEqual({ attempted: 0, failed: 0 });
    await h.admin.query(
      "update business_file set cleanup_after=least(statement_timestamp(),$2::timestamptz)-interval '1 second' where id=$1",
      [upload.file.id, h.clock.now()],
    );
    await Promise.all([files.cleanup(), files.cleanup()]);
    const deleted = await files.list(owner, a.id);
    expect(deleted.files[0]).toMatchObject({
      state: "deleted",
      deletedAt: "2026-11-05T09:02:10.000Z",
    });
    expect(deleted.usage).toMatchObject({
      storedBytes: 0,
      putAttempts: 1,
      deleteAttempts: 2,
      uncertainAttempts: 2,
    });
    await files.cleanup();
    expect(storage.effects.map((e) => e.action)).toEqual([
      "put",
      "delete",
      "delete",
    ]);
    h.clock.set("2026-11-05T10:02:10Z");
    await files.cleanup();
    expect((await files.list(owner, a.id)).files).toEqual([]);
  });

  it("blocks access at retention expiry before storage deletion and cleans abandoned reservations without user-session authority", async () => {
    const owner = await h.signIn("files-retention@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "Retention",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const upload = await files.beginUpload(owner, a.id, {
      name: "retained.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      a.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("hello"),
    );
    await files.beginUpload(owner, a.id, {
      name: "abandoned.txt",
      contentType: "text/plain",
      size: 5,
    });
    await h.reapplySchema();
    h.clock.set("2026-11-05T09:59:50Z");
    const grant = await files.createAccess(owner, a.id, upload.file.id);
    expect(grant.expiresAt).toBe("2026-11-05T10:00:00.000Z");
    h.clock.set("2026-11-05T10:00:00Z");
    await expect(
      files.download(owner, a.id, upload.file.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect(
      (await files.list(owner, a.id)).files.find(
        (f) => f.id === upload.file.id,
      ),
    ).toMatchObject({ state: "ready", accessAvailable: false });
    await h.signOut(owner);
    const result = await files.cleanup();
    expect(result).toEqual({ attempted: 2, failed: 0 });
    expect(storage.objects.size).toBe(0);
    const signedIn = await h.signIn("files-retention@example.com");
    expect(
      (await files.list(signedIn, a.id)).files.every(
        (f) => f.state === "deleted",
      ),
    ).toBe(true);
    expect(await files.cleanup()).toEqual({ attempted: 0, failed: 0 });
  });

  it("enforces current roles, revoked membership and Owner/Admin MFA for every command and grant", async () => {
    const owner = await h.signIn("files-permissions@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "Permissions",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const upload = await files.beginUpload(owner, a.id, {
      name: "shared.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      a.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("hello"),
    );
    const ownerGrant = await files.createAccess(owner, a.id, upload.file.id);
    await h.team.invite(owner, a.id, {
      email: "file-sales@example.com",
      role: "salesperson",
    });
    const sales = await h.signIn("file-sales@example.com", false);
    const message = h.invitations.sent.at(-1);
    if (!message) throw new Error("Invitation fixture missing");
    const token = new URLSearchParams(new URL(message.url).hash.slice(1)).get(
      "token",
    );
    await h.team.accept(sales, { token });
    expect((await files.list(sales, a.id)).canManage).toBe(false);
    await expect(
      files.beginUpload(sales, a.id, {
        name: "denied.txt",
        contentType: "text/plain",
        size: 5,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      files.deleteFile(sales, a.id, upload.file.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      files.completeUpload(
        sales,
        a.id,
        upload.file.id,
        upload.token,
        new TextEncoder().encode("hello"),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      files.download(sales, a.id, upload.file.id, ownerGrant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    const salesGrant = await files.createAccess(sales, a.id, upload.file.id);
    expect(
      new TextDecoder().decode(
        (await files.download(sales, a.id, upload.file.id, salesGrant.token))
          .bytes,
      ),
    ).toBe("hello");
    const actor = await h.authenticate(sales);
    await h.team.removeMember(owner, a.id, { userId: actor.userId });
    await expect(
      files.download(sales, a.id, upload.file.id, salesGrant.token),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const primary = await h.signIn("files-permissions@example.com", false);
    for (const command of [
      () => files.list(primary, a.id),
      () => files.createAccess(primary, a.id, upload.file.id),
      () => files.download(primary, a.id, upload.file.id, ownerGrant.token),
      () => files.deleteFile(primary, a.id, upload.file.id),
      () =>
        files.beginUpload(primary, a.id, {
          name: "denied.txt",
          contentType: "text/plain",
          size: 5,
        }),
    ])
      await expect(command()).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(storage.effects.map((e) => e.action)).toEqual(["put", "get"]);
  });

  it("validates HTTP bodies and emits safe private responses and diagnostics", async () => {
    const owner = await h.signIn("files-http@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "HTTP",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const http = createFilesHttp({
      application: files,
      origin: "http://localhost:3000",
      reportFailure: (d) => h.diagnostics.push(d),
    });
    const request = (
      method: string,
      data: string,
      extra: Record<string, string> = {},
    ) =>
      new Request("http://localhost:3000/api/files", {
        method,
        headers: {
          cookie: owner.get("cookie") ?? "",
          origin: "http://localhost:3000",
          "content-type": "application/json",
          ...extra,
        },
        body: data,
      });
    expect(
      (
        await http.begin(
          request("POST", "{}", { origin: "https://untrusted.example" }),
          a.id,
        )
      ).status,
    ).toBe(403);
    expect((await http.begin(request("POST", "not JSON"), a.id)).status).toBe(
      400,
    );
    const good = await files.beginUpload(owner, a.id, {
      name: "good.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      a.id,
      good.file.id,
      good.token,
      new TextEncoder().encode("hello"),
    );
    const access = await files.createAccess(owner, a.id, good.file.id);
    const downloaded = await http.download(
      new Request("http://localhost:3000/download", {
        headers: {
          cookie: owner.get("cookie") ?? "",
          "x-file-token": access.token,
        },
      }),
      a.id,
      good.file.id,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''good.txt",
    );
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await downloaded.text()).toBe("hello");
    const upload = await files.beginUpload(owner, a.id, {
      name: "http.txt",
      contentType: "text/plain",
      size: 5,
    });
    const uploadHeaders = {
      "content-type": "text/plain",
      "x-file-token": upload.token,
    };
    expect(
      (
        await http.upload(
          request("PUT", "too many bytes", uploadHeaders),
          a.id,
          upload.file.id,
        )
      ).status,
    ).toBe(400);
    storage.failAfterPut = true;
    const failed = await http.upload(
      request("PUT", "hello", uploadHeaders),
      a.id,
      upload.file.id,
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(h.diagnostics)).not.toContain("private-provider");
    expect(JSON.stringify(h.diagnostics)).not.toContain(upload.token);
    const unavailable = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage: null,
      policy: null,
    });
    expect((await unavailable.list(owner, a.id)).readiness).toBe(
      "setup_required",
    );
    await expect(
      unavailable.beginUpload(owner, a.id, {
        name: "blocked.txt",
        contentType: "text/plain",
        size: 5,
      }),
    ).rejects.toMatchObject({ code: "FILE_SETUP_REQUIRED" });
  });

  it("does not publish a file deleted during upload or release a download whose grant expires in flight", async () => {
    const owner = await h.signIn("files-inflight@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "Inflight",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const removed = await files.beginUpload(owner, a.id, {
      name: "removed.txt",
      contentType: "text/plain",
      size: 5,
    });
    storage.afterPut = async () => {
      await files.deleteFile(owner, a.id, removed.file.id);
    };
    await expect(
      files.completeUpload(
        owner,
        a.id,
        removed.file.id,
        removed.token,
        new TextEncoder().encode("hello"),
      ),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    expect((await files.list(owner, a.id)).files[0]).toMatchObject({
      state: "deleting",
      accessAvailable: false,
    });
    storage.afterPut = null;
    const upload = await files.beginUpload(owner, a.id, {
      name: "slow.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      a.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("hello"),
    );
    const grant = await files.createAccess(owner, a.id, upload.file.id);
    storage.afterGet = async () => {
      h.clock.set("2026-11-05T09:00:30Z");
    };
    await expect(
      files.download(owner, a.id, upload.file.id, grant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    const nextGrant = await files.createAccess(owner, a.id, upload.file.id);
    storage.afterGet = async () => {
      await files.deleteFile(owner, a.id, upload.file.id);
    };
    await expect(
      files.download(owner, a.id, upload.file.id, nextGrant.token),
    ).rejects.toMatchObject({ code: "FILE_UNAVAILABLE" });
    h.clock.set("2026-11-05T09:01:05Z");
    await files.cleanup();
    expect(
      (await files.list(owner, a.id)).files.find(
        (file) => file.id === removed.file.id,
      ),
    ).toMatchObject({
      state: "deleted",
    });
  });

  it("retries a deletion accepted by the provider without resurrecting the file or double-confirming it", async () => {
    const owner = await h.signIn("files-delete-ack@example.com");
    const a = await h.application.createBusiness(owner, {
      name: "Delete acknowledgement",
      offering: "Steel",
      homeMarket: "",
      website: "",
    });
    const upload = await files.beginUpload(owner, a.id, {
      name: "delete.txt",
      contentType: "text/plain",
      size: 5,
    });
    await files.completeUpload(
      owner,
      a.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("hello"),
    );
    await files.deleteFile(owner, a.id, upload.file.id);
    storage.failAfterDelete = true;
    expect(await files.cleanup()).toEqual({ attempted: 1, failed: 1 });
    expect(storage.objects.size).toBe(0);
    expect((await files.list(owner, a.id)).files[0]).toMatchObject({
      state: "deleting",
      failure: "CLEANUP_FAILED",
    });
    storage.failAfterDelete = false;
    h.clock.set("2026-11-05T09:01:05Z");
    expect(await files.cleanup()).toEqual({ attempted: 0, failed: 0 });
    await h.admin.query(
      "update business_file set cleanup_after=least(statement_timestamp(),$2::timestamptz)-interval '1 second' where id=$1",
      [upload.file.id, h.clock.now()],
    );
    expect(await files.cleanup()).toEqual({ attempted: 1, failed: 0 });
    expect((await files.list(owner, a.id)).usage).toMatchObject({
      deleteAttempts: 2,
      uncertainAttempts: 1,
    });
    await files.cleanup();
    expect(storage.effects.map((e) => e.action)).toEqual([
      "put",
      "delete",
      "delete",
    ]);
  });
});
