import type { z } from "zod";
import { randomUUID } from "node:crypto";
import { ApplicationError } from "../models/application-error";
import { businessIdSchema, type Actor, type Clock } from "../models/business";
import {
  acceptSchema,
  capabilitySchema,
  changeRoleSchema,
  invitationIdSchema,
  inviteSchema,
  memberSchema,
  platformCapabilitySchema,
  type AuditEntry,
  type BusinessCapability,
  type BusinessRole,
  type Invitation,
  type InvitationMailer,
  type InvitationTokens,
  type PlatformCapability,
  type Team,
} from "../models/team";

export type TeamRepository = {
  createInvitation(
    actor: Actor,
    invitation: Invitation & { tokenHash: string },
    at: Date,
  ): Promise<Invitation>;
  getTeam(actor: Actor, id: string, at: Date): Promise<Team>;
  accept(actor: Actor, hash: string, at: Date): Promise<{ businessId: string }>;
  preview(
    actor: Actor,
    hash: string,
    at: Date,
  ): Promise<{
    businessName: string;
    role: Invitation["role"];
    email: string;
    expiresAt: Date;
  }>;
  changeRole(
    actor: Actor,
    id: string,
    input: z.infer<typeof changeRoleSchema>,
    at: Date,
  ): Promise<void>;
  removeMember(
    actor: Actor,
    id: string,
    userId: string,
    at: Date,
  ): Promise<void>;
  revokeInvitation(
    actor: Actor,
    id: string,
    invitationId: string,
    at: Date,
  ): Promise<void>;
  getAudit(actor: Actor, id: string): Promise<AuditEntry[]>;
  authorize(
    actor: Actor,
    id: string,
    capability: BusinessCapability,
  ): Promise<BusinessRole>;
  authorizePlatform(
    actor: Actor,
    capability: PlatformCapability,
  ): Promise<void>;
  claimDelivery(
    actor: Actor,
    id: string,
    invitationId: string,
    at: Date,
  ): Promise<{ invitation: Invitation; businessName: string } | null>;
  finishDelivery(
    actor: Actor,
    id: string,
    invitationId: string,
    delivery: "sent" | "unconfirmed",
    at: Date,
  ): Promise<void>;
};

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}

export function createTeamApplication<Credentials>(dependencies: {
  authenticate(credentials: Credentials): Promise<Actor>;
  // Separate, trusted adapter must verify a fresh MFA-backed platform session.
  authenticatePlatform(credentials: Credentials): Promise<Actor>;
  repository: TeamRepository;
  clock: Clock;
  tokens: InvitationTokens;
  mailer: InvitationMailer;
  origin: string;
}) {
  const { repository, clock } = dependencies;
  async function context(credentials: Credentials, businessId: unknown) {
    return {
      actor: await dependencies.authenticate(credentials),
      id: validate(businessIdSchema, businessId),
    };
  }
  async function deliver(actor: Actor, id: string, invitationId: string) {
    const claim = await repository.claimDelivery(
      actor,
      id,
      invitationId,
      clock.now(),
    );
    if (!claim) return;
    const url = new URL("/invitations", dependencies.origin);
    // Fragments stay out of access logs and Referer headers.
    url.hash = new URLSearchParams({
      token: dependencies.tokens.issue(invitationId),
    }).toString();
    let delivery: "sent" | "unconfirmed" = "sent";
    try {
      await dependencies.mailer.send({
        invitationId,
        email: claim.invitation.email,
        businessName: claim.businessName,
        role: claim.invitation.role,
        expiresAt: claim.invitation.expiresAt,
        url: url.toString(),
      });
    } catch {
      delivery = "unconfirmed";
    }
    await repository.finishDelivery(
      actor,
      id,
      invitationId,
      delivery,
      clock.now(),
    );
  }
  return {
    async invite(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const { actor, id } = await context(credentials, businessId);
      const input = validate(inviteSchema, value);
      const invitationId = randomUUID();
      const at = clock.now();
      await repository.createInvitation(
        actor,
        {
          id: invitationId,
          businessId: id,
          email: input.email,
          role: input.role,
          status: "pending",
          delivery: "pending",
          createdBy: actor.userId,
          createdAt: at,
          expiresAt: new Date(at.getTime() + input.expiresInDays * 86400000),
          tokenHash: dependencies.tokens.hash(
            dependencies.tokens.issue(invitationId),
          ),
        },
        at,
      );
      await deliver(actor, id, invitationId);
      const team = await repository.getTeam(actor, id, clock.now());
      const saved = team.invitations.find((x) => x.id === invitationId);
      if (!saved) throw new ApplicationError("CONFLICT");
      return saved;
    },
    async getTeam(credentials: Credentials, businessId: unknown) {
      const { actor, id } = await context(credentials, businessId);
      return repository.getTeam(actor, id, clock.now());
    },
    async accept(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticate(credentials);
      const { token } = validate(acceptSchema, value);
      return repository.accept(
        actor,
        dependencies.tokens.hash(token),
        clock.now(),
      );
    },
    async preview(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticate(credentials);
      const { token } = validate(acceptSchema, value);
      return repository.preview(
        actor,
        dependencies.tokens.hash(token),
        clock.now(),
      );
    },
    async changeRole(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const { actor, id } = await context(credentials, businessId);
      await repository.changeRole(
        actor,
        id,
        validate(changeRoleSchema, value),
        clock.now(),
      );
    },
    async removeMember(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const { actor, id } = await context(credentials, businessId);
      await repository.removeMember(
        actor,
        id,
        validate(memberSchema, value).userId,
        clock.now(),
      );
    },
    async revokeInvitation(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const { actor, id } = await context(credentials, businessId);
      await repository.revokeInvitation(
        actor,
        id,
        validate(invitationIdSchema, value).invitationId,
        clock.now(),
      );
    },
    async deliverInvitation(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const { actor, id } = await context(credentials, businessId);
      await deliver(
        actor,
        id,
        validate(invitationIdSchema, value).invitationId,
      );
    },
    async getAudit(credentials: Credentials, businessId: unknown) {
      const { actor, id } = await context(credentials, businessId);
      return repository.getAudit(actor, id);
    },
    async requireBusinessCapability(
      credentials: Credentials,
      businessId: unknown,
      value: unknown,
    ) {
      const { actor, id } = await context(credentials, businessId);
      const capability = validate(capabilitySchema, value);
      return {
        role: await repository.authorize(actor, id, capability),
        businessId: id,
        capability,
      };
    },
    async requirePlatformCapability(credentials: Credentials, value: unknown) {
      const actor = await dependencies.authenticatePlatform(credentials);
      const capability = validate(platformCapabilitySchema, value);
      await repository.authorizePlatform(actor, capability);
      return { capability };
    },
  };
}
