import { mailboxReplyReady } from "./mailbox-processing";
import { senderHealthAt } from "./sender-health-repository";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sameSenderBinding } from "../models/senders";
import { and, asc, desc, eq } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type {
  SenderAdapter,
  SenderConnectionConfiguration,
  SenderIdentityConfiguration,
  ReplyRouteConfiguration,
  SenderInspection,
  SenderObservation,
  SenderEvidence,
  SenderWorkspace,
  SenderUse,
  SenderRecord,
} from "../models/senders";
import { senderReadiness } from "../senders/readiness";
import { microsoftTransportKey } from "../microsoft-mail/transport";
import { gmailSequenceKey } from "../gmail/sequence-mail";
import {
  nativeSendingAuthorized,
  nativeSequenceReplyReady,
} from "./native-mail-dispatch";
import { requireSalesSession } from "./sales-session";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  business,
  inboxConnection,
  senderConnection,
  senderReplyRoute,
  senderIdentity,
  senderObservation,
  mailboxPolicy,
  inboxMessage,
} from "./schema";

type Save<T> = { id: string | null; expectedVersion: number; configuration: T };
type IdentityRow = typeof senderIdentity.$inferSelect;
const inBusiness = (
  table: { id: AnyPgColumn; businessId: AnyPgColumn },
  businessId: string,
  id: string,
) => and(eq(table.businessId, businessId), eq(table.id, id));
function view<T>(row: {
  id: string;
  version: number;
  configuration: T;
}): SenderRecord<T> {
  return { id: row.id, version: row.version, configuration: row.configuration };
}
async function connectionAt(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(senderConnection)
    .where(inBusiness(senderConnection, businessId, id));
  if (!row) throw new ApplicationError("NOT_FOUND");
  return view(row);
}
async function routeAt(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(senderReplyRoute)
    .where(inBusiness(senderReplyRoute, businessId, id));
  if (!row) throw new ApplicationError("NOT_FOUND");
  return view(row);
}
async function identityAt(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(senderIdentity)
    .where(inBusiness(senderIdentity, businessId, id));
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
export async function inspectionAt(
  tx: Transaction,
  businessId: string,
  row: IdentityRow,
  requestedAt: Date,
): Promise<SenderInspection> {
  const [latest] = await tx
    .select({ id: senderObservation.id })
    .from(senderObservation)
    .where(
      and(
        eq(senderObservation.businessId, businessId),
        eq(senderObservation.identityId, row.id),
      ),
    )
    .orderBy(desc(senderObservation.recordedAt), desc(senderObservation.id))
    .limit(1);
  const config = row.configuration;
  const connection = config.connectionId
    ? await connectionAt(tx, businessId, config.connectionId)
    : null;
  const replyRoute = config.replyRouteId
    ? await routeAt(tx, businessId, config.replyRouteId)
    : null;
  const replyConnection = replyRoute
    ? await connectionAt(tx, businessId, replyRoute.configuration.connectionId)
    : null;
  return {
    requestedAt: requestedAt.toISOString(),
    healthProof: row.connectionId
      ? (await senderHealthAt(tx, businessId, row.id, requestedAt)).proof
      : null,
    previousEvidenceId: latest?.id ?? null,
    binding: {
      businessId,
      identityId: row.id,
      identityVersion: row.version,
      connectionId: connection?.id ?? null,
      connectionVersion: connection?.version ?? null,
      replyRouteId: replyRoute?.id ?? null,
      replyRouteVersion: replyRoute?.version ?? null,
      replyConnectionId: replyConnection?.id ?? null,
      replyConnectionVersion: replyConnection?.version ?? null,
    },
    identity: config,
    connection,
    replyRoute,
    replyConnection,
    ...(connection?.configuration.provider === "gmail" ||
    connection?.configuration.provider === "microsoft"
      ? {
          [connection.configuration.provider === "gmail"
            ? "nativeGmail"
            : "nativeMicrosoft"]: {
            send: await nativeSendingAuthorized(
              tx,
              businessId,
              connection.id,
              config.fromAddress,
              connection.configuration.provider,
            ),
            reply: Boolean(
              replyRoute &&
              replyConnection &&
              (await nativeSequenceReplyReady(
                tx,
                businessId,
                replyRoute.configuration.inboxConnectionId,
                replyConnection.id,
                requestedAt,
                replyConnection.configuration.provider === "microsoft"
                  ? "microsoft"
                  : "gmail",
              )),
            ),
          },
        }
      : {}),
  };
}
export async function identityView(
  tx: Transaction,
  businessId: string,
  row: IdentityRow,
  at: Date,
  adapter?: Pick<SenderAdapter, "key" | "mode" | "select">,
) {
  const context = await inspectionAt(tx, businessId, row, at);
  if (adapter?.select)
    adapter = adapter.select(context.connection?.configuration.provider ?? "");
  const [latest] = await tx
    .select()
    .from(senderObservation)
    .where(
      and(
        eq(senderObservation.businessId, businessId),
        eq(senderObservation.identityId, row.id),
      ),
    )
    .orderBy(desc(senderObservation.recordedAt), desc(senderObservation.id))
    .limit(1);
  const [inbox] = context.replyRoute
    ? await tx
        .select()
        .from(inboxConnection)
        .where(
          inBusiness(
            inboxConnection,
            businessId,
            context.replyRoute.configuration.inboxConnectionId,
          ),
        )
    : [];
  const [owner] = await tx
    .select({ name: business.name })
    .from(business)
    .where(eq(business.id, businessId));
  const [mailbox] = context.connection
    ? await tx
        .select()
        .from(mailboxPolicy)
        .where(
          and(
            eq(mailboxPolicy.businessId, businessId),
            eq(mailboxPolicy.connectionId, context.connection.id),
          ),
        )
    : [];
  const nativeKey = adapter?.key ?? latest?.evidence.adapterKey;
  const nativeSequence =
    nativeKey === gmailSequenceKey || nativeKey === microsoftTransportKey;
  const nativeProvider =
    nativeKey === microsoftTransportKey ? "microsoft" : "gmail";
  const mailboxIssues =
    (nativeSequence &&
      (!context.connection ||
        !(await nativeSendingAuthorized(
          tx,
          businessId,
          context.connection.id,
          row.configuration.fromAddress,
          nativeProvider,
        )))) ||
    (mailbox &&
      (!mailbox.configuration.enabled ||
        !mailbox.configuration.requestedSend ||
        mailbox.grant?.send !== "granted" ||
        new Date(mailbox.grant.validUntil) <= at ||
        mailbox.connectionVersion !== context.connection?.version))
      ? [
          {
            code: "mailbox_send_not_authorized",
            action:
              "Request sending separately and reconnect the selected mailbox with a current sending grant.",
          },
        ]
      : [];
  const health = row.connectionId
    ? await senderHealthAt(
        tx,
        businessId,
        row.id,
        at,
        (adapter?.mode ?? latest?.evidence.mode) === "live",
      )
    : { issues: [] };
  return {
    ...view(row),
    identification: {
      businessName: owner.name,
      fromName: `${row.configuration.displayName} · ${owner.name}`,
      platformDisclosure: `Sent through Business operations for ${owner.name}`,
    },
    evidence: latest?.evidence ?? null,
    readiness: senderReadiness(
      context,
      latest?.evidence ?? null,
      at,
      Boolean(
        inbox?.active &&
        inbox.channel === "email" &&
        (nativeSequence
          ? await nativeSequenceReplyReady(
              tx,
              businessId,
              inbox.id,
              context.replyConnection?.id ?? "",
              at,
              nativeProvider,
            )
          : inbox.mode === "normalized_import" ||
            (await mailboxReplyReady(
              tx,
              businessId,
              inbox.id,
              at,
              context.replyConnection?.id ?? "",
            ))),
      ),
      adapter,
      [...mailboxIssues, ...health.issues],
    ),
  };
}

/** Native reply continuity determines the intended use even when an imported event is a direct inquiry. */
export function responseSenderUse(
  message: Pick<
    typeof inboxMessage.$inferSelect,
    "content" | "mailboxMetadata"
  >,
): SenderUse {
  return message.content.kind === "direct_inquiry" &&
    !message.mailboxMetadata?.native?.inReplyTo
    ? "inbound"
    : "existing_conversation";
}

/** Current explicit response selection is the identity bound to this inbox's reply route.
 * It cannot fall back to another identity or authorize recipient/market eligibility. Called under the Business dispatch lock. */
export async function responseSender(
  tx: Transaction,
  businessId: string,
  inboxId: string,
  at: Date,
  use: SenderUse = "existing_conversation",
) {
  const [selected] = await tx
    .select({ identity: senderIdentity })
    .from(senderIdentity)
    .innerJoin(
      senderReplyRoute,
      and(
        eq(senderReplyRoute.id, senderIdentity.replyRouteId),
        eq(senderReplyRoute.businessId, businessId),
      ),
    )
    .where(
      and(
        eq(senderIdentity.businessId, businessId),
        eq(senderReplyRoute.inboxConnectionId, inboxId),
      ),
    );
  if (!selected) return { reason: "sender_setup_required", sender: null };
  const identity = await identityView(tx, businessId, selected.identity, at);
  if (!identity.readiness.uses[use].ready)
    return { reason: "sender_not_ready", sender: null };
  const route = await routeAt(
    tx,
    businessId,
    identity.configuration.replyRouteId!,
  );
  return {
    reason: null,
    sender: {
      identityId: identity.id,
      identityVersion: identity.version,
      fromAddress: identity.configuration.fromAddress,
      fromName: identity.identification.fromName,
      platformDisclosure: identity.identification.platformDisclosure,
      replyTo: route.configuration.address,
      evidenceId: identity.evidence!.id,
      adapterKey: identity.evidence!.adapterKey,
      mode: identity.evidence!.mode,
    },
  };
}

export function createSenderRepository(database: Database, clock: Clock) {
  function access<T>(
    actor: WorkIdentity,
    businessId: string,
    manage: boolean,
    run: (tx: Transaction) => Promise<T>,
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
          manage ? "integrations.manage" : "profile.read",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return run(tx);
      },
      { lock: true },
    );
  }
  function checkVersion(row: { version: number } | null, expected: number) {
    if ((row?.version ?? 0) !== expected)
      throw new ApplicationError("CONFLICT");
  }
  async function record(
    actor: WorkIdentity,
    businessId: string,
    context: SenderInspection,
    observation: SenderObservation,
    adapter: Pick<SenderAdapter, "key" | "mode" | "select">,
  ) {
    return access(actor, businessId, true, async (tx) => {
      const row = await identityAt(tx, businessId, context.binding.identityId);
      const current = await inspectionAt(
        tx,
        businessId,
        row,
        new Date(context.requestedAt),
      );
      if (!isDeepStrictEqual(current, context))
        throw new ApplicationError("CONFLICT");
      if (
        !sameSenderBinding(observation.binding, current.binding) ||
        new Date(observation.observedAt) < new Date(context.requestedAt) ||
        new Date(observation.observedAt) > clock.now() ||
        new Date(observation.validUntil) < new Date(observation.observedAt)
      )
        throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const [previous] = await tx
        .select()
        .from(senderObservation)
        .where(
          and(
            eq(senderObservation.businessId, businessId),
            eq(senderObservation.identityId, row.id),
          ),
        )
        .orderBy(desc(senderObservation.recordedAt), desc(senderObservation.id))
        .limit(1);
      // Observations are pull results, not public provider events. Equal-time checks replace in order of recording.
      const recordedAt = new Date(
        Math.max(
          clock.now().getTime(),
          (previous?.recordedAt.getTime() ?? 0) + 1,
        ),
      );
      const id = randomUUID();
      const evidence: SenderEvidence = {
        ...observation,
        id,
        adapterKey: adapter.key,
        mode: adapter.mode,
        recordedAt: recordedAt.toISOString(),
      };
      await tx.insert(senderObservation).values({
        id,
        businessId,
        identityId: row.id,
        evidence,
        context,
        createdBy: actor.userId,
        recordedAt,
      });
      return identityView(tx, businessId, row, clock.now(), adapter);
    });
  }
  return {
    workspace(
      actor: WorkIdentity,
      businessId: string,
      adapter: Pick<SenderAdapter, "key" | "mode" | "select">,
    ): Promise<SenderWorkspace> {
      return access(actor, businessId, false, async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "profile.read",
        );
        const connections = await tx
          .select()
          .from(senderConnection)
          .where(eq(senderConnection.businessId, businessId))
          .orderBy(asc(senderConnection.updatedAt), asc(senderConnection.id));
        const replyRoutes = await tx
          .select()
          .from(senderReplyRoute)
          .where(eq(senderReplyRoute.businessId, businessId));
        const inboxes = await tx
          .select({
            id: inboxConnection.id,
            label: inboxConnection.label,
            active: inboxConnection.active,
          })
          .from(inboxConnection)
          .where(
            and(
              eq(inboxConnection.businessId, businessId),
              eq(inboxConnection.channel, "email"),
            ),
          );
        const identities = await tx
          .select()
          .from(senderIdentity)
          .where(eq(senderIdentity.businessId, businessId))
          .orderBy(asc(senderIdentity.updatedAt), asc(senderIdentity.id));
        return {
          canManage: role !== "salesperson",
          connections: connections.map(view),
          replyRoutes: replyRoutes.map(view),
          inboxes,
          identities: await Promise.all(
            identities.map((row) =>
              identityView(tx, businessId, row, clock.now(), adapter),
            ),
          ),
        };
      });
    },
    saveConnection(
      actor: WorkIdentity,
      businessId: string,
      input: Save<SenderConnectionConfiguration>,
    ) {
      return access(actor, businessId, true, async (tx) => {
        const current = input.id
          ? await connectionAt(tx, businessId, input.id)
          : null;
        checkVersion(current, input.expectedVersion);
        const values = {
          version: input.expectedVersion + 1,
          configuration: input.configuration,
          updatedAt: clock.now(),
        };
        const [row] = current
          ? await tx
              .update(senderConnection)
              .set(values)
              .where(inBusiness(senderConnection, businessId, current.id))
              .returning()
          : await tx
              .insert(senderConnection)
              .values({
                ...values,
                id: randomUUID(),
                businessId,
                createdBy: actor.userId,
              })
              .returning();
        return view(row);
      });
    },
    saveReplyRoute(
      actor: WorkIdentity,
      businessId: string,
      input: Save<ReplyRouteConfiguration>,
    ) {
      return access(actor, businessId, true, async (tx) => {
        const current = input.id
          ? await routeAt(tx, businessId, input.id)
          : null;
        checkVersion(current, input.expectedVersion);
        await connectionAt(tx, businessId, input.configuration.connectionId);
        const [inbox] = await tx
          .select()
          .from(inboxConnection)
          .where(
            inBusiness(
              inboxConnection,
              businessId,
              input.configuration.inboxConnectionId,
            ),
          );
        if (!inbox || inbox.channel !== "email")
          throw new ApplicationError("NOT_FOUND");
        if (inbox.mode === "mailbox") {
          const [policy] = await tx
            .select()
            .from(mailboxPolicy)
            .where(inBusiness(mailboxPolicy, businessId, inbox.id));
          if (
            !policy ||
            policy.connectionId !== input.configuration.connectionId ||
            policy.account !== input.configuration.address
          )
            throw new ApplicationError("INVALID_INPUT");
        }
        const [duplicate] = await tx
          .select()
          .from(senderReplyRoute)
          .where(eq(senderReplyRoute.inboxConnectionId, inbox.id));
        if (duplicate && duplicate.id !== current?.id)
          throw new ApplicationError("CONFLICT");
        const values = {
          version: input.expectedVersion + 1,
          configuration: input.configuration,
          connectionId: input.configuration.connectionId,
          inboxConnectionId: inbox.id,
          updatedAt: clock.now(),
        };
        const [row] = current
          ? await tx
              .update(senderReplyRoute)
              .set(values)
              .where(inBusiness(senderReplyRoute, businessId, current.id))
              .returning()
          : await tx
              .insert(senderReplyRoute)
              .values({
                ...values,
                id: randomUUID(),
                businessId,
                createdBy: actor.userId,
              })
              .returning();
        return view(row);
      });
    },
    saveIdentity(
      actor: WorkIdentity,
      businessId: string,
      input: Save<SenderIdentityConfiguration>,
      adapter: Pick<SenderAdapter, "key" | "mode" | "select">,
    ) {
      return access(actor, businessId, true, async (tx) => {
        const current = input.id
          ? await identityAt(tx, businessId, input.id)
          : null;
        checkVersion(current, input.expectedVersion);
        if (input.configuration.connectionId)
          await connectionAt(tx, businessId, input.configuration.connectionId);
        if (input.configuration.replyRouteId) {
          await routeAt(tx, businessId, input.configuration.replyRouteId);
          const [duplicate] = await tx
            .select()
            .from(senderIdentity)
            .where(
              eq(senderIdentity.replyRouteId, input.configuration.replyRouteId),
            );
          if (duplicate && duplicate.id !== current?.id)
            throw new ApplicationError("CONFLICT");
        }
        const values = {
          version: input.expectedVersion + 1,
          configuration: input.configuration,
          connectionId: input.configuration.connectionId,
          replyRouteId: input.configuration.replyRouteId,
          updatedAt: clock.now(),
        };
        const [row] = current
          ? await tx
              .update(senderIdentity)
              .set(values)
              .where(inBusiness(senderIdentity, businessId, current.id))
              .returning()
          : await tx
              .insert(senderIdentity)
              .values({
                ...values,
                id: randomUUID(),
                businessId,
                createdBy: actor.userId,
              })
              .returning();
        return identityView(tx, businessId, row, clock.now(), adapter);
      });
    },
    inspection(
      actor: WorkIdentity,
      businessId: string,
      id: string,
      expectedVersion: number,
    ) {
      return access(actor, businessId, true, async (tx) => {
        const row = await identityAt(tx, businessId, id);
        checkVersion(row, expectedVersion);
        return inspectionAt(tx, businessId, row, clock.now());
      });
    },
    record,
    invalidate(
      actor: WorkIdentity,
      businessId: string,
      context: SenderInspection,
      adapter: SenderAdapter,
    ) {
      return record(
        actor,
        businessId,
        context,
        {
          binding: context.binding,
          observedAt: clock.now().toISOString(),
          validUntil: clock.now().toISOString(),
          approvedUses: [],
          checks: {
            identity_control: "unknown",
            domain_verification: "unknown",
            spf: "unknown",
            dkim: "unknown",
            dmarc_alignment: "unknown",
            sending_grant: "unknown",
            delivery_transport: "unknown",
            reply_reading_grant: "unknown",
            inbox_sync: "unknown",
            reply_capture: "unknown",
            health: "unknown",
          },
        },
        adapter,
      );
    },
  };
}
