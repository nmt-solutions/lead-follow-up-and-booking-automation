import type { createHarness } from "./harness";
import { runtimeDatabase } from "../../src/db/runtime";
import { createCostRepository } from "../../src/db/cost-repository";
import { createCostApplication } from "../../src/application/costs";

export async function readOperatorCosts(
  h: Awaited<ReturnType<typeof createHarness>>,
  headers: Headers,
  month = "2026-11",
) {
  const actor = await h.authenticate(headers);
  await h.admin.query(
    "insert into platform_operator(user_id,costs) values($1,true) on conflict(user_id) do update set costs=true",
    [actor.userId],
  );
  const app = createCostApplication({
    authenticatePlatform: h.access.authenticatePlatform,
    repository: createCostRepository(runtimeDatabase(h.runtime)),
    clock: h.clock,
  });
  await app.refresh(headers, { month, retentionSeconds: 3600 });
  return app.workspace(headers, month);
}
