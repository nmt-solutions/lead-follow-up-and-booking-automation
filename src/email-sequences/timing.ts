import { Temporal } from "@js-temporal/polyfill";
import type { SequenceTiming } from "../models/email-sequences";

/** Delays are elapsed minimums from the actual acceptance. Windows use calendar days and IANA zones.
 * Compatible selects the first repeated wall time and advances a missing wall time by the DST gap. */
export function sequenceDue(timing: SequenceTiming, earliest: Date): Date {
  const local = Temporal.Instant.from(
    earliest.toISOString(),
  ).toZonedDateTimeISO(timing.timeZone);
  let day = local.toPlainDate();
  for (;;) {
    if (timing.weekdays.includes(day.dayOfWeek)) {
      const start = day
        .toPlainDateTime(timing.startTime)
        .toZonedDateTime(timing.timeZone, { disambiguation: timing.dst });
      const end = day
        .toPlainDateTime(timing.endTime)
        .toZonedDateTime(timing.timeZone, { disambiguation: timing.dst });
      const next = Math.max(start.epochMilliseconds, earliest.getTime());
      if (next < end.epochMilliseconds) return new Date(next);
    }
    day = day.add({ days: 1 });
  }
}
