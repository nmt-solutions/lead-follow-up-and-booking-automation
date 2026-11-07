import { createReportingApplication } from "../../src/application/reporting";
import { createReportingRepository } from "../../src/db/reporting-repository";
import { runtimeDatabase } from "../../src/db/runtime";
import type { createHarness } from "./harness";

export function reporting(h: Awaited<ReturnType<typeof createHarness>>) {
  return createReportingApplication({
    authenticate: h.access.authenticateForWork,
    repository: createReportingRepository(runtimeDatabase(h.runtime), h.clock),
    clock: h.clock,
  });
}
