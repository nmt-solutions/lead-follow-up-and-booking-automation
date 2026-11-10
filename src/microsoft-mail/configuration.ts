import {
  configuredMicrosoftCalendar,
  type MicrosoftCalendarConfiguration,
} from "../microsoft-calendar/configuration";
export type MicrosoftMailConfiguration = MicrosoftCalendarConfiguration;
/** Mail approval, keys and app registration are independent of calendar and login. Global cloud only. */
export function configuredMicrosoftMail(
  env: Readonly<Record<string, string | undefined>>,
): MicrosoftMailConfiguration | null {
  if (env.MICROSOFT_MAIL_PRODUCTION_PREREQUISITES_CONFIRMED !== "true")
    return null;
  if (env.MICROSOFT_MAIL_CLOUD && env.MICROSOFT_MAIL_CLOUD !== "global")
    return null;
  const configuration = configuredMicrosoftCalendar({
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    MICROSOFT_CALENDAR_APPROVED: env.MICROSOFT_MAIL_OAUTH_APPROVED,
    MICROSOFT_CALENDAR_CLIENT_ID: env.MICROSOFT_MAIL_CLIENT_ID,
    MICROSOFT_CALENDAR_CLIENT_SECRET: env.MICROSOFT_MAIL_CLIENT_SECRET,
    MICROSOFT_CALENDAR_TOKEN_KEY_ID: env.MICROSOFT_MAIL_TOKEN_KEY_ID,
    MICROSOFT_CALENDAR_TOKEN_KEYS: env.MICROSOFT_MAIL_TOKEN_KEYS,
  });
  return configuration
    ? {
        ...configuration,
        ...(env.MICROSOFT_MAIL_FIXED_CALLBACK_ENABLED === "true"
          ? { redirectPath: "/api/connections/microsoft/callback" }
          : {}),
      }
    : null;
}
