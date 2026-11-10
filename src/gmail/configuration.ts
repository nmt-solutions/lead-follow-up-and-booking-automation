import {
  configuredGoogleCalendar,
  type GoogleCalendarConfiguration,
} from "../google-calendar/configuration";

export type GmailConfiguration = GoogleCalendarConfiguration;
/** Distinct approval and credential settings: calendar setup never activates mail. */
export function configuredGmail(
  env: Readonly<Record<string, string | undefined>>,
): GmailConfiguration | null {
  if (env.GMAIL_PRODUCTION_PREREQUISITES_CONFIRMED !== "true") return null;
  const configuration = configuredGoogleCalendar({
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    GOOGLE_CALENDAR_APPROVED: env.GMAIL_OAUTH_APPROVED,
    GOOGLE_CALENDAR_CLIENT_ID: env.GMAIL_CLIENT_ID,
    GOOGLE_CALENDAR_CLIENT_SECRET: env.GMAIL_CLIENT_SECRET,
    GOOGLE_CALENDAR_TOKEN_KEY_ID: env.GMAIL_TOKEN_KEY_ID,
    GOOGLE_CALENDAR_TOKEN_KEYS: env.GMAIL_TOKEN_KEYS,
  });
  return configuration
    ? {
        ...configuration,
        ...(env.GMAIL_FIXED_CALLBACK_ENABLED === "true"
          ? { redirectPath: "/api/connections/gmail/callback" }
          : {}),
      }
    : null;
}
