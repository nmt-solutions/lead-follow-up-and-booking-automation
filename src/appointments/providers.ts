import { CalendarProviderFailure } from "./provider";
import type { CalendarProvider, CalendarScope } from "../models/appointments";

/** Dispatch by the persisted provider discriminator, never by email or current UI selection. */
export function combineCalendarProviders(
  google: CalendarProvider,
  microsoft: CalendarProvider,
): CalendarProvider {
  const forScope = (scope: Pick<CalendarScope, "provider">) =>
    scope.provider === "microsoft" ? microsoft : google;
  return {
    available: google.available || microsoft.available,
    async listCalendars(scope, signal) {
      if (scope.provider)
        return forScope({ provider: scope.provider }).listCalendars(
          scope,
          signal,
        );
      async function catalog(provider: CalendarProvider) {
        if (!provider.available) return [];
        try {
          const rows = await provider.listCalendars(scope, signal);
          if (!Array.isArray(rows))
            throw new CalendarProviderFailure("invalid_response");
          return rows;
        } catch (error) {
          // A failing unselected grant must not hide a healthy provider. Selected
          // readiness calls above still propagate its classified recovery reason.
          if (error instanceof CalendarProviderFailure) return [];
          throw error;
        }
      }
      return [...(await catalog(google)), ...(await catalog(microsoft))];
    },
    availability: (scope, signal) =>
      forScope(scope).availability(scope, signal),
    create: (scope, signal) => forScope(scope).create(scope, signal),
    lookup: (scope, signal) => forScope(scope).lookup(scope, signal),
    cancel: (scope, signal) => forScope(scope).cancel(scope, signal),
  };
}
