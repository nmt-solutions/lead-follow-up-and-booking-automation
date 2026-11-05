import type {
  Actor,
  BusinessProfile,
  BusinessProfileInput,
  Clock,
} from "../models/business";
import { businessIdSchema, profileSchema } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type { z } from "zod";

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  return parsed.data;
}

export type BusinessRepository = {
  create(
    actor: Actor,
    profile: BusinessProfileInput,
    at: Date,
  ): Promise<BusinessProfile>;
  list(actor: Actor): Promise<BusinessProfile[]>;
  get(actor: Actor, businessId: string): Promise<BusinessProfile>;
  update(
    actor: Actor,
    businessId: string,
    profile: BusinessProfileInput,
    at: Date,
  ): Promise<BusinessProfile>;
};

export function createBusinessApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  authenticatePrivileged(credentials: Credentials): Promise<Actor>;
  repository: BusinessRepository;
  clock: Clock;
}) {
  return {
    async createBusiness(
      credentials: Credentials,
      input: unknown,
    ): Promise<BusinessProfile> {
      const actor = await dependencies.authenticatePrivileged(credentials);
      return dependencies.repository.create(
        actor,
        validate(profileSchema, input),
        dependencies.clock.now(),
      );
    },
    async listBusinesses(credentials: Credentials) {
      return dependencies.repository.list(
        await dependencies.authenticate(credentials),
      );
    },
    async getProfile(credentials: Credentials, id: unknown) {
      const actor = await dependencies.authenticate(credentials);
      return dependencies.repository.get(actor, validate(businessIdSchema, id));
    },
    async updateProfile(credentials: Credentials, id: unknown, input: unknown) {
      const actor = await dependencies.authenticate(credentials);
      return dependencies.repository.update(
        actor,
        validate(businessIdSchema, id),
        validate(profileSchema, input),
        dependencies.clock.now(),
      );
    },
  };
}
