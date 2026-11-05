import { Temporal } from "@js-temporal/polyfill";
import { ApplicationError } from "../models/application-error";
import type {
  AppointmentRequest,
  AvailabilityQuery,
  BookingConfiguration,
  CandidateSlot,
} from "../models/appointments";

export function requestedInstant(input: AppointmentRequest) {
  try {
    return Temporal.ZonedDateTime.from(
      `${input.localStart}${input.utcOffset ?? ""}[${input.customerTimeZone}]`,
      { disambiguation: "reject", offset: "reject" },
    )
      .toInstant()
      .toString();
  } catch {
    throw new ApplicationError("INVALID_INPUT");
  }
}
export function customerDay(input: AvailabilityQuery) {
  try {
    const day = Temporal.PlainDate.from(input.day);
    const start = day.toZonedDateTime(input.customerTimeZone);
    const end = day.add({ days: 1 }).toZonedDateTime(input.customerTimeZone);
    return { start, end };
  } catch {
    throw new ApplicationError("INVALID_INPUT");
  }
}
/** Reject gaps and repeated wall times. No silent compatible DST shift for appointments.
 * Slots are on the Business wall-time grid; duration/buffers use elapsed minutes.
 * Overnight hours must be entered as separate local-day windows.
 */
export function candidateSlots(
  config: BookingConfiguration,
  query: AvailabilityQuery,
  now: Date,
): CandidateSlot[] {
  const { start, end } = customerDay(query);
  let day = start.withTimeZone(config.timeZone).toPlainDate();
  const last = end.withTimeZone(config.timeZone).toPlainDate();
  const slots: CandidateSlot[] = [];
  while (Temporal.PlainDate.compare(day, last) <= 0) {
    for (const hours of config.hours.filter(
      (h) => h.weekday === day.dayOfWeek,
    )) {
      const open = day.toPlainDateTime(hours.start);
      const close = day.toPlainDateTime(hours.end);
      let wall = open.add({ minutes: config.bufferBeforeMinutes });
      while (Temporal.PlainDateTime.compare(wall, close) < 0) {
        try {
          const at = wall.toZonedDateTime(config.timeZone, {
            disambiguation: "reject",
          });
          const finish = at.add({ minutes: config.durationMinutes });
          const bufferedStart = at.subtract({
            minutes: config.bufferBeforeMinutes,
          });
          const bufferedEnd = finish.add({
            minutes: config.bufferAfterMinutes,
          });
          const windowStart = open.toZonedDateTime(config.timeZone, {
            disambiguation: "reject",
          });
          const windowEnd = close.toZonedDateTime(config.timeZone, {
            disambiguation: "reject",
          });
          if (
            at.epochMilliseconds >= start.epochMilliseconds &&
            at.epochMilliseconds < end.epochMilliseconds &&
            at.epochMilliseconds > now.getTime() &&
            bufferedStart.epochMilliseconds >= windowStart.epochMilliseconds &&
            bufferedEnd.epochMilliseconds <= windowEnd.epochMilliseconds
          ) {
            const local = at.withTimeZone(query.customerTimeZone);
            slots.push({
              startsAt: at.toInstant().toString(),
              endsAt: finish.toInstant().toString(),
              localStart: local
                .toPlainDateTime()
                .toString({ smallestUnit: "minute" }),
              utcOffset: local.offset,
            });
          }
        } catch {
          /* An invalid/ambiguous local boundary is deliberately not offered. */
        }
        wall = wall.add({ minutes: config.slotStepMinutes });
      }
    }
    day = day.add({ days: 1 });
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
export function buffered(
  config: BookingConfiguration,
  startsAt: string,
  endsAt: string,
) {
  return {
    start: new Date(
      new Date(startsAt).getTime() - config.bufferBeforeMinutes * 60000,
    ),
    end: new Date(
      new Date(endsAt).getTime() + config.bufferAfterMinutes * 60000,
    ),
  };
}
export function overlaps(
  a: { start: Date; end: Date },
  b: { start: Date; end: Date },
) {
  return a.start < b.end && b.start < a.end;
}
