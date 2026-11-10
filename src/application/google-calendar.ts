import { z } from "zod";
import type { Database } from "../db/runtime";
import type { Clock } from "../models/business";
import type { createSessionAccess } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import type { GoogleCalendarConfiguration } from "../google-calendar/configuration";
import { createGoogleCalendarRepository } from "../db/google-calendar-repository";

export function createGoogleCalendarApplication(options: {
  database: Database;
  access: Pick<ReturnType<typeof createSessionAccess>, "authenticateForWork">;
  clock: Clock;
  configuration: GoogleCalendarConfiguration | null;
  fetch: typeof fetch;
}) {
  const repository = createGoogleCalendarRepository(options.database, options);
  function validate<T>(schema: z.ZodType<T>, input: unknown) {
    const p = schema.safeParse(input);
    if (!p.success) throw new ApplicationError("INVALID_INPUT");
    return p.data;
  }
  async function context(credentials: Headers, id: unknown) {
    return {
      actor: await options.access.authenticateForWork(credentials),
      businessId: validate(z.uuid(), id),
    };
  }
  return {
    async read(credentials: Headers, id: unknown) {
      const c = await context(credentials, id);
      return repository.read(c.actor, c.businessId);
    },
    async start(credentials: Headers, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const { returnPath } = validate(
        z.strictObject({ returnPath: z.string().max(512) }),
        input,
      );
      // Only this Business's settings or onboarding can receive the redirect.
      if (
        ![
          `/businesses/${c.businessId}/calendar`,
          `/onboarding/${c.businessId}?step=calendar`,
        ].includes(returnPath)
      )
        throw new ApplicationError("INVALID_INPUT");
      return repository.start(c.actor, c.businessId, returnPath);
    },
    async callback(credentials: Headers, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const data = validate(
        z
          .strictObject({
            state: z.string().regex(/^[a-f0-9]{64}$/),
            code: z.string().min(1).max(4096).optional(),
            error: z.string().min(1).max(256).optional(),
          })
          .refine((v) => Boolean(v.code) !== Boolean(v.error)),
        input,
      );
      return repository.callback(c.actor, c.businessId, data);
    },
    async select(credentials: Headers, id: unknown, input: unknown) {
      const c = await context(credentials, id);
      const data = validate(
        z.strictObject({ calendarId: z.string().min(1).max(256) }),
        input,
      );
      return repository.select(c.actor, c.businessId, data.calendarId);
    },
    async disconnect(credentials: Headers, id: unknown) {
      const c = await context(credentials, id);
      return repository.disconnect(c.actor, c.businessId);
    },
  };
}
