import { z } from "zod";

export type MicrosoftCalendarConfiguration = {
  clientId: string;
  clientSecret: string;
  origin: string;
  redirectPath?: string;
  activeKeyId: string;
  keys: Record<string, string>;
};
export function configuredMicrosoftCalendar(
  env: Readonly<Record<string, string | undefined>>,
): MicrosoftCalendarConfiguration | null {
  const parsed = z
    .object({
      MICROSOFT_CALENDAR_CLIENT_ID: z.string().min(1),
      MICROSOFT_CALENDAR_CLIENT_SECRET: z.string().min(1),
      MICROSOFT_CALENDAR_APPROVED: z.literal("true"),
      MICROSOFT_CALENDAR_TOKEN_KEY_ID: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,40}$/),
      MICROSOFT_CALENDAR_TOKEN_KEYS: z.string(),
      BETTER_AUTH_URL: z.url(),
    })
    .safeParse(env);
  if (!parsed.success) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.MICROSOFT_CALENDAR_TOKEN_KEYS);
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
    !keys.data[parsed.data.MICROSOFT_CALENDAR_TOKEN_KEY_ID] ||
    (!origin.startsWith("https://") &&
      !/^http:\/\/localhost(?::\d+)?$/.test(origin))
  )
    return null;
  return {
    ...(env.MICROSOFT_CALENDAR_FIXED_CALLBACK_ENABLED === "true"
      ? { redirectPath: "/api/connections/microsoft-calendar/callback" }
      : {}),
    clientId: parsed.data.MICROSOFT_CALENDAR_CLIENT_ID,
    clientSecret: parsed.data.MICROSOFT_CALENDAR_CLIENT_SECRET,
    origin,
    activeKeyId: parsed.data.MICROSOFT_CALENDAR_TOKEN_KEY_ID,
    keys: keys.data,
  };
}
