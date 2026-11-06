import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { Transaction } from "../db/scope";
import type { createGoogleCalendarRepository } from "../db/google-calendar-repository";
import type { Clock } from "../models/business";
import {
  bookingIntentSchema,
  type BookingIntent,
  type CalendarProvider,
  type CalendarScope,
  type CalendarEvent,
} from "../models/appointments";
import { GoogleCalendarFailure } from "./http";

type Repository = ReturnType<typeof createGoogleCalendarRepository>;
const instant = z.iso.datetime({ offset: true });
const nativeEvent = z.object({
  id: z.string().min(1).max(256),
  etag: z.string().min(1).max(256).optional(),
  status: z.enum(["confirmed", "tentative", "cancelled"]),
  start: z
    .object({
      dateTime: instant.optional(),
      date: z.iso.date().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
  end: z
    .object({
      dateTime: instant.optional(),
      date: z.iso.date().optional(),
      timeZone: z.string().optional(),
    })
    .optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
  attendees: z.array(z.unknown()).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
});
const eventId = (intent: BookingIntent) => `a${intent.intentKey}`; // Google base32hex subset; stable per persisted intent.
function provenance(intent: BookingIntent) {
  return {
    businessId: intent.businessId,
    connectionId: intent.connectionId,
    opportunityId: intent.opportunityId,
    appointmentId: intent.appointmentId,
    intentKey: intent.intentKey,
  };
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const p = schema.safeParse(raw);
  if (!p.success) throw new GoogleCalendarFailure("invalid_response");
  return p.data;
}
export function createGoogleCalendarProvider(
  repository: Repository,
  tx: Transaction,
  clock: Clock,
): CalendarProvider {
  const http = repository.http;
  async function connection(businessId: string) {
    const g = await repository.active(tx, businessId);
    if (!g || !http) throw new GoogleCalendarFailure("insufficient");
    return g;
  }
  async function withGrant<T>(
    scope: { businessId: string; connectionId?: string; calendarId?: string },
    signal: AbortSignal,
    operation: (token: string, calendarTimeZone: string) => Promise<T>,
  ): Promise<T> {
    const g = await connection(scope.businessId);
    try {
      if (
        (scope.connectionId && g.id !== scope.connectionId) ||
        (scope.calendarId && g.selectedCalendarId !== scope.calendarId)
      )
        throw new GoogleCalendarFailure("insufficient");
      const token = await repository.accessToken(tx, g);
      const calendars = await http!.calendars(token, signal);
      const selected = calendars.find(
        (c) => c.id === (scope.calendarId ?? g.selectedCalendarId),
      );
      if (!selected) throw new GoogleCalendarFailure("insufficient");
      return await operation(token, selected.timeZone);
    } catch (error) {
      await repository.failure(tx, g, error);
      throw error;
    }
  }
  function checkScope(scope: CalendarScope) {
    if (
      scope.provider !== "google" ||
      scope.accountKind !== "google" ||
      scope.availabilityMode !== "free_busy"
    )
      throw new GoogleCalendarFailure("insufficient");
  }
  const path = (scope: { calendarId: string }) =>
    `calendars/${encodeURIComponent(scope.calendarId)}/events`;
  function mapEvent(
    intent: BookingIntent,
    raw: unknown,
    knownIdentity = false,
  ): CalendarEvent {
    const e = parse(nativeEvent, raw);
    if (e.id !== eventId(intent))
      throw new GoogleCalendarFailure("invalid_response");
    if (e.status === "cancelled" && knownIdentity)
      return {
        ...intent,
        eventId: e.id,
        revision: e.etag ?? "google-cancelled-tombstone",
        status: "cancelled",
        observedAt: clock.now().toISOString(),
      };
    const metadata = e.extendedProperties?.private;
    if (
      !metadata ||
      !Object.entries(provenance(intent)).every(
        ([key, value]) => metadata[key] === value,
      ) ||
      !e.etag ||
      !e.start?.dateTime ||
      !e.end?.dateTime ||
      e.status !== "confirmed"
    )
      throw new GoogleCalendarFailure("invalid_response");
    return {
      ...parse(bookingIntentSchema.strip(), intent),
      startsAt: e.start.dateTime,
      endsAt: e.end.dateTime,
      eventId: e.id,
      revision: e.etag,
      status: "active",
      observedAt: clock.now().toISOString(),
    };
  }
  async function conflicts(
    intent: BookingIntent,
    token: string,
    blockedStart: string,
    blockedEnd: string,
    calendarTimeZone: string,
    signal: AbortSignal,
  ) {
    let page: string | undefined;
    for (let i = 0; i < 10; i++) {
      const query = new URLSearchParams({
        timeMin: blockedStart,
        timeMax: blockedEnd,
        singleEvents: "true",
        showDeleted: "false",
        maxResults: "2500",
      });
      if (page) query.set("pageToken", page);
      const result = parse(
        z.object({
          items: z.array(nativeEvent).max(2500),
          nextPageToken: z.string().max(4096).optional(),
        }),
        await http!.api(`${path(intent)}?${query}`, token, {}, signal),
      );
      for (const e of result.items) {
        if (
          e.id === eventId(intent) ||
          e.status === "cancelled" ||
          e.transparency === "transparent"
        )
          continue;
        const date = (v: typeof e.start) => {
          if (v?.dateTime) return new Date(v.dateTime).getTime();
          if (v?.date)
            return Temporal.PlainDate.from(v.date).toZonedDateTime(
              calendarTimeZone,
            ).epochMilliseconds;
          throw new GoogleCalendarFailure("invalid_response");
        };
        const start = date(e.start),
          end = date(e.end);
        if (start >= end) throw new GoogleCalendarFailure("invalid_response");
        if (
          start < new Date(blockedEnd).getTime() &&
          end > new Date(blockedStart).getTime()
        )
          return true;
      }
      page = result.nextPageToken;
      if (!page) return false;
    }
    throw new GoogleCalendarFailure("invalid_response");
  }
  return {
    available: Boolean(http),
    async listCalendars({ businessId }, signal) {
      const g = await repository.active(tx, businessId);
      if (
        !g ||
        !g.selectedCalendarId ||
        !["ready", "selection_required"].includes(g.status)
      )
        return [];
      return withGrant(
        { businessId, connectionId: g.id, calendarId: g.selectedCalendarId },
        signal,
        async (token) => {
          const choices = await http!.calendars(token, signal);
          return choices
            .filter((c) => c.id === g.selectedCalendarId)
            .map((c) => ({
              businessId,
              connectionId: g.id,
              calendarId: c.id,
              label: c.label,
              provider: "google",
              accountKind: "google",
              availabilityMode: "free_busy",
              grant: "granted",
              canRead: true,
              canWrite: true,
            }));
        },
      );
    },
    async availability(scope, signal) {
      checkScope(scope);
      return withGrant(scope, signal, async (token) => {
        const result = parse(
          z.object({
            timeMin: instant,
            timeMax: instant,
            calendars: z.record(
              z.string(),
              z.object({
                busy: z
                  .array(z.object({ start: instant, end: instant }))
                  .max(10000)
                  .optional(),
                errors: z
                  .array(
                    z.object({
                      reason: z.string(),
                      domain: z.string().optional(),
                    }),
                  )
                  .optional(),
              }),
            ),
          }),
          await http!.api(
            "freeBusy",
            token,
            {
              method: "POST",
              body: JSON.stringify({
                timeMin: scope.startsAt,
                timeMax: scope.endsAt,
                timeZone: "UTC",
                calendarExpansionMax: 1,
                items: [{ id: scope.calendarId }],
              }),
            },
            signal,
          ),
        );
        const calendar = result.calendars[scope.calendarId];
        if (
          !calendar ||
          new Date(result.timeMin).getTime() !==
            new Date(scope.startsAt).getTime() ||
          new Date(result.timeMax).getTime() !==
            new Date(scope.endsAt).getTime()
        )
          throw new GoogleCalendarFailure("invalid_response");
        if (calendar.errors?.length)
          throw new GoogleCalendarFailure(
            calendar.errors.some(
              (e) => e.reason === "notFound" || e.reason === "forbidden",
            )
              ? "insufficient"
              : "unavailable",
          );
        if (
          !calendar.busy ||
          calendar.busy.some((b) => new Date(b.start) >= new Date(b.end))
        )
          throw new GoogleCalendarFailure("invalid_response");
        return {
          ...scope,
          checkedAt: clock.now().toISOString(),
          busy: calendar.busy.map((b) => ({
            startsAt: b.start,
            endsAt: b.end,
          })),
        };
      });
    },
    async create(intent, signal) {
      checkScope(intent);
      return withGrant(intent, signal, async (token) =>
        mapEvent(
          intent,
          await http!.api(
            `${path(intent)}?sendUpdates=none&conferenceDataVersion=0`,
            token,
            {
              method: "POST",
              body: JSON.stringify({
                id: eventId(intent),
                summary: "Appointment",
                status: "confirmed",
                transparency: "opaque",
                start: {
                  dateTime: intent.startsAt,
                  timeZone: intent.businessTimeZone,
                },
                end: {
                  dateTime: intent.endsAt,
                  timeZone: intent.businessTimeZone,
                },
                extendedProperties: { private: provenance(intent) },
                attendees: [],
                guestsCanInviteOthers: false,
                guestsCanModify: false,
                reminders: { useDefault: false, overrides: [] },
              }),
            },
            signal,
          ),
        ),
      );
    },
    async lookup(intent, signal) {
      checkScope(intent);
      if (intent.eventId && intent.eventId !== eventId(intent))
        throw new GoogleCalendarFailure("insufficient");
      return withGrant(intent, signal, async (token, calendarTimeZone) => {
        let raw: unknown;
        try {
          raw = await http!.api(
            `${path(intent)}/${eventId(intent)}`,
            token,
            {},
            signal,
          );
        } catch (error) {
          if (
            error instanceof GoogleCalendarFailure &&
            error.reason === "not_found"
          ) {
            const original = parse(bookingIntentSchema.strip(), intent);
            return {
              ...original,
              status: "absent",
              definitive: false,
              checkedAt: clock.now().toISOString(),
            };
          }
          throw error;
        }
        const { blockedStart, blockedEnd } = intent;
        const original = parse(bookingIntentSchema.strip(), intent);
        const event = mapEvent(original, raw, Boolean(intent.eventId));
        return {
          status: "found",
          event,
          conflicts:
            event.status === "active" &&
            (await conflicts(
              original,
              token,
              blockedStart,
              blockedEnd,
              calendarTimeZone,
              signal,
            )),
        };
      });
    },
    async cancel(intent, signal) {
      checkScope(intent);
      if (intent.eventId !== eventId(intent))
        throw new GoogleCalendarFailure("insufficient");
      return withGrant(intent, signal, async (token) => {
        const original = parse(bookingIntentSchema.strip(), intent);
        const raw = await http!.api(
          `${path(intent)}/${eventId(intent)}`,
          token,
          {},
          signal,
        );
        const event = mapEvent(original, raw, true);
        if (event.status === "cancelled") return event;
        const native = parse(nativeEvent, raw);
        if (
          native.attendees?.length ||
          event.revision !== intent.revision ||
          new Date(event.startsAt).getTime() !==
            new Date(intent.startsAt).getTime() ||
          new Date(event.endsAt).getTime() !== new Date(intent.endsAt).getTime()
        )
          throw new GoogleCalendarFailure("conflict");
        await http!.api(
          `${path(intent)}/${eventId(intent)}?sendUpdates=none`,
          token,
          { method: "DELETE", headers: { "If-Match": event.revision } },
          signal,
        );
        return {
          ...event,
          status: "cancelled",
          observedAt: clock.now().toISOString(),
        };
      });
    },
  };
}
