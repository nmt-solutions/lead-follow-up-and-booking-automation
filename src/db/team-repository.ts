import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { TeamRepository } from "../application/team";
import type { Actor } from "../models/business";
import type { BusinessRole, Invitation } from "../models/team";
import { ApplicationError } from "../models/application-error";
import type { Database } from "./runtime";
import {
  business,
  invitation,
  membership,
  platformOperator,
  teamAudit,
  user,
} from "./schema";
import {
  lockBusiness,
  requireCapability,
  scoped,
  type Transaction,
} from "./scope";

function publicInvitation(row: typeof invitation.$inferSelect): Invitation {
  return {
    id: row.id,
    businessId: row.businessId,
    email: row.email,
    role: row.role,
    status: row.status,
    delivery: row.delivery,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

async function audit(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  action: string,
  subjectId: string,
  at: Date,
  detail = "",
) {
  await tx.insert(teamAudit).values({
    id: randomUUID(),
    businessId,
    actorId: actor.userId,
    action,
    subjectId,
    detail,
    at,
  });
}

function mayManage(role: BusinessRole, targetRole: BusinessRole) {
  if (
    targetRole === "owner" ||
    (role !== "owner" && targetRole !== "salesperson")
  )
    throw new ApplicationError("FORBIDDEN");
}

async function expire(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  at: Date,
) {
  const expired = await tx
    .update(invitation)
    .set({ status: "expired" })
    .where(
      and(
        eq(invitation.businessId, businessId),
        eq(invitation.status, "pending"),
        lte(invitation.expiresAt, at),
      ),
    )
    .returning();
  for (const row of expired)
    await audit(tx, actor, businessId, "invitation.expired", row.id, at);
}

async function revokePendingInvitations(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  inviterId: string,
  at: Date,
) {
  const revoked = await tx
    .update(invitation)
    .set({ status: "revoked" })
    .where(
      and(
        eq(invitation.businessId, businessId),
        eq(invitation.createdBy, inviterId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning();
  for (const row of revoked)
    await audit(tx, actor, businessId, "invitation.revoked", row.id, at);
}

export function createTeamRepository(database: Database): TeamRepository {
  async function managed<T>(
    actor: Actor,
    id: string,
    at: Date,
    operation: (tx: Transaction, role: BusinessRole) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      id,
      async (tx) => {
        const role = await requireCapability(tx, actor, id, "team.manage");
        return operation(tx, role);
      },
      { at, lock: true },
    );
  }
  async function findInvitation(
    tx: Transaction,
    id: string,
    invitationId: string,
  ) {
    const [row] = await tx
      .select()
      .from(invitation)
      .where(
        and(eq(invitation.businessId, id), eq(invitation.id, invitationId)),
      );
    if (!row) throw new ApplicationError("NOT_FOUND");
    return row;
  }
  async function findMember(tx: Transaction, id: string, userId: string) {
    const [row] = await tx
      .select()
      .from(membership)
      .where(and(eq(membership.businessId, id), eq(membership.userId, userId)));
    if (!row) throw new ApplicationError("NOT_FOUND");
    return row;
  }
  async function recipientInvitation(tx: Transaction, hash: string, at: Date) {
    const [candidate] = await tx
      .select()
      .from(invitation)
      .where(eq(invitation.tokenHash, hash));
    if (!candidate) throw new ApplicationError("INVITATION_UNAVAILABLE");
    await lockBusiness(tx, candidate.businessId);
    await tx.execute(
      sql`select set_config('app.business_id', ${candidate.businessId}, true)`,
    );
    const row = await findInvitation(tx, candidate.businessId, candidate.id);
    const authority = await tx.execute<{ allowed: boolean }>(
      sql`select public.inviter_authorized(${row.createdBy}, ${row.role}) as allowed`,
    );
    if (
      row.status !== "pending" ||
      row.expiresAt <= at ||
      !authority.rows[0]?.allowed
    )
      throw new ApplicationError("INVITATION_UNAVAILABLE");
    return row;
  }
  return {
    createInvitation(actor, row, at) {
      return managed(actor, row.businessId, at, async (tx, role) => {
        mayManage(role, row.role);
        await expire(tx, actor, row.businessId, at);
        const [existing] = await tx
          .select({ id: invitation.id })
          .from(invitation)
          .where(
            and(
              eq(invitation.businessId, row.businessId),
              eq(invitation.email, row.email),
              eq(invitation.status, "pending"),
            ),
          );
        const [member] = await tx
          .select({ id: membership.userId })
          .from(membership)
          .innerJoin(user, eq(user.id, membership.userId))
          .where(
            and(
              eq(membership.businessId, row.businessId),
              sql`lower(${user.email}) = ${row.email}`,
            ),
          );
        if (existing || member) throw new ApplicationError("CONFLICT");
        const [profile] = await tx
          .select({ name: business.name })
          .from(business)
          .where(eq(business.id, row.businessId));
        const [created] = await tx
          .insert(invitation)
          .values({ ...row, businessName: profile.name })
          .returning();
        await audit(
          tx,
          actor,
          row.businessId,
          "invitation.created",
          row.id,
          at,
          row.role,
        );
        return publicInvitation(created);
      });
    },
    getTeam(actor, id, at) {
      return managed(actor, id, at, async (tx, role) => {
        await expire(tx, actor, id, at);
        const members = await tx
          .select({
            userId: membership.userId,
            email: user.email,
            role: membership.role,
            mfaEnrolled: user.twoFactorEnabled,
          })
          .from(membership)
          .innerJoin(user, eq(user.id, membership.userId))
          .where(eq(membership.businessId, id))
          .orderBy(asc(user.email));
        const invitations = await tx
          .select()
          .from(invitation)
          .where(eq(invitation.businessId, id))
          .orderBy(asc(invitation.createdAt), asc(invitation.id));
        return {
          actorId: actor.userId,
          role,
          members,
          invitations: invitations.map(publicInvitation),
        };
      });
    },
    accept(actor, hash, at) {
      return scoped(
        database,
        actor,
        "",
        async (tx) => {
          const row = await recipientInvitation(tx, hash, at);
          const [existing] = await tx
            .select()
            .from(membership)
            .where(
              and(
                eq(membership.businessId, row.businessId),
                eq(membership.userId, actor.userId),
              ),
            );
          if (existing) throw new ApplicationError("CONFLICT");
          await tx.insert(membership).values({
            businessId: row.businessId,
            userId: actor.userId,
            role: row.role,
          });
          await tx
            .update(invitation)
            .set({
              status: "accepted",
              acceptedBy: actor.userId,
              acceptedAt: at,
            })
            .where(eq(invitation.id, row.id));
          await audit(
            tx,
            actor,
            row.businessId,
            "invitation.accepted",
            row.id,
            at,
            row.role,
          );
          return { businessId: row.businessId };
        },
        { at, invitationHash: hash },
      );
    },
    preview(actor, hash, at) {
      return scoped(
        database,
        actor,
        "",
        async (tx) => {
          const row = await recipientInvitation(tx, hash, at);
          return {
            businessName: row.businessName,
            email: row.email,
            role: row.role,
            expiresAt: row.expiresAt,
          };
        },
        { at, invitationHash: hash },
      );
    },
    changeRole(actor, id, input, at) {
      return managed(actor, id, at, async (tx, role) => {
        const target = await findMember(tx, id, input.userId);
        mayManage(role, target.role);
        mayManage(role, input.role);
        if (target.role === input.role) return;
        await tx
          .update(membership)
          .set({ role: input.role })
          .where(
            and(
              eq(membership.businessId, id),
              eq(membership.userId, input.userId),
            ),
          );
        // Demotion invalidates outstanding grants immediately, even after a later promotion.
        await revokePendingInvitations(tx, actor, id, input.userId, at);
        await audit(
          tx,
          actor,
          id,
          "membership.role_changed",
          input.userId,
          at,
          `${target.role} -> ${input.role}`,
        );
      });
    },
    removeMember(actor, id, userId, at) {
      return managed(actor, id, at, async (tx, role) => {
        const target = await findMember(tx, id, userId);
        mayManage(role, target.role);
        await revokePendingInvitations(tx, actor, id, userId, at);
        await tx
          .delete(membership)
          .where(
            and(eq(membership.businessId, id), eq(membership.userId, userId)),
          );
        await audit(
          tx,
          actor,
          id,
          "membership.removed",
          userId,
          at,
          target.role,
        );
      });
    },
    revokeInvitation(actor, id, invitationId, at) {
      return managed(actor, id, at, async (tx, role) => {
        const row = await findInvitation(tx, id, invitationId);
        mayManage(role, row.role);
        if (row.status !== "pending") throw new ApplicationError("CONFLICT");
        await tx
          .update(invitation)
          .set({ status: "revoked" })
          .where(eq(invitation.id, invitationId));
        await audit(tx, actor, id, "invitation.revoked", invitationId, at);
      });
    },
    getAudit(actor, id) {
      return scoped(database, actor, id, async (tx) => {
        await requireCapability(tx, actor, id, "team.manage");
        return tx
          .select()
          .from(teamAudit)
          .where(eq(teamAudit.businessId, id))
          .orderBy(asc(teamAudit.at), asc(teamAudit.id));
      });
    },
    authorize(actor, id, capability) {
      return scoped(database, actor, id, (tx) =>
        requireCapability(tx, actor, id, capability),
      );
    },
    authorizePlatform(actor, capability) {
      return scoped(database, actor, "", async (tx) => {
        const [operator] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        if (
          !operator ||
          !(capability === "whatsapp.review"
            ? operator.whatsAppReview
            : capability === "pricing.manage"
              ? operator.pricing
              : capability === "tax.manage"
                ? operator.tax
                : operator.reconciliation)
        )
          throw new ApplicationError("FORBIDDEN");
      });
    },
    claimDelivery(actor, id, invitationId, at) {
      return managed(actor, id, at, async (tx, role) => {
        const row = await findInvitation(tx, id, invitationId);
        mayManage(role, row.role);
        const authority = await tx.execute<{ allowed: boolean }>(
          sql`select public.inviter_authorized(${row.createdBy}, ${row.role}) as allowed`,
        );
        if (
          row.status !== "pending" ||
          row.expiresAt <= at ||
          !authority.rows[0]?.allowed
        )
          throw new ApplicationError("INVITATION_UNAVAILABLE");
        if (row.delivery === "sent") return null;
        // Resend's idempotency window is 24 hours; do not retry beyond it.
        if (at.getTime() - row.createdAt.getTime() >= 86400000)
          throw new ApplicationError("CONFLICT");
        if (
          row.delivery === "sending" &&
          row.deliveryStartedAt &&
          at.getTime() - row.deliveryStartedAt.getTime() < 60000
        )
          throw new ApplicationError("CONFLICT");
        await tx
          .update(invitation)
          .set({ delivery: "sending", deliveryStartedAt: at })
          .where(eq(invitation.id, invitationId));
        return {
          invitation: publicInvitation(row),
          businessName: row.businessName,
        };
      });
    },
    finishDelivery(actor, id, invitationId, delivery, at) {
      return managed(actor, id, at, async (tx) => {
        await tx
          .update(invitation)
          .set({ delivery })
          .where(
            and(eq(invitation.businessId, id), eq(invitation.id, invitationId)),
          );
        await audit(
          tx,
          actor,
          id,
          `invitation.delivery_${delivery}`,
          invitationId,
          at,
        );
      });
    },
  };
}
