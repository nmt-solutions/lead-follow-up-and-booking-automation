import { z } from "zod";
import { timeZoneSchema } from "./appointments";

export const googleCalendarScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
] as const;
export const googleCalendarChoiceSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().min(1).max(200),
  timeZone: timeZoneSchema,
  accessRole: z.enum(["owner", "writer"]),
});
export type GoogleCalendarChoice = z.infer<typeof googleCalendarChoiceSchema>;
export const googleCalendarStatusSchema = z.enum([
  "not_connected",
  "connecting",
  "selection_required",
  "ready",
  "reconnect_required",
  "insufficient",
  "revocation_pending",
  "disconnected",
]);
export type GoogleCalendarStatus = z.infer<typeof googleCalendarStatusSchema>;
export const googleCalendarViewSchema = z.object({
  configured: z.boolean(),
  setupReason: z.string().nullable(),
  status: googleCalendarStatusSchema,
  reason: z.string().nullable(),
  connectionId: z.uuid().nullable(),
  accountEmail: z.string().nullable(),
  selectedCalendarId: z.string().nullable(),
  calendars: z.array(googleCalendarChoiceSchema),
  grantedScopes: z.array(z.string()),
  authorizedAt: z.string().nullable(),
});
export type GoogleCalendarView = z.infer<typeof googleCalendarViewSchema>;
