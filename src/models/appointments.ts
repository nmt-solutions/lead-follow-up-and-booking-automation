import { z } from "zod";
import { timingSchema } from "./discovery-timing";

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v));
export const timeZoneSchema = timingSchema.shape.timeZone;
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const instant = z.iso.datetime({ offset: true });
export const calendarBindingSchema = z.strictObject({
  connectionId: z.uuid(),
  calendarId: text(256),
});
export const calendarDescriptorSchema = calendarBindingSchema
  .extend({
    businessId: z.uuid(),
    label: text(200),
    provider: z.enum(["google", "microsoft"]),
    accountKind: z.enum(["google", "microsoft_work", "microsoft_personal"]),
    availabilityMode: z.enum(["free_busy", "calendar_view"]),
    grant: z.enum(["granted", "missing", "revoked", "insufficient"]),
    canRead: z.boolean(),
    canWrite: z.boolean(),
  })
  .superRefine((v, c) => {
    if (
      (v.provider === "google") !== (v.accountKind === "google") ||
      v.availabilityMode !==
        (v.accountKind === "microsoft_personal" ? "calendar_view" : "free_busy")
    )
      c.addIssue({
        code: "custom",
        message: "Unsupported calendar capability combination",
      });
  });
export type CalendarDescriptor = z.infer<typeof calendarDescriptorSchema>;
export const bookingConfigurationSchema = z
  .strictObject({
    timeZone: timeZoneSchema,
    hours: z
      .array(
        z.strictObject({
          weekday: z.number().int().min(1).max(7),
          start: wallTime,
          end: wallTime,
        }),
      )
      .min(1)
      .max(28),
    durationMinutes: z.number().int().min(1).max(1440),
    bufferBeforeMinutes: z.number().int().min(0).max(1440),
    bufferAfterMinutes: z.number().int().min(0).max(1440),
    slotStepMinutes: z.number().int().min(1).max(1440),
    holdSeconds: z.number().int().min(1).max(86400),
    automationEnabled: z.boolean(),
    calendar: calendarBindingSchema.nullable(),
  })
  .superRefine((v, c) => {
    for (const [i, h] of v.hours.entries()) {
      if (
        h.start >= h.end ||
        v.hours.some(
          (o, j) =>
            j !== i &&
            o.weekday === h.weekday &&
            h.start < o.end &&
            o.start < h.end,
        )
      )
        c.addIssue({
          code: "custom",
          path: ["hours", i],
          message: "Use non-overlapping hours within one local day",
        });
    }
  });
export type BookingConfiguration = z.infer<typeof bookingConfigurationSchema>;
export const configureBookingSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646),
  configuration: bookingConfigurationSchema,
  note: text(1000),
});
export type ConfigureBooking = z.infer<typeof configureBookingSchema>;
export const availabilityQuerySchema = z.strictObject({
  day: z.iso.date(),
  customerTimeZone: timeZoneSchema,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export const appointmentRequestSchema = z.strictObject({
  requestKey: z.uuid(),
  expectedVersion: z.number().int().positive(),
  mode: z.enum(["manual", "automation"]),
  customerTimeZone: timeZoneSchema,
  localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/),
  utcOffset: z
    .string()
    .regex(/^[+-]([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});
export type AppointmentRequest = z.infer<typeof appointmentRequestSchema>;
export const appointmentRefSchema = z.strictObject({ appointmentId: z.uuid() });
export const appointmentEvidenceSchema = appointmentRefSchema.extend({
  requestKey: z.uuid(),
  kind: z.enum(["attended", "cancelled"]),
  reference: text(256),
  occurredAt: instant,
  note: text(2000),
});
export type AppointmentEvidence = z.infer<typeof appointmentEvidenceSchema>;
export const calendarScopeSchema = z.strictObject({
  businessId: z.uuid(),
  opportunityId: z.uuid(),
  connectionId: z.uuid(),
  calendarId: text(256),
  provider: z.enum(["google", "microsoft"]),
  accountKind: calendarDescriptorSchema.shape.accountKind,
  availabilityMode: z.enum(["free_busy", "calendar_view"]),
});
export type CalendarScope = z.infer<typeof calendarScopeSchema>;
export const bookingIntentSchema = calendarScopeSchema.extend({
  appointmentId: z.uuid(),
  intentKey: z.string().regex(/^[a-f0-9]{64}$/),
  startsAt: instant,
  endsAt: instant,
  businessTimeZone: timeZoneSchema,
  customerTimeZone: timeZoneSchema,
});
export type BookingIntent = z.infer<typeof bookingIntentSchema>;
export const calendarEventSchema = bookingIntentSchema
  .extend({
    eventId: text(256),
    revision: text(256),
    status: z.enum(["active", "cancelled"]),
    observedAt: instant,
  })
  .refine((e) => new Date(e.startsAt) < new Date(e.endsAt));
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export const availabilityReceiptSchema = calendarScopeSchema.extend({
  startsAt: instant,
  endsAt: instant,
  checkedAt: instant,
  busy: z
    .array(
      z
        .strictObject({ startsAt: instant, endsAt: instant })
        .refine((v) => new Date(v.startsAt) < new Date(v.endsAt)),
    )
    .max(10000),
});
export const calendarLookupSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("found"),
    event: calendarEventSchema,
    conflicts: z.boolean(),
  }),
  bookingIntentSchema.extend({
    status: z.literal("absent"),
    definitive: z.boolean(),
    checkedAt: instant,
  }),
]);
/** Trusted adapter contract. Calendar grants are independent of mailbox permissions.
 * No adapter retries mutations. Identity/intent lookup is read-only, including after
 * a timeout or lost DB commit. Native APIs cannot promise an atomic external free/busy lock.
 * Adapters must bind intent metadata to the event, suppress invites/notifications here,
 * validate native responses, and support stable idempotency or refuse creation.
 */
export type CalendarProvider = {
  available: boolean;
  listCalendars(
    scope: { businessId: string; provider?: "google" | "microsoft" },
    signal: AbortSignal,
  ): Promise<unknown>;
  availability(
    scope: CalendarScope & { startsAt: string; endsAt: string },
    signal: AbortSignal,
  ): Promise<unknown>;
  create(intent: BookingIntent, signal: AbortSignal): Promise<unknown>;
  lookup(
    intent: BookingIntent & {
      eventId: string | null;
      blockedStart: string;
      blockedEnd: string;
    },
    signal: AbortSignal,
  ): Promise<unknown>;
  cancel(
    intent: BookingIntent & { eventId: string; revision: string },
    signal: AbortSignal,
  ): Promise<unknown>;
};
export const candidateSlotSchema = z.object({
  startsAt: instant,
  endsAt: instant,
  localStart: z.string(),
  utcOffset: z.string(),
});
export type CandidateSlot = z.infer<typeof candidateSlotSchema>;
export const availabilityViewSchema = z.object({
  version: z.number().int(),
  reason: z.string().nullable(),
  slots: z.array(candidateSlotSchema),
});
export type AvailabilityView = z.infer<typeof availabilityViewSchema>;
export const appointmentStatusSchema = z.enum([
  "requested",
  "confirmed",
  "attended",
  "cancelled",
]);
export const appointmentPhaseSchema = z.enum([
  "held",
  "expired",
  "blocked",
  "committed",
  "ambiguous",
  "booked",
  "conflict",
  "failed",
  "cancel_committed",
  "cancel_ambiguous",
  "finished",
]);
export const bookingPolicyViewSchema = z.object({
  version: z.number().int(),
  configuration: bookingConfigurationSchema,
  calendar: calendarDescriptorSchema.nullable(),
  note: z.string(),
  at: instant,
});
export const appointmentHistorySchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  actorId: z.string(),
  source: z.enum(["application", "provider", "business"]),
  reference: z.string().nullable(),
  note: z.string(),
  occurredAt: instant,
  at: instant,
});
export const appointmentViewSchema = z.object({
  id: z.uuid(),
  intent: bookingIntentSchema,
  status: appointmentStatusSchema,
  phase: appointmentPhaseSchema,
  holdExpiresAt: instant,
  event: calendarEventSchema.nullable(),
  reason: z.string().nullable(),
  nextAction: z.string(),
  ownerId: z.string().nullable(),
  customerNotified: z.literal(false),
  history: z.array(appointmentHistorySchema),
});
export type AppointmentView = z.infer<typeof appointmentViewSchema>;
export const appointmentWorkspaceSchema = z.object({
  policy: bookingPolicyViewSchema.nullable(),
  policyHistory: z.array(bookingPolicyViewSchema),
  calendars: z.array(calendarDescriptorSchema),
  canManage: z.boolean(),
  canAct: z.boolean(),
  ownerId: z.string().nullable(),
  controlState: z.enum(["human", "automation"]),
  providerAvailable: z.boolean(),
  setupReason: z.string().nullable(),
  appointments: z.array(appointmentViewSchema),
});
export type AppointmentWorkspace = z.infer<typeof appointmentWorkspaceSchema>;
