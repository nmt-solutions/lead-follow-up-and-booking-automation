import { Temporal } from "@js-temporal/polyfill";
import type { Timing } from "../models/discovery-schedules";

// Calendar days, never 24-hour increments. Compatible selects the first repeated
// wall time and moves nonexistent wall times forward by the DST gap.
export function nextDiscoveryDue(timing: Timing, after: Date): Date {
  const local = Temporal.Instant.from(after.toISOString()).toZonedDateTimeISO(
    timing.timeZone,
  );
  let day = local.toPlainDate();
  for (;;) {
    if (timing.weekdays.includes(day.dayOfWeek)) {
      const due = day
        .toPlainDateTime(timing.localTime)
        .toZonedDateTime(timing.timeZone, { disambiguation: timing.dst });
      if (due.epochMilliseconds > after.getTime())
        return new Date(due.epochMilliseconds);
    }
    day = day.add({ days: 1 });
  }
}

export function sameDiscoveryDay(timeZone: string, left: Date, right: Date) {
  const day = (at: Date) =>
    Temporal.Instant.from(at.toISOString())
      .toZonedDateTimeISO(timeZone)
      .toPlainDate();
  return day(left).equals(day(right));
}
