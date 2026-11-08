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
import type { Transaction } from "../db/scope";

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const p = schema.safeParse(input);
  if (!p.success) throw new ApplicationError("INVALID_INPUT");
  return p.data;
}
export function createAppointmentApplication<Credentials>(dependencies: {
  authenticateForWork(credentials: Credentials): Promise<WorkIdentity>;
  repository: ReturnType<typeof createAppointmentRepository>;
  provider: CalendarProvider;
  providerForTransaction?(tx: Transaction): CalendarProvider;
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
    providerForTransaction: dependencies.providerForTransaction,
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
  async function pilotBudget(
    c: { actor: WorkIdentity; businessId: string; opportunityId?: string },
    phase: string,
    payload: Record<string, unknown>,
    selected?: Record<string, unknown> | null,
  ) {
    const decision = await dependencies.repository.reservePilotOperation(
      c.actor,
      c.businessId,
      c.opportunityId ?? null,
      phase,
      payload,
      selected,
    );
    if (!decision.allowed && phase !== "read")
      throw new ApplicationError("PAID_ACCESS_REQUIRED");
    return {
      ...dep,
      pilotBlocked: !decision.allowed,
      pilotProvider: decision.provider,
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
      await pilotBudget(c, "read", {}),
    );
  }
  return {
    read,
    async configure(
      credentials: Credentials,
      businessId: unknown,
      input: unknown,
    ) {
      const actor = await dependencies.authenticateForWork(credentials),
        id = validate(z.uuid(), businessId),
        data = validate(configureBookingSchema, input);
      await dependencies.repository.configure(
        actor,
        id,
        data,
        await pilotBudget(
          { actor, businessId: id },
          "configure",
          data,
          data.configuration.calendar,
        ),
      );
    },
    async availability(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId),
        data = validate(availabilityQuerySchema, input),
        native = await pilotBudget(c, "availability", data);
      return dependencies.repository.availability(
        c.actor,
        c.businessId,
        c.opportunityId,
        data,
        native,
      );
    },
    async request(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId),
        data = validate(appointmentRequestSchema, input),
        native = await pilotBudget(c, "request", data);
      await dependencies.repository.request(
        c.actor,
        c.businessId,
        c.opportunityId,
        data,
        native,
      );
      return read(credentials, businessId, opportunityId);
    },
    async book(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId),
        data = validate(appointmentRefSchema, input),
        native = await pilotBudget(c, "book", data);
      await dependencies.repository.book(
        c.actor,
        c.businessId,
        c.opportunityId,
        data.appointmentId,
        native,
      );
      return read(credentials, businessId, opportunityId);
    },
    async reconcile(
      credentials: Credentials,
      businessId: unknown,
      opportunityId: unknown,
      input: unknown,
    ) {
      const c = await context(credentials, businessId, opportunityId),
        data = validate(appointmentRefSchema, input),
        native = await pilotBudget(c, "reconcile", data);
      await dependencies.repository.reconcile(
        c.actor,
        c.businessId,
        c.opportunityId,
        data.appointmentId,
        native,
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
      const c = await context(credentials, businessId, opportunityId),
        data = validate(appointmentRefSchema, input),
        native = await pilotBudget(c, "cancel", data);
      await dependencies.repository.cancel(
        c.actor,
        c.businessId,
        c.opportunityId,
        data.appointmentId,
        native,
      );
      return read(credentials, businessId, opportunityId);
    },
  };
}
