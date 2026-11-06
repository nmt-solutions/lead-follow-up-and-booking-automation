import { z } from "zod";

export type GoogleCalendarConfiguration = {
  clientId: string;
  clientSecret: string;
  origin: string;
  activeKeyId: string;
  keys: Record<string, string>;
};
export function configuredGoogleCalendar(
  env: Readonly<Record<string, string | undefined>>,
): GoogleCalendarConfiguration | null {
  const parsed = z
    .object({
      GOOGLE_CALENDAR_CLIENT_ID: z.string().min(1),
      GOOGLE_CALENDAR_CLIENT_SECRET: z.string().min(1),
      GOOGLE_CALENDAR_APPROVED: z.literal("true"),
      GOOGLE_CALENDAR_TOKEN_KEY_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
      GOOGLE_CALENDAR_TOKEN_KEYS: z.string(),
      BETTER_AUTH_URL: z.url(),
    })
    .safeParse(env);
  if (!parsed.success) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.GOOGLE_CALENDAR_TOKEN_KEYS);
  } catch {
    return null;
  }
  const keys = z
    .record(
      z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
      z.string().regex(/^[a-f0-9]{64}$/),
    )
    .safeParse(raw);
  const origin = new URL(parsed.data.BETTER_AUTH_URL).origin;
  if (
    !keys.success ||
    !keys.data[parsed.data.GOOGLE_CALENDAR_TOKEN_KEY_ID] ||
    (!origin.startsWith("https://") &&
      !/^http:\/\/localhost(?::\d+)?$/.test(origin))
  )
    return null;
  return {
    clientId: parsed.data.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: parsed.data.GOOGLE_CALENDAR_CLIENT_SECRET,
    origin,
    activeKeyId: parsed.data.GOOGLE_CALENDAR_TOKEN_KEY_ID,
    keys: keys.data,
  };
}
