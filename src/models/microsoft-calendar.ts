import { z } from "zod";

export const microsoftCalendarScopes = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
] as const;
export const microsoftConsumerTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const microsoftIdentitySchema = z.object({
  subject: z.string().min(1).max(256),
  tenantId: z.uuid(),
  accountKind: z.enum(["microsoft_work", "microsoft_personal"]),
  email: z.email().max(254),
});
export type MicrosoftIdentity = z.infer<typeof microsoftIdentitySchema>;
export const microsoftCalendarChoiceSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().min(1).max(200),
  accessRole: z.literal("owner"),
  primary: z.boolean(),
});
export type MicrosoftCalendarChoice = z.infer<
  typeof microsoftCalendarChoiceSchema
>;
export const microsoftCalendarStatusSchema = z.enum([
  "not_connected",
  "connecting",
  "selection_required",
  "ready",
  "reconnect_required",
  "insufficient",
  "disconnected",
]);
export type MicrosoftCalendarStatus = z.infer<
  typeof microsoftCalendarStatusSchema
>;
export const microsoftCalendarViewSchema = z.object({
  configured: z.boolean(),
  setupReason: z.string().nullable(),
  status: microsoftCalendarStatusSchema,
  reason: z.string().nullable(),
  connectionId: z.uuid().nullable(),
  accountEmail: z.string().nullable(),
  accountKind: microsoftIdentitySchema.shape.accountKind.nullable(),
  tenantId: z.string().nullable(),
  selectedCalendarId: z.string().nullable(),
  calendars: z.array(microsoftCalendarChoiceSchema),
  grantedScopes: z.array(z.string()),
  authorizedAt: z.string().nullable(),
});
export type MicrosoftCalendarView = z.infer<typeof microsoftCalendarViewSchema>;
