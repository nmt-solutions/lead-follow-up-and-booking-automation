import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import type { Transaction } from "../db/scope";
import type { createMicrosoftCalendarRepository } from "../db/microsoft-calendar-repository";
import type { Clock } from "../models/business";
import {
  bookingIntentSchema,
  type BookingIntent,
  type CalendarEvent,
  type CalendarProvider,
} from "../models/appointments";
import { MicrosoftCalendarFailure, parseMicrosoft as parse } from "./http";

// Named MAPI properties support documented event collection filtering; transactionId is only creation deduplication, never a lookup API.
export const microsoftProvenanceProperty =
  "String {3729e20d-f04d-4da6-9d0c-cdcb72eff630} Name BookingScope";
const dateTime = z.object({
  dateTime: z.string().min(1).max(80),
  timeZone: z.string(),
});
const nativeEvent = z.object({
  id: z.string().min(1).max(256),
  "@odata.etag": z.string().min(1).max(256).optional(),
  transactionId: z.string().optional(),
  isCancelled: z.boolean(),
  start: dateTime,
  end: dateTime,
  showAs: z.enum([
    "free",
    "tentative",
    "busy",
    "oof",
    "workingElsewhere",
    "unknown",
  ]),
  type: z.enum(["singleInstance", "occurrence", "exception", "seriesMaster"]),
  attendees: z.array(z.unknown()).optional(),
  singleValueExtendedProperties: z
    .array(z.object({ id: z.string(), value: z.string() }))
    .optional(),
});
function instant(value: z.infer<typeof dateTime>) {
  // Every read explicitly requests UTC. Refuse an unrecognized server time zone rather than guessing Windows/IANA conversions.
  if (!["UTC", "Etc/UTC"].includes(value.timeZone))
    throw new MicrosoftCalendarFailure("invalid_response");
  try {
    return Temporal.Instant.from(
      value.dateTime.replace(/(\.\d{3})\d+/, "$1") +
        (/[zZ]|[+-]\d\d:\d\d$/.test(value.dateTime) ? "" : "Z"),
    ).toString();
  } catch {
    throw new MicrosoftCalendarFailure("invalid_response");
  }
}
const transactionId = (i: BookingIntent) =>
  `${i.intentKey.slice(0, 8)}-${i.intentKey.slice(8, 12)}-${i.intentKey.slice(12, 16)}-${i.intentKey.slice(16, 20)}-${i.intentKey.slice(20, 32)}`;
function provenance(i: BookingIntent) {
  return JSON.stringify({
    businessId: i.businessId,
    connectionId: i.connectionId,
    calendarId: i.calendarId,
    opportunityId: i.opportunityId,
    appointmentId: i.appointmentId,
    intentKey: i.intentKey,
  });
}
const path = (i: { calendarId: string }) =>
  `me/calendars/${encodeURIComponent(i.calendarId)}`;
const expand = `singleValueExtendedProperties($filter=id eq '${microsoftProvenanceProperty}')`;
function query(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

export function createMicrosoftCalendarProvider(
  repository: ReturnType<typeof createMicrosoftCalendarRepository>,
  tx: Transaction,
  clock: Clock,
): CalendarProvider {
  const http = repository.http;
  async function withGrant<T>(
    scope: {
      businessId: string;
      connectionId?: string;
      calendarId?: string;
      accountKind?: string;
      availabilityMode?: string;
      provider?: string;
    },
    signal: AbortSignal,
    operation: (token: string, email: string) => Promise<T>,
  ): Promise<T> {
    const g = await repository.active(tx, scope.businessId);
    if (!g || !http) throw new MicrosoftCalendarFailure("insufficient");
    try {
      if (
        (scope.connectionId && scope.connectionId !== g.id) ||
        (scope.calendarId && scope.calendarId !== g.selectedCalendarId) ||
        (scope.accountKind && scope.accountKind !== g.accountKind) ||
        (scope.provider && scope.provider !== "microsoft") ||
        (scope.availabilityMode &&
          scope.availabilityMode !==
            (g.accountKind === "microsoft_personal"
              ? "calendar_view"
              : "free_busy"))
      )
        throw new MicrosoftCalendarFailure("insufficient");
      const token = await repository.accessToken(tx, g);
      const account = repository.identity(g);
      const choices = await http.calendars(token, account, signal);
      if (!choices.some((c) => c.id === g.selectedCalendarId))
        throw new MicrosoftCalendarFailure("insufficient");
      return await operation(token, account.email);
    } catch (error) {
      await repository.failure(tx, g, error);
      throw error;
    }
  }
  async function view(
    scope: { calendarId: string; startsAt: string; endsAt: string },
    token: string,
    signal: AbortSignal,
  ) {
    return http!.collection(
      `${path(scope)}/calendarView?${query({ startDateTime: scope.startsAt, endDateTime: scope.endsAt, $top: "1000" })}`,
      token,
      nativeEvent,
      signal,
    );
  }
  function busy(
    events: z.infer<typeof nativeEvent>[],
    start: string,
    end: string,
    exclude?: string,
  ) {
    return events.flatMap((e) => {
      if (e.type === "seriesMaster")
        throw new MicrosoftCalendarFailure("invalid_response");
      const startsAt = instant(e.start),
        endsAt = instant(e.end);
      if (new Date(startsAt) >= new Date(endsAt))
        throw new MicrosoftCalendarFailure("invalid_response");
      return e.id !== exclude &&
        !e.isCancelled &&
        e.showAs !== "free" &&
        new Date(startsAt) < new Date(end) &&
        new Date(endsAt) > new Date(start)
        ? [{ startsAt, endsAt }]
        : [];
    });
  }
  function mapEvent(intent: BookingIntent, raw: unknown): CalendarEvent {
    const e = parse(nativeEvent, raw);
    const properties = e.singleValueExtendedProperties ?? [];
    if (
      e.type !== "singleInstance" ||
      !e["@odata.etag"] ||
      e.transactionId !== transactionId(intent) ||
      properties.filter(
        (p) =>
          p.id === microsoftProvenanceProperty &&
          p.value === provenance(intent),
      ).length !== 1
    )
      throw new MicrosoftCalendarFailure("invalid_response");
    return {
      ...parse(bookingIntentSchema.strip(), intent),
      startsAt: instant(e.start),
      endsAt: instant(e.end),
      eventId: e.id,
      revision: e["@odata.etag"],
      status: e.isCancelled ? "cancelled" : "active",
      observedAt: clock.now().toISOString(),
    };
  }
  async function matches(
    intent: BookingIntent,
    token: string,
    signal: AbortSignal,
  ) {
    const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${microsoftProvenanceProperty}' and ep/value eq '${provenance(intent).replaceAll("'", "''")}')`;
    return http!.collection(
      `${path(intent)}/events?${query({ $filter: filter, $expand: expand, $top: "100" })}`,
      token,
      nativeEvent,
      signal,
    );
  }
  return {
    available: Boolean(http),
    async listCalendars({ businessId }, signal) {
      const g = await repository.active(tx, businessId);
      if (
        !g?.selectedCalendarId ||
        !["ready", "selection_required"].includes(g.status)
      )
        return [];
      return withGrant(
        { businessId, connectionId: g.id, calendarId: g.selectedCalendarId },
        signal,
        async () => [
          {
            businessId,
            connectionId: g.id,
            calendarId: g.selectedCalendarId!,
            label: "Microsoft booking calendar",
            provider: "microsoft",
            accountKind: g.accountKind!,
            availabilityMode:
              g.accountKind === "microsoft_personal"
                ? "calendar_view"
                : "free_busy",
            grant: "granted",
            canRead: true,
            canWrite: true,
          },
        ],
      );
    },
    async availability(scope, signal) {
      return withGrant(scope, signal, async (token, email) => {
        let periods: { startsAt: string; endsAt: string }[];
        if (scope.accountKind === "microsoft_personal") {
          periods = busy(
            await view(scope, token, signal),
            scope.startsAt,
            scope.endsAt,
          );
        } else {
          const result = parse(
            z.object({
              value: z
                .array(
                  z.object({
                    scheduleId: z.string(),
                    error: z.unknown().optional(),
                    scheduleItems: z
                      .array(
                        z.object({
                          status: z.enum([
                            "free",
                            "tentative",
                            "busy",
                            "oof",
                            "workingElsewhere",
                            "unknown",
                          ]),
                          start: dateTime,
                          end: dateTime,
                        }),
                      )
                      .max(10000),
                  }),
                )
                .length(1),
            }),
            await http!.api(
              "me/calendar/getSchedule",
              token,
              {
                method: "POST",
                body: JSON.stringify({
                  schedules: [email],
                  startTime: {
                    dateTime: new Date(scope.startsAt)
                      .toISOString()
                      .replace(/Z$/, ""),
                    timeZone: "UTC",
                  },
                  endTime: {
                    dateTime: new Date(scope.endsAt)
                      .toISOString()
                      .replace(/Z$/, ""),
                    timeZone: "UTC",
                  },
                  availabilityViewInterval: 5,
                }),
              },
              signal,
            ),
          );
          const schedule = result.value[0];
          if (
            schedule.error ||
            schedule.scheduleId.toLowerCase() !== email.toLowerCase()
          )
            throw new MicrosoftCalendarFailure("insufficient");
          periods = schedule.scheduleItems.flatMap((item) => {
            const startsAt = instant(item.start),
              endsAt = instant(item.end);
            if (new Date(startsAt) >= new Date(endsAt))
              throw new MicrosoftCalendarFailure("invalid_response");
            return item.status === "free" ? [] : [{ startsAt, endsAt }];
          });
        }
        return {
          ...scope,
          checkedAt: clock.now().toISOString(),
          busy: periods,
        };
      });
    },
    async create(intent, signal) {
      return withGrant(intent, signal, async (token) => {
        const created = parse(
          z.object({ id: z.string().min(1).max(256) }),
          await http!.api(
            `${path(intent)}/events`,
            token,
            {
              method: "POST",
              body: JSON.stringify({
                subject: "Appointment",
                transactionId: transactionId(intent),
                start: {
                  dateTime: new Date(intent.startsAt)
                    .toISOString()
                    .replace(/Z$/, ""),
                  timeZone: "UTC",
                },
                end: {
                  dateTime: new Date(intent.endsAt)
                    .toISOString()
                    .replace(/Z$/, ""),
                  timeZone: "UTC",
                },
                showAs: "busy",
                attendees: [],
                isReminderOn: false,
                isOnlineMeeting: false,
                allowNewTimeProposals: false,
                singleValueExtendedProperties: [
                  {
                    id: microsoftProvenanceProperty,
                    value: provenance(intent),
                  },
                ],
              }),
            },
            signal,
          ),
        );
        return mapEvent(
          intent,
          await http!.api(
            `${path(intent)}/events/${encodeURIComponent(created.id)}?${query({ $expand: expand })}`,
            token,
            {},
            signal,
          ),
        );
      });
    },
    async lookup(intent, signal) {
      return withGrant(intent, signal, async (token) => {
        const events = await matches(intent, token, signal);
        if (events.length > 1) throw new MicrosoftCalendarFailure("conflict");
        const original = parse(bookingIntentSchema.strip(), intent);
        if (!events.length)
          return {
            ...original,
            status: "absent",
            definitive: false,
            checkedAt: clock.now().toISOString(),
          };
        const e = events[0];
        if (intent.eventId && e.id !== intent.eventId)
          throw new MicrosoftCalendarFailure("conflict");
        // Read through the selected calendar path even when the property search returns a mailbox-wide match.
        const raw = await http!.api(
          `${path(intent)}/events/${encodeURIComponent(e.id)}?${query({ $expand: expand })}`,
          token,
          {},
          signal,
        );
        const event = mapEvent(original, raw);
        if (event.eventId !== e.id)
          throw new MicrosoftCalendarFailure("invalid_response");
        return {
          status: "found",
          event,
          conflicts:
            event.status === "active" &&
            busy(
              await view(
                {
                  calendarId: intent.calendarId,
                  startsAt: intent.blockedStart,
                  endsAt: intent.blockedEnd,
                },
                token,
                signal,
              ),
              intent.blockedStart,
              intent.blockedEnd,
              event.eventId,
            ).length > 0,
        };
      });
    },
    async cancel(intent, signal) {
      return withGrant(intent, signal, async (token) => {
        const url = `${path(intent)}/events/${encodeURIComponent(intent.eventId)}`;
        const raw = await http!.api(
          `${url}?${query({ $expand: expand })}`,
          token,
          {},
          signal,
        );
        const native = parse(nativeEvent, raw),
          event = mapEvent(intent, raw);
        if (
          event.eventId !== intent.eventId ||
          !native.attendees ||
          native.attendees.length ||
          event.revision !== intent.revision ||
          new Date(event.startsAt).getTime() !==
            new Date(intent.startsAt).getTime() ||
          new Date(event.endsAt).getTime() !== new Date(intent.endsAt).getTime()
        )
          throw new MicrosoftCalendarFailure("conflict");
        if (event.status !== "cancelled")
          await http!.api(
            url,
            token,
            { method: "DELETE", headers: { "If-Match": intent.revision } },
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
