import { z } from "zod";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import { reportQuerySchema } from "../models/reporting";
import type { createReportingRepository } from "../db/reporting-repository";

export function createReportingApplication<C>(d: {
  authenticate(credentials: C): Promise<WorkIdentity>;
  repository: ReturnType<typeof createReportingRepository>;
  clock: Clock;
}) {
  return {
    async read(credentials: C, businessId: unknown, input: unknown) {
      const actor = await d.authenticate(credentials);
      const id = z.uuid().safeParse(businessId);
      const query = reportQuerySchema.safeParse(input);
      if (!id.success || !query.success)
        throw new ApplicationError("INVALID_INPUT");
      const at = d.clock.now();
      const to = query.data.to ? new Date(query.data.to) : at;
      const from = query.data.from
        ? new Date(query.data.from)
        : new Date(to.getTime() - 30 * 86400000);
      if (from >= to || to > at) throw new ApplicationError("INVALID_INPUT");
      return d.repository.read(actor, id.data, {
        ...query.data,
        from: from.toISOString(),
        to: to.toISOString(),
      });
    },
  };
}
