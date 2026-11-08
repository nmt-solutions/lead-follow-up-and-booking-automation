import {
  reservePilotEffect,
  requirePilotPath,
  pilotEffectCurrent,
  pilotPathAllowed,
} from "./pilot-limits";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  appointment,
  appointmentHistory,
  bookingPolicy,
  inquiryRun,
  googleCalendarGrant,
  microsoftCalendarGrant,
} from "./schema";
import { inquiryContext, sameInquirySnapshot } from "./inquiry-context";
import { requireSalesSession } from "./opportunity-control-repository";
import { readCommercialPolicy } from "./commercial-authority-repository";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import {
  availabilityReceiptSchema,
  calendarEventSchema,
  calendarLookupSchema,
  type AppointmentEvidence,
  type CalendarEvent,
  type CalendarProvider,
  type ConfigureBooking,
  type AppointmentRequest,
  type BookingIntent,
  type AvailabilityQuery,
  type AvailabilityView,
  type AppointmentWorkspace,
  type CalendarScope,
} from "../models/appointments";
import {
  calendarCall,
  calendarCatalog,
  unavailableCalendarProvider,
  calendarFailureReason,
} from "../appointments/provider";
import {
  buffered,
  candidateSlots,
  customerDay,
  overlaps,
  requestedInstant,
} from "../appointments/timing";

type Appointment = typeof appointment.$inferSelect;
type Policy = typeof bookingPolicy.$inferSelect;
type Provider = {
  pilotBlocked?: boolean;
  pilotProvider?: "google" | "microsoft";
  provider: CalendarProvider;
  timeoutMs: number;
  providerForTransaction?(tx: Transaction): CalendarProvider;
};
const providerIn = (dep: Provider, tx: Transaction) =>
  dep.pilotBlocked
    ? unavailableCalendarProvider
    : (dep.providerForTransaction?.(tx) ?? dep.provider);
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sameInstant = (a: string, b: string) =>
  new Date(a).getTime() === new Date(b).getTime();
const nextAction = (p: Appointment) => {
  if (
    ["committed", "ambiguous", "cancel_committed", "cancel_ambiguous"].includes(
      p.phase,
    )
  )
    return "Reconcile with the calendar before any further booking or cancellation. Do not retry creation.";
  if (p.phase === "held")
    return "Book before the hold expires; availability will be checked again.";
  if (p.phase === "conflict")
    return "The assigned owner must review the original event and external calendar conflict, then reconcile. Do not create a replacement until resolved.";
  if (["expired", "blocked", "failed"].includes(p.phase))
    return "Review the reason and current setup, then choose a fresh slot and request a new hold.";
  if (p.status === "confirmed")
    return "Appointment confirmed in the calendar. Arrange customer communication separately; no notification has been sent.";
  return "Retained as appointment evidence, separate from quotations and sales.";
};

/** Same reviewed #19/#22 exception: the shared Business lock covers bounded
 * provider I/O after a separately committed intent. No in-process or task retry
 * repeats creation. Rollback after an external success leaves a durable claim
 * for read-only reconciliation. This serializes this app's writers, not external calendars.
 */
export function createAppointmentRepository(database: Database, clock: Clock) {
  function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction, canManage: boolean) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return operation(tx, role !== "salesperson");
      },
      { lock: true },
    );
  }
  async function policies(tx: Transaction, businessId: string) {
    return tx
      .select()
      .from(bookingPolicy)
      .where(eq(bookingPolicy.businessId, businessId))
      .orderBy(desc(bookingPolicy.version));
  }
  async function rows(tx: Transaction, businessId: string) {
    return tx
      .select()
      .from(appointment)
      .where(eq(appointment.businessId, businessId))
      .orderBy(asc(appointment.at), asc(appointment.id));
  }
  async function find(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
    id: string,
  ) {
    const [p] = await tx
      .select()
      .from(appointment)
      .where(
        and(
          eq(appointment.id, id),
          eq(appointment.businessId, businessId),
          eq(appointment.opportunityId, opportunityId),
        ),
      );
    if (!p) throw new ApplicationError("NOT_FOUND");
    return p;
  }
  async function context(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
  ) {
    const c = await inquiryContext(tx, businessId, opportunityId, clock.now());
    const authority = await readCommercialPolicy(tx, businessId, false);
    return {
      ...c,
      key: hash({
        ownerId: c.need.ownerId,
        controlVersion: c.need.controlVersion,
        policyVersion: authority.version,
        knowledgeVersion: c.snapshot.knowledgeVersion,
        messages: c.snapshot.messages,
      }),
    };
  }
  async function owner(
    tx: Transaction,
    actor: WorkIdentity,
    businessId: string,
    opportunityId: string,
  ) {
    const c = await context(tx, businessId, opportunityId);
    if (c.need.ownerId !== actor.userId)
      throw new ApplicationError("FORBIDDEN");
    return c;
  }
  async function history(
    tx: Transaction,
    actor: WorkIdentity,
    p: Appointment,
    kind: string,
    note: string,
    source: "application" | "provider" | "business" = "application",
    reference: string | null = null,
    evidence?: AppointmentEvidence,
  ) {
    const previous = await tx
      .select({ sequence: appointmentHistory.sequence })
      .from(appointmentHistory)
      .where(
        and(
          eq(appointmentHistory.businessId, p.businessId),
          eq(appointmentHistory.appointmentId, p.id),
        ),
      )
      .orderBy(desc(appointmentHistory.sequence))
      .limit(1);
    await tx.insert(appointmentHistory).values({
      id: randomUUID(),
      sequence: (previous[0]?.sequence ?? 0) + 1,
      requestKey: evidence?.requestKey,
      businessId: p.businessId,
      opportunityId: p.opportunityId,
      appointmentId: p.id,
      actorId: actor.userId,
      kind,
      source,
      reference,
      note,
      occurredAt: evidence ? new Date(evidence.occurredAt) : clock.now(),
      at: clock.now(),
    });
  }
  async function finish(
    tx: Transaction,
    actor: WorkIdentity,
    p: Appointment,
    phase: Appointment["phase"],
    reason: string | null,
    status: Appointment["status"] = p.status,
  ) {
    await tx
      .update(appointment)
      .set({ phase, reason, status })
      .where(
        and(eq(appointment.id, p.id), eq(appointment.businessId, p.businessId)),
      );
    await history(tx, actor, p, phase, reason ?? phase);
  }
  function holds(p: Appointment) {
    return (
      p.status !== "cancelled" &&
      p.status !== "attended" &&
      ([
        "committed",
        "ambiguous",
        "booked",
        "conflict",
        "cancel_committed",
        "cancel_ambiguous",
      ].includes(p.phase) ||
        (p.phase === "held" && p.holdExpiresAt > clock.now()))
    );
  }
  async function expire(
    tx: Transaction,
    actor: WorkIdentity,
    all: Appointment[],
  ) {
    for (const p of all)
      if (p.phase === "held" && p.holdExpiresAt <= clock.now()) {
        await finish(tx, actor, p, "expired", "hold_expired");
        p.phase = "expired";
        p.reason = "hold_expired";
      }
  }
  async function pilotCalendarCurrent(
    tx: Transaction,
    businessId: string,
    path: Record<string, unknown>,
  ) {
    await requirePilotPath(tx, businessId, "calendar", path);
    if (!(await pilotEffectCurrent(tx, businessId, "calendar")))
      throw new ApplicationError("PAID_ACCESS_REQUIRED");
  }
  async function readyCalendar(
    tx: Transaction,
    businessId: string,
    policy: Policy,
    dep: Provider,
  ) {
    if (!policy.calendar || !providerIn(dep, tx).available)
      return "calendar_setup_required";
    try {
      await pilotCalendarCurrent(tx, businessId, policy.calendar);
      const all = await calendarCatalog(
        providerIn(dep, tx),
        businessId,
        dep.timeoutMs,
        policy.calendar.provider,
      );
      const current = all.find(
        (c) =>
          c.connectionId === policy.calendar?.connectionId &&
          c.calendarId === policy.calendar?.calendarId,
      );
      if (
        !current ||
        current.grant !== "granted" ||
        !current.canRead ||
        !current.canWrite
      )
        return "calendar_permission_required";
      if (
        current.provider !== policy.calendar.provider ||
        current.accountKind !== policy.calendar.accountKind ||
        current.availabilityMode !== policy.calendar.availabilityMode
      )
        return "calendar_capability_changed";
      return null;
    } catch (error) {
      return calendarFailureReason(error, "provider_unavailable");
    }
  }
  function calendarScope(
    businessId: string,
    opportunityId: string,
    policy: Policy,
  ): CalendarScope {
    if (!policy.calendar) throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
    const c = policy.calendar;
    return {
      businessId,
      opportunityId,
      connectionId: c.connectionId,
      calendarId: c.calendarId,
      provider: c.provider,
      accountKind: c.accountKind,
      availabilityMode: c.availabilityMode,
    };
  }
  async function availability(
    tx: Transaction,
    scope: CalendarScope,
    start: Date,
    end: Date,
    dep: Provider,
  ) {
    const at = clock.now();
    const query = {
      ...scope,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    };
    await pilotCalendarCurrent(tx, scope.businessId, scope);
    const raw = await calendarCall(
      (s) => providerIn(dep, tx).availability(query, s),
      dep.timeoutMs,
    );
    const parsed = availabilityReceiptSchema.safeParse(raw);
    if (!parsed.success) throw new ApplicationError("PROVIDER_UNAVAILABLE");
    const r = parsed.data;
    if (
      Object.entries(scope).some(
        ([key, value]) => Reflect.get(r, key) !== value,
      ) ||
      !sameInstant(r.startsAt, query.startsAt) ||
      !sameInstant(r.endsAt, query.endsAt) ||
      new Date(r.checkedAt) < at ||
      new Date(r.checkedAt) > clock.now()
    )
      throw new ApplicationError("PROVIDER_UNAVAILABLE");
    return r.busy.map((b) => ({
      start: new Date(b.startsAt),
      end: new Date(b.endsAt),
    }));
  }
  async function guard(
    tx: Transaction,
    actor: WorkIdentity,
    p: Appointment,
    policy: Policy,
  ) {
    const c = await owner(tx, actor, p.businessId, p.opportunityId);
    if (p.actorId !== actor.userId) return "ownership_changed";
    if (p.contextKey !== c.key) return "opportunity_context_changed";
    const latest = (await policies(tx, p.businessId))[0];
    if (latest?.id !== policy.id) return "booking_policy_changed";
    if (
      p.mode === "automation" &&
      (c.need.controlState !== "automation" ||
        !policy.configuration.automationEnabled ||
        c.knowledge?.configuration.goal !== "booking")
    )
      return "automation_not_authorized";
    if (
      p.mode === "automation" &&
      !(await qualified(tx, p.businessId, p.opportunityId, c))
    )
      return "qualification_review_required";
    return null;
  }
  async function qualified(
    tx: Transaction,
    businessId: string,
    opportunityId: string,
    c: Awaited<ReturnType<typeof context>>,
  ) {
    // A Business may explicitly configure no qualification fields. Otherwise use
    // #20's persisted, validated decision for this exact current context; model
    // output or a client-supplied 'qualified' flag never grants booking authority.
    if (!c.knowledge) return false;
    if (c.knowledge.configuration.qualification.length === 0) return true;
    const [run] = await tx
      .select()
      .from(inquiryRun)
      .where(
        and(
          eq(inquiryRun.businessId, businessId),
          eq(inquiryRun.opportunityId, opportunityId),
        ),
      )
      .orderBy(desc(inquiryRun.sequence))
      .limit(1);
    return (
      !!run &&
      run.result.status === "ready" &&
      run.result.qualification === "qualified" &&
      run.result.goal === "booking" &&
      sameInquirySnapshot(run.snapshot, c.snapshot)
    );
  }
  const policyView = (p: Policy) => ({
    version: p.version,
    configuration: p.configuration,
    calendar: p.calendar,
    note: p.note,
    at: p.at.toISOString(),
  });
  function matchesIntent(
    intent: BookingIntent,
    event: CalendarEvent,
    times = true,
  ) {
    return Object.entries(intent).every(([key, value]) => {
      if (key === "startsAt" || key === "endsAt")
        return (
          !times || sameInstant(String(Reflect.get(event, key)), String(value))
        );
      return Reflect.get(event, key) === value;
    });
  }
  async function retainEvent(
    tx: Transaction,
    actor: WorkIdentity,
    p: Appointment,
    event: CalendarEvent,
    conflicts: boolean,
  ) {
    if (await eventIdentityUsed(tx, p, event)) {
      await finish(
        tx,
        actor,
        p,
        p.event ? "conflict" : "ambiguous",
        "event_identity_already_used",
        p.event ? "requested" : p.status,
      );
      return;
    }
    if (
      !matchesIntent(p.intent, event, false) ||
      (p.event && p.event.eventId !== event.eventId) ||
      new Date(event.observedAt) > clock.now() ||
      new Date(event.observedAt) < p.at
    ) {
      await finish(
        tx,
        actor,
        p,
        p.event ? "conflict" : "ambiguous",
        "invalid_or_mismatched_event",
        p.event ? "requested" : p.status,
      );
      return;
    }
    const changed = !matchesIntent(p.intent, event) || conflicts;
    const status =
      event.status === "cancelled"
        ? "cancelled"
        : changed
          ? "requested"
          : p.status === "attended"
            ? "attended"
            : "confirmed";
    const cancellationPending = [
      "cancel_committed",
      "cancel_ambiguous",
    ].includes(p.phase);
    const phase =
      event.status === "cancelled"
        ? "finished"
        : changed
          ? "conflict"
          : cancellationPending
            ? "cancel_ambiguous"
            : status === "attended"
              ? "finished"
              : "booked";
    const reason = changed
      ? "external_calendar_conflict"
      : cancellationPending && event.status === "active"
        ? "cancellation_result_unknown"
        : null;
    // The first authoritative identity is immutable. Subsequent provider observations
    // are appended to history and never erase the original reservation evidence.
    await tx
      .update(appointment)
      .set({ status, phase, reason, event: p.event ?? event })
      .where(
        and(eq(appointment.id, p.id), eq(appointment.businessId, p.businessId)),
      );
    if (p.status !== status || p.phase !== phase || p.reason !== reason)
      await history(
        tx,
        actor,
        p,
        status === "requested" ? "conflict" : status,
        changed
          ? "External calendar edits or overlapping events require owner review."
          : "Authoritative calendar event retained. Customer notification has not been sent.",
        "provider",
        event.eventId,
      );
  }
  async function lookup(
    tx: Transaction,
    actor: WorkIdentity,
    p: Appointment,
    dep: Provider,
  ) {
    let raw: unknown;
    const at = clock.now();
    try {
      await pilotCalendarCurrent(tx, p.businessId, p.intent);
      raw = await calendarCall(
        (s) =>
          providerIn(dep, tx).lookup(
            {
              ...p.intent,
              eventId: p.event?.eventId ?? null,
              blockedStart: p.blockedStart.toISOString(),
              blockedEnd: p.blockedEnd.toISOString(),
            },
            s,
          ),
        dep.timeoutMs,
      );
    } catch (error) {
      await finish(
        tx,
        actor,
        p,
        p.event ? "conflict" : "ambiguous",
        calendarFailureReason(error, "reconciliation_unavailable"),
        p.event ? "requested" : p.status,
      );
      return;
    }
    const parsed = calendarLookupSchema.safeParse(raw);
    if (!parsed.success) {
      await finish(
        tx,
        actor,
        p,
        p.event ? "conflict" : "ambiguous",
        "invalid_reconciliation_result",
        p.event ? "requested" : p.status,
      );
      return;
    }
    const result = parsed.data;
    if (result.status === "found") {
      if (new Date(result.event.observedAt) < at) {
        await finish(
          tx,
          actor,
          p,
          p.event ? "conflict" : "ambiguous",
          "invalid_reconciliation_result",
          p.event ? "requested" : p.status,
        );
        return;
      }
      await retainEvent(tx, actor, p, result.event, result.conflicts);
      return;
    }
    if (
      !Object.entries(p.intent).every(
        ([key, v]) => Reflect.get(result, key) === v,
      ) ||
      new Date(result.checkedAt) < at ||
      new Date(result.checkedAt) > clock.now()
    ) {
      await finish(
        tx,
        actor,
        p,
        p.event ? "conflict" : "ambiguous",
        "invalid_reconciliation_result",
        p.event ? "requested" : p.status,
      );
      return;
    }
    await finish(
      tx,
      actor,
      p,
      p.event ? "conflict" : result.definitive ? "failed" : "ambiguous",
      p.event
        ? "authoritative_event_missing"
        : result.definitive
          ? "authoritative_no_event"
          : "creation_result_unknown",
      p.event ? "requested" : p.status,
    );
  }
  async function eventIdentityUsed(
    tx: Transaction,
    p: Appointment,
    event: CalendarEvent,
  ) {
    return (await rows(tx, p.businessId)).some(
      (other) =>
        other.id !== p.id &&
        other.intent.connectionId === p.intent.connectionId &&
        other.intent.calendarId === p.intent.calendarId &&
        other.event?.eventId === event.eventId,
    );
  }
  return {
    async reservePilotOperation(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string | null,
      phase: string,
      payload: Record<string, unknown>,
      selected?: Record<string, unknown> | null,
    ) {
      try {
        return await scope(actor, businessId, async (tx, canManage) => {
          if (phase === "configure" && !canManage)
            throw new ApplicationError("FORBIDDEN");
          if (opportunityId) {
            if (phase === "read") await context(tx, businessId, opportunityId);
            else await owner(tx, actor, businessId, opportunityId);
          }
          const current = (await policies(tx, businessId))[0];
          let provider = current?.calendar?.provider;
          if (
            selected &&
            selected.connectionId !== current?.calendar?.connectionId
          ) {
            const [google] = await tx
              .select({ id: googleCalendarGrant.id })
              .from(googleCalendarGrant)
              .where(
                and(
                  eq(googleCalendarGrant.id, String(selected.connectionId)),
                  eq(googleCalendarGrant.businessId, businessId),
                ),
              );
            const [microsoft] = await tx
              .select({ id: microsoftCalendarGrant.id })
              .from(microsoftCalendarGrant)
              .where(
                and(
                  eq(microsoftCalendarGrant.id, String(selected.connectionId)),
                  eq(microsoftCalendarGrant.businessId, businessId),
                ),
              );
            provider =
              google && !microsoft
                ? "google"
                : microsoft && !google
                  ? "microsoft"
                  : undefined;
          }
          const path = { ...(selected ?? current?.calendar ?? {}), provider };
          await requirePilotPath(tx, businessId, "calendar", path);
          // An empty binding asks to enumerate all calendars. A pilot authorizes
          // only the exact selected provider/account/calendar, independently.
          const allCalendarsAllowed = await pilotPathAllowed(
            tx,
            businessId,
            "calendar",
            {},
          );
          await reservePilotEffect(
            tx,
            businessId,
            "calendar",
            `${phase}:${randomUUID()}`,
            1,
            {
              phase,
              opportunityId,
              policyId: current?.id ?? null,
              path,
              payload,
            },
          );
          const role = await requireCapability(
            tx,
            actor,
            businessId,
            "sales.work",
          );
          await requireSalesSession(tx, actor, clock.now(), role);
          return {
            allowed: true,
            provider: allCalendarsAllowed ? undefined : provider,
          };
        });
      } catch (error) {
        if (
          error instanceof ApplicationError &&
          error.code === "PAID_ACCESS_REQUIRED"
        )
          return { allowed: false, provider: undefined };
        throw error;
      }
    },
    configure(
      actor: WorkIdentity,
      businessId: string,
      input: ConfigureBooking,
      dep: Provider,
    ) {
      return scope(actor, businessId, async (tx, canManage) => {
        if (!canManage) throw new ApplicationError("FORBIDDEN");
        const all = await policies(tx, businessId);
        if ((all[0]?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const selected = input.configuration.calendar;
        if (selected) await pilotCalendarCurrent(tx, businessId, selected);
        const catalog = selected
          ? await calendarCatalog(
              providerIn(dep, tx),
              businessId,
              dep.timeoutMs,
              dep.pilotProvider,
            )
          : [];
        const calendar = selected
          ? catalog.find(
              (c) =>
                c.connectionId === selected.connectionId &&
                c.calendarId === selected.calendarId,
            )
          : null;
        if (selected && !calendar) throw new ApplicationError("INVALID_INPUT");
        await tx.insert(bookingPolicy).values({
          id: randomUUID(),
          businessId,
          version: input.expectedVersion + 1,
          configuration: input.configuration,
          calendar,
          actorId: actor.userId,
          note: input.note,
          at: clock.now(),
        });
      });
    },
    read(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      dep: Provider,
    ): Promise<AppointmentWorkspace> {
      return scope(actor, businessId, async (tx, canManage) => {
        const c = await context(tx, businessId, opportunityId);
        const allPolicies = await policies(tx, businessId);
        const all = await rows(tx, businessId);
        await expire(tx, actor, all);
        let calendars: AppointmentWorkspace["calendars"] = [];
        let setupReason: string | null = "calendar_setup_required";
        try {
          await pilotCalendarCurrent(
            tx,
            businessId,
            allPolicies[0]?.calendar ?? {},
          );
          calendars = await calendarCatalog(
            providerIn(dep, tx),
            businessId,
            dep.timeoutMs,
            dep.pilotProvider,
          );
          setupReason = allPolicies[0]
            ? await readyCalendar(tx, businessId, allPolicies[0], dep)
            : "configure_booking_hours";
        } catch (error) {
          setupReason = providerIn(dep, tx).available
            ? calendarFailureReason(error, "provider_unavailable")
            : "calendar_setup_required";
        }
        const appointments: AppointmentWorkspace["appointments"] = [];
        for (const p of all.filter((p) => p.opportunityId === opportunityId)) {
          const events = await tx
            .select()
            .from(appointmentHistory)
            .where(
              and(
                eq(appointmentHistory.businessId, businessId),
                eq(appointmentHistory.appointmentId, p.id),
              ),
            )
            .orderBy(asc(appointmentHistory.sequence));
          appointments.push({
            id: p.id,
            intent: p.intent,
            status: p.status,
            phase: p.phase,
            holdExpiresAt: p.holdExpiresAt.toISOString(),
            event: p.event,
            reason: p.reason,
            ownerId: c.need.ownerId,
            nextAction: nextAction(p),
            customerNotified: false,
            history: events.map((e) => ({
              ...e,
              occurredAt: e.occurredAt.toISOString(),
              at: e.at.toISOString(),
            })),
          });
        }
        return {
          policy: allPolicies[0] ? policyView(allPolicies[0]) : null,
          policyHistory: allPolicies.map(policyView),
          calendars,
          canManage,
          canAct: c.need.ownerId === actor.userId,
          ownerId: c.need.ownerId,
          controlState: c.need.controlState,
          providerAvailable: providerIn(dep, tx).available,
          setupReason,
          appointments,
        };
      });
    },
    availability(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: AvailabilityQuery,
      dep: Provider,
    ): Promise<AvailabilityView> {
      return scope(actor, businessId, async (tx) => {
        await owner(tx, actor, businessId, opportunityId);
        const policy = (await policies(tx, businessId))[0];
        if (!policy)
          return { version: 0, reason: "configure_booking_hours", slots: [] };
        const reason = await readyCalendar(tx, businessId, policy, dep);
        if (reason) return { version: policy.version, reason, slots: [] };
        const { start, end } = customerDay(input);
        const all = await rows(tx, businessId);
        await expire(tx, actor, all);
        try {
          const busy = await availability(
            tx,
            calendarScope(businessId, opportunityId, policy),
            new Date(
              start.epochMilliseconds -
                policy.configuration.bufferBeforeMinutes * 60000,
            ),
            new Date(
              end.epochMilliseconds +
                (policy.configuration.durationMinutes +
                  policy.configuration.bufferAfterMinutes) *
                  60000,
            ),
            dep,
          );
          const active = all.filter(
            (p) =>
              holds(p) &&
              p.intent.connectionId === policy.calendar?.connectionId &&
              p.intent.calendarId === policy.calendar?.calendarId,
          );
          const slots = candidateSlots(
            policy.configuration,
            input,
            clock.now(),
          ).filter((s) => {
            const range = buffered(policy.configuration, s.startsAt, s.endsAt);
            return (
              !busy.some((b) => overlaps(range, b)) &&
              !active.some((p) =>
                overlaps(range, { start: p.blockedStart, end: p.blockedEnd }),
              )
            );
          });
          return { version: policy.version, reason: null, slots };
        } catch (error) {
          return {
            version: policy.version,
            reason: calendarFailureReason(error, "provider_unavailable"),
            slots: [],
          };
        }
      });
    },
    request(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: AppointmentRequest,
      dep: Provider,
    ) {
      return scope(actor, businessId, async (tx) => {
        const c = await owner(tx, actor, businessId, opportunityId);
        const all = await rows(tx, businessId);
        const replay = all.find((p) => p.requestKey === input.requestKey);
        if (replay) {
          if (
            replay.fingerprint !== hash(input) ||
            replay.actorId !== actor.userId ||
            replay.opportunityId !== opportunityId
          )
            throw new ApplicationError("CONFLICT");
          return;
        }
        const policy = (await policies(tx, businessId))[0];
        if (!policy?.calendar)
          throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
        if (policy.version !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        if (
          input.mode === "automation" &&
          (!policy.configuration.automationEnabled ||
            c.need.controlState !== "automation" ||
            c.knowledge?.configuration.goal !== "booking")
        )
          throw new ApplicationError("FORBIDDEN");
        const startsAt = requestedInstant(input);
        const slot = candidateSlots(
          policy.configuration,
          {
            day: input.localStart.slice(0, 10),
            customerTimeZone: input.customerTimeZone,
          },
          clock.now(),
        ).find((s) => sameInstant(s.startsAt, startsAt));
        if (!slot) throw new ApplicationError("INVALID_INPUT");
        const range = buffered(
          policy.configuration,
          slot.startsAt,
          slot.endsAt,
        );
        await expire(tx, actor, all);
        let reason =
          input.mode === "automation" &&
          !(await qualified(tx, businessId, opportunityId, c))
            ? "qualification_review_required"
            : await readyCalendar(tx, businessId, policy, dep);
        if (
          !reason &&
          all.some(
            (p) =>
              holds(p) &&
              p.intent.connectionId === policy.calendar?.connectionId &&
              p.intent.calendarId === policy.calendar?.calendarId &&
              overlaps(range, { start: p.blockedStart, end: p.blockedEnd }),
          )
        )
          reason = "slot_held_or_booked";
        const id = randomUUID();
        const intent: BookingIntent = {
          ...calendarScope(businessId, opportunityId, policy),
          appointmentId: id,
          intentKey: hash({
            id,
            businessId,
            opportunityId,
            policyId: policy.id,
            input,
          }),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          businessTimeZone: policy.configuration.timeZone,
          customerTimeZone: input.customerTimeZone,
        };
        const [p] = await tx
          .insert(appointment)
          .values({
            id,
            businessId,
            opportunityId,
            policyId: policy.id,
            requestKey: input.requestKey,
            fingerprint: hash(input),
            actorId: actor.userId,
            sessionId: actor.sessionId,
            mode: input.mode,
            contextKey: c.key,
            intent,
            blockedStart: range.start,
            blockedEnd: range.end,
            holdExpiresAt: new Date(
              clock.now().getTime() + policy.configuration.holdSeconds * 1000,
            ),
            status: "requested",
            phase: reason ? "blocked" : "held",
            reason,
            at: clock.now(),
          })
          .returning();
        await history(
          tx,
          actor,
          p,
          "requested",
          reason ?? "Local hold only; no calendar event or notification yet.",
        );
      });
    },
    async book(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      id: string,
      dep: Provider,
    ) {
      const claimed = await scope(actor, businessId, async (tx) => {
        const p = await find(tx, businessId, opportunityId, id);
        await owner(tx, actor, businessId, opportunityId);
        if (p.phase !== "held") return false;
        const policy = (await policies(tx, businessId)).find(
          (v) => v.id === p.policyId,
        );
        if (!policy) throw new ApplicationError("CONFLICT");
        const reason =
          p.holdExpiresAt <= clock.now()
            ? "hold_expired"
            : await guard(tx, actor, p, policy);
        await finish(
          tx,
          actor,
          p,
          reason ? "blocked" : "committed",
          reason ?? "creation_unconfirmed",
        );
        return !reason;
      });
      if (!claimed) return;
      await scope(actor, businessId, async (tx) => {
        const p = await find(tx, businessId, opportunityId, id);
        if (p.phase !== "committed") return;
        const policy = (await policies(tx, businessId)).find(
          (v) => v.id === p.policyId,
        );
        if (!policy) throw new ApplicationError("CONFLICT");
        let reason =
          p.holdExpiresAt <= clock.now()
            ? "hold_expired"
            : await guard(tx, actor, p, policy);
        reason ??= await readyCalendar(tx, businessId, policy, dep);
        if (reason) {
          await finish(tx, actor, p, "blocked", reason);
          return;
        }
        // Fresh scoped availability is the last external operation before create.
        try {
          const busy = await availability(
            tx,
            calendarScope(businessId, opportunityId, policy),
            p.blockedStart,
            p.blockedEnd,
            dep,
          );
          if (
            busy.some((b) =>
              overlaps({ start: p.blockedStart, end: p.blockedEnd }, b),
            )
          ) {
            await finish(tx, actor, p, "blocked", "slot_no_longer_available");
            return;
          }
        } catch (error) {
          await finish(
            tx,
            actor,
            p,
            "blocked",
            calendarFailureReason(error, "provider_unavailable"),
          );
          return;
        }
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        const finalReason =
          p.holdExpiresAt <= clock.now() ||
          new Date(p.intent.startsAt) <= clock.now()
            ? "hold_expired"
            : await guard(tx, actor, p, policy);
        if (finalReason) {
          await finish(tx, actor, p, "blocked", finalReason);
          return;
        }
        await pilotCalendarCurrent(tx, businessId, p.intent);
        let raw: unknown;
        try {
          raw = await calendarCall(
            (s) => providerIn(dep, tx).create(p.intent, s),
            dep.timeoutMs,
          );
        } catch (error) {
          await finish(
            tx,
            actor,
            p,
            "ambiguous",
            calendarFailureReason(error, "creation_result_unknown"),
          );
          return;
        }
        const result = calendarEventSchema.safeParse(raw);
        if (
          !result.success ||
          !matchesIntent(p.intent, result.data) ||
          result.data.status !== "active" ||
          new Date(result.data.observedAt) > clock.now() ||
          new Date(result.data.observedAt) < p.at
        ) {
          await finish(
            tx,
            actor,
            p,
            "ambiguous",
            "invalid_or_mismatched_event",
          );
          return;
        }
        if (await eventIdentityUsed(tx, p, result.data)) {
          await finish(
            tx,
            actor,
            p,
            "ambiguous",
            "event_identity_already_used",
          );
          return;
        }
        // Do not catch database failures as provider failures. A rollback preserves
        // the committed claim, and only read-only reconciliation may recover it.
        await tx
          .update(appointment)
          .set({ event: result.data })
          .where(
            and(
              eq(appointment.id, p.id),
              eq(appointment.businessId, businessId),
            ),
          );
        // Read back by intent/identity, checking external conflicts after creation.
        // A concurrent external edit can still happen after this observation.
        await lookup(tx, actor, { ...p, event: result.data }, dep);
      });
    },
    reconcile(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      id: string,
      dep: Provider,
    ) {
      return scope(actor, businessId, async (tx) => {
        await owner(tx, actor, businessId, opportunityId);
        const p = await find(tx, businessId, opportunityId, id);
        if (
          ![
            "committed",
            "ambiguous",
            "booked",
            "conflict",
            "cancel_committed",
            "cancel_ambiguous",
          ].includes(p.phase)
        )
          return;
        const policy = (await policies(tx, businessId)).find(
          (v) => v.id === p.policyId,
        );
        if (!policy) throw new ApplicationError("CONFLICT");
        const reason = await readyCalendar(tx, businessId, policy, dep);
        if (reason) {
          await finish(
            tx,
            actor,
            p,
            p.event ? "conflict" : "ambiguous",
            reason,
            p.event ? "requested" : p.status,
          );
          return;
        }
        // This is an explicit current-owner read, even after ownership, session or
        // policy changes. It retains external facts; it never retries a mutation.
        await lookup(tx, actor, p, dep);
      });
    },
    evidence(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: AppointmentEvidence,
    ) {
      return scope(actor, businessId, async (tx, canManage) => {
        if (!canManage) throw new ApplicationError("FORBIDDEN");
        await owner(tx, actor, businessId, opportunityId);
        const p = await find(
          tx,
          businessId,
          opportunityId,
          input.appointmentId,
        );
        const previous = await tx
          .select()
          .from(appointmentHistory)
          .where(
            and(
              eq(appointmentHistory.businessId, businessId),
              eq(appointmentHistory.requestKey, input.requestKey),
            ),
          );
        if (previous[0]) {
          const e = previous[0];
          if (
            e.appointmentId !== p.id ||
            e.actorId !== actor.userId ||
            e.kind !== input.kind ||
            e.reference !== input.reference ||
            e.note !== input.note ||
            !sameInstant(e.occurredAt.toISOString(), input.occurredAt)
          )
            throw new ApplicationError("CONFLICT");
          return;
        }
        if (
          !p.event ||
          new Date(input.occurredAt) > clock.now() ||
          new Date(input.occurredAt) < p.at ||
          (input.kind === "attended" &&
            (p.status !== "confirmed" ||
              p.phase !== "booked" ||
              new Date(input.occurredAt) < new Date(p.intent.endsAt))) ||
          (input.kind === "cancelled" &&
            (p.status === "attended" || p.status === "cancelled"))
        )
          throw new ApplicationError("INVALID_INPUT");
        const duplicate = await tx
          .select()
          .from(appointmentHistory)
          .where(
            and(
              eq(appointmentHistory.businessId, businessId),
              eq(appointmentHistory.source, "business"),
              eq(appointmentHistory.kind, input.kind),
              eq(appointmentHistory.reference, input.reference),
            ),
          );
        if (duplicate.length) throw new ApplicationError("CONFLICT");
        await tx
          .update(appointment)
          .set({
            status: input.kind,
            phase: "finished",
            reason: "business_evidence",
          })
          .where(
            and(
              eq(appointment.businessId, businessId),
              eq(appointment.id, p.id),
            ),
          );
        await history(
          tx,
          actor,
          p,
          input.kind,
          input.note,
          "business",
          input.reference,
          input,
        );
      });
    },
    async cancel(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      id: string,
      dep: Provider,
    ) {
      const claimed = await scope(actor, businessId, async (tx) => {
        const c = await owner(tx, actor, businessId, opportunityId);
        const p = await find(tx, businessId, opportunityId, id);
        if (
          !p.event ||
          p.status === "attended" ||
          p.status === "cancelled" ||
          ["cancel_committed", "cancel_ambiguous"].includes(p.phase)
        )
          return false;
        if (p.phase !== "booked" && p.phase !== "conflict")
          throw new ApplicationError("CONFLICT");
        const currentPolicy = (await policies(tx, businessId))[0];
        await tx
          .update(appointment)
          .set({
            cancellation: {
              actorId: actor.userId,
              contextKey: hash({ context: c.key, policyId: currentPolicy?.id }),
            },
          })
          .where(
            and(eq(appointment.businessId, businessId), eq(appointment.id, id)),
          );
        await finish(
          tx,
          actor,
          p,
          "cancel_committed",
          "cancellation_requested",
        );
        return true;
      });
      if (!claimed) return;
      await scope(actor, businessId, async (tx) => {
        const c = await owner(tx, actor, businessId, opportunityId);
        const p = await find(tx, businessId, opportunityId, id);
        if (p.phase !== "cancel_committed" || !p.event) return;
        const allPolicies = await policies(tx, businessId);
        const policy = allPolicies.find((v) => v.id === p.policyId);
        if (!policy) throw new ApplicationError("CONFLICT");
        if (
          p.cancellation?.actorId !== actor.userId ||
          p.cancellation.contextKey !==
            hash({ context: c.key, policyId: allPolicies[0]?.id })
        ) {
          await finish(tx, actor, p, "booked", "cancellation_context_changed");
          return;
        }
        const reason = await readyCalendar(tx, businessId, policy, dep);
        if (reason) {
          await finish(tx, actor, p, "booked", reason);
          return;
        }
        let raw: unknown;
        try {
          // Observe the current revision before a conditional cancellation. This is
          // a manual authorized action and does not require automation handback.
          const observedAt = clock.now();
          await pilotCalendarCurrent(tx, businessId, p.intent);
          const lookupResult = calendarLookupSchema.safeParse(
            await calendarCall(
              (s) =>
                providerIn(dep, tx).lookup(
                  {
                    ...p.intent,
                    eventId: p.event!.eventId,
                    blockedStart: p.blockedStart.toISOString(),
                    blockedEnd: p.blockedEnd.toISOString(),
                  },
                  s,
                ),
              dep.timeoutMs,
            ),
          );
          if (
            !lookupResult.success ||
            lookupResult.data.status !== "found" ||
            !matchesIntent(p.intent, lookupResult.data.event) ||
            lookupResult.data.event.eventId !== p.event.eventId ||
            new Date(lookupResult.data.event.observedAt) < observedAt ||
            new Date(lookupResult.data.event.observedAt) > clock.now()
          ) {
            await finish(
              tx,
              actor,
              p,
              "conflict",
              "external_calendar_conflict",
              "requested",
            );
            return;
          }
          const current = lookupResult.data.event;
          if (current.status === "cancelled") {
            await retainEvent(tx, actor, p, current, false);
            return;
          }
          const role = await requireCapability(
            tx,
            actor,
            businessId,
            "sales.work",
          );
          await requireSalesSession(tx, actor, clock.now(), role);
          const finalContext = await owner(
            tx,
            actor,
            businessId,
            opportunityId,
          );
          const finalPolicy = (await policies(tx, businessId))[0];
          if (
            p.cancellation.contextKey !==
            hash({ context: finalContext.key, policyId: finalPolicy?.id })
          ) {
            await finish(
              tx,
              actor,
              p,
              "booked",
              "cancellation_context_changed",
            );
            return;
          }
          await pilotCalendarCurrent(tx, businessId, p.intent);
          raw = await calendarCall(
            (s) =>
              providerIn(dep, tx).cancel(
                {
                  ...p.intent,
                  eventId: current.eventId,
                  revision: current.revision,
                },
                s,
              ),
            dep.timeoutMs,
          );
        } catch (error) {
          await finish(
            tx,
            actor,
            p,
            "cancel_ambiguous",
            calendarFailureReason(error, "cancellation_result_unknown"),
          );
          return;
        }
        const parsed = calendarEventSchema.safeParse(raw);
        if (
          !parsed.success ||
          !matchesIntent(p.intent, parsed.data) ||
          parsed.data.eventId !== p.event.eventId ||
          parsed.data.status !== "cancelled"
        ) {
          await finish(
            tx,
            actor,
            p,
            "cancel_ambiguous",
            "invalid_cancellation_result",
          );
          return;
        }
        await retainEvent(tx, actor, p, parsed.data, false);
      });
    },
  };
}
