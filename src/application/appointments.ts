import { z } from "zod";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  configureBookingSchema,
  appointmentRequestSchema,
  appointmentRefSchema,
  appointmentEvidenceSchema,
  availabilityQuerySchema,
  type CalendarProvider,
} from "../models/appointments";
import type { createAppointmentRepository } from "../db/appointment-repository";

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
export function createAppointmentApplication<Credentials>(dependencies: {
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createAppointmentRepository>;
  provider: CalendarProvider;
  clock: Clock;
  timeoutMs: number;
}) {
  if (
    !Number.isInteger(dependencies.timeoutMs) ||
    dependencies.timeoutMs <= 0 ||
    dependencies.timeoutMs > 5000
  )
    throw new Error("Invalid calendar request deadline");
  const dep = {
    provider: dependencies.provider,
    timeoutMs: dependencies.timeoutMs,
  };
  async function context(
    credentials: Credentials,
    businessId: unknown,
    opportunityId: unknown,
  ) {
    const actor = await dependencies.authenticateForWork(credentials);
    return {
      actor,
      ...validate(
        z.strictObject({ businessId: z.uuid(), opportunityId: z.uuid() }),
        { businessId, opportunityId },
      ),
    };
  }
  async function read(
    credentials: Credentials,
    businessId: unknown,
    opportunityId: unknown,
  ) {
    const c = await context(credentials, businessId, opportunityId);
    return dependencies.repository.read(
      c.actor,
      c.businessId,
      c.opportunityId,
      dep,
    );
  }
  return {
    read,
    async configure(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const actor = await dependencies.authenticateForWork(credentials);
      await dependencies.repository.configure(
        actor,
        validate(z.uuid(), businessId),
        validate(configureBookingSchema, input),
        dep,
      );
    },
    async availability(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      return dependencies.repository.availability(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(availabilityQuerySchema, input),
        dep,
      );
    },
    async request(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.request(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(appointmentRequestSchema, input),
        dep,
      );
      return read(credentials, businessId, opportunityId);
    },
    async book(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.book(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(appointmentRefSchema, input).appointmentId,
        dep,
      );
      return read(credentials, businessId, opportunityId);
    },
    async reconcile(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.reconcile(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(appointmentRefSchema, input).appointmentId,
        dep,
      );
      return read(credentials, businessId, opportunityId);
    },
    async evidence(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.evidence(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(appointmentEvidenceSchema, input),
      );
      return read(credentials, businessId, opportunityId);
    },
    async cancel(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId);
      await dependencies.repository.cancel(
        c.actor,
        c.businessId,
        c.opportunityId,
        validate(appointmentRefSchema, input).appointmentId,
        dep,
      );
      return read(credentials, businessId, opportunityId);
    },
  };
}
