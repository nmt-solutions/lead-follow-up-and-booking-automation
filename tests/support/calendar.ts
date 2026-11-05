import { randomUUID } from "node:crypto";
import type {
  BookingIntent,
  CalendarDescriptor,
  CalendarEvent,
  CalendarProvider,
  CalendarScope,
} from "../../src/models/appointments";
import type { Clock } from "../../src/models/business";

/** Only the external calendar varies. All internal rules and SQL are real. */
export function deterministicCalendar(businessId: string, clock: Clock) {
  const connectionId = randomUUID();
  const descriptor: CalendarDescriptor = {
    businessId,
    connectionId,
    calendarId: "primary",
    label: "Business calendar (fixture)",
    provider: "google",
    accountKind: "google",
    availabilityMode: "free_busy",
    grant: "granted",
    canRead: true,
    canWrite: true,
  };
  const events: CalendarEvent[] = [];
  const busy: { startsAt: string; endsAt: string }[] = [];
  const effects: { kind: string; intent: BookingIntent }[] = [];
  const queries: CalendarScope[] = [];
  const provider: CalendarProvider = {
    available: true,
    async listCalendars() {
      return [{ ...descriptor }];
    },
    async availability(scope) {
      queries.push(scope);
      return {
        ...scope,
        checkedAt: clock.now().toISOString(),
        busy: [
          ...busy,
          ...events
            .filter((e) => e.status === "active")
            .map((e) => ({ startsAt: e.startsAt, endsAt: e.endsAt })),
        ],
      };
    },
    async create(intent) {
      const replay = events.find((e) => e.intentKey === intent.intentKey);
      if (replay) return replay;
      effects.push({ kind: "create", intent });
      const event: CalendarEvent = {
        ...intent,
        eventId: `event-${events.length + 1}`,
        revision: "1",
        status: "active",
        observedAt: clock.now().toISOString(),
      };
      events.push(event);
      return event;
    },
    async lookup(intent) {
      const event = events.find((e) => e.intentKey === intent.intentKey);
      const binding = Object.fromEntries(
        Object.entries(intent).filter(
          ([key]) => !["eventId", "blockedStart", "blockedEnd"].includes(key),
        ),
      );
      return event
        ? {
            status: "found",
            event: { ...event, observedAt: clock.now().toISOString() },
            conflicts: [
              ...busy,
              ...events.filter(
                (e) => e.status === "active" && e.eventId !== event.eventId,
              ),
            ].some(
              (b) =>
                new Date(b.startsAt) < new Date(intent.blockedEnd) &&
                new Date(intent.blockedStart) < new Date(b.endsAt),
            ),
          }
        : {
            ...binding,
            status: "absent",
            definitive: true,
            checkedAt: clock.now().toISOString(),
          };
    },
    async cancel(intent) {
      const event = events.find((e) => e.eventId === intent.eventId);
      if (!event) throw new Error("Calendar event missing");
      effects.push({ kind: "cancel", intent });
      event.status = "cancelled";
      event.revision = "2";
      return { ...event, observedAt: clock.now().toISOString() };
    },
  };
  return { connectionId, descriptor, provider, events, effects, queries, busy };
}
