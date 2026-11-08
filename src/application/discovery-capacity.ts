import { configureCapacitySchema } from "../models/discovery-capacity";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { createDiscoveryCapacityRepository } from "../db/discovery-capacity-repository";

export function createDiscoveryCapacityApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createDiscoveryCapacityRepository>;
}) {
  return {
    async configure(credentials: Credentials, input: unknown) {
      const actor = await dependencies.authenticate(credentials);
      const parsed = configureCapacitySchema.safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      return dependencies.repository.configure(actor, parsed.data);
    },
    async configuration(credentials: Credentials) {
      return dependencies.repository.configuration(
        await dependencies.authenticate(credentials),
      );
    },
  };
}
