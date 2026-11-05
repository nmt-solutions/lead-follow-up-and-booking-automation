import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import {
  calendarDescriptorSchema,
  type CalendarProvider,
} from "../models/appointments";

export async function calendarCall(
  operation: (signal: AbortSignal) => Promise<unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApplicationError("PROVIDER_UNAVAILABLE"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export async function calendarCatalog(
  provider: CalendarProvider,
  businessId: string,
  timeoutMs: number,
) {
  if (!provider.available)
    throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
  const raw = await calendarCall(
    (s) => provider.listCalendars({ businessId }, s),
    timeoutMs,
  );
  const parsed = z.array(calendarDescriptorSchema).max(100).safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.some((c) => c.businessId !== businessId) ||
    new Set(parsed.data.map((c) => `${c.connectionId}:${c.calendarId}`))
      .size !== parsed.data.length
  )
    throw new ApplicationError("PROVIDER_UNAVAILABLE");
  return parsed.data;
}
export const unavailableCalendarProvider: CalendarProvider = {
  available: false,
  async listCalendars() {
    throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
  },
  async availability() {
    throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
  },
  async create() {
    throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
  },
  async lookup() {
    throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
  },
  async cancel() {
    throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
  },
};
