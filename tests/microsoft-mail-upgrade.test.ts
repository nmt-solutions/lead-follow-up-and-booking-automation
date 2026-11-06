import { afterAll, beforeAll, expect, it } from "vitest";
import { createHarness } from "./support/harness";
import { runtimeDatabase, verifyRuntimeRole } from "../src/db/runtime";
import { createEmailSequenceApplication } from "../src/application/email-sequences";
import { createEmailSequenceRepository } from "../src/db/email-sequence-repository";
import { unavailableSequenceMail } from "../src/email-sequences/provider";
import { prepareDatabaseRole, secureDatabase } from "../src/db/setup";

let h: Awaited<ReturnType<typeof createHarness>>;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});

it("prepares legacy sequence tables before adding native acceptance columns and preserves restricted Business access", async () => {
  h.clock.set("2026-11-05T09:00:00Z");
  const owner = await h.signIn("microsoft-upgrade@example.com");
  const business = await h.application.createBusiness(owner, {
    name: "Existing supplier",
    offering: "Steel",
    homeMarket: "US",
    website: "",
  });
  // Owner-only fault setup models the exact pre-#36 schema, not a mocked repository.
  await h.admin.query(
    "ALTER TABLE email_sequence_action DROP COLUMN processing_acceptance; ALTER TABLE email_sequence_event DROP COLUMN processing_acceptance",
  );
  // Exercise the old-schema preparation separately from the already-covered fresh Drizzle push.
  await prepareDatabaseRole(h.admin);
  await h.admin.query(
    "ALTER TABLE email_sequence_action ADD COLUMN processing_acceptance jsonb; ALTER TABLE email_sequence_event ADD COLUMN processing_acceptance jsonb",
  );
  await secureDatabase(h.admin);
  await verifyRuntimeRole(h.runtime);
  expect(await h.application.getProfile(owner, business.id)).toMatchObject({
    name: "Existing supplier",
  });
  const sequences = createEmailSequenceApplication({
    authenticate: h.access.authenticateForWork,
    repository: createEmailSequenceRepository(
      runtimeDatabase(h.runtime),
      h.clock,
    ),
    clock: h.clock,
    provider: unavailableSequenceMail,
  });
  expect(await sequences.workspace(owner, business.id)).toMatchObject({
    policy: null,
    runs: [],
    usage: { reserved: 0, remaining: 0 },
  });
});
