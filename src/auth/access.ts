import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { createAuth } from "./auth";
import type { Database } from "../db/runtime";
import {
  membership,
  platformOperator,
  session,
  twoFactor,
  user,
} from "../db/schema";
import { scoped } from "../db/scope";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { SecurityStatus } from "../models/security";
import type { WorkIdentity } from "../models/discovery";
import { and } from "drizzle-orm";

export const businessMfaLifetime = 12 * 60 * 60 * 1000;
export const operatorMfaLifetime = 15 * 60 * 1000;
export function factorVersion(encryptedSecret: string) {
  return createHash("sha256").update(encryptedSecret).digest("hex");
}

export function privilegedRoles(database: Database, userId: string) {
  return scoped(database, { userId }, "", async (tx) => {
    const members = await tx
      .select({ role: membership.role })
      .from(membership)
      .where(eq(membership.userId, userId));
    const [operator] = await tx
      .select()
      .from(platformOperator)
      .where(eq(platformOperator.userId, userId));
    return {
      business: members.some(
        ({ role }) => role === "owner" || role === "admin",
      ),
      operator: Boolean(
        operator?.tax ||
        operator?.reconciliation ||
        operator?.refunds ||
        operator?.ai ||
        operator?.discovery ||
        operator?.emailPolicy ||
        operator?.pricing ||
        operator?.whatsAppReview ||
        operator?.senderHealth ||
        operator?.documents ||
        operator?.operations ||
        operator?.recovery ||
        operator?.costs ||
        operator?.notifications,
      ),
    };
  });
}

// Check the authoritative session and current factor together. Client fields,
// cached cookies, role claims and trusted-device cookies cannot establish MFA.
export async function hasMfa(
  database: Pick<Database, "select">,
  token: string,
  at: Date,
  maxAge = businessMfaLifetime,
) {
  const [proof] = await database
    .select({
      verifiedAt: session.mfaVerifiedAt,
      factorId: session.mfaFactorId,
      factorVersion: session.mfaFactorVersion,
      encryptedSecret: twoFactor.secret,
      expiresAt: session.expiresAt,
      id: twoFactor.id,
      verified: twoFactor.verified,
      enabled: user.twoFactorEnabled,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .innerJoin(twoFactor, eq(twoFactor.userId, user.id))
    .where(eq(session.token, token));
  if (!proof?.verifiedAt) return false;
  const age = at.getTime() - proof.verifiedAt.getTime();
  return Boolean(
    proof.enabled &&
    proof.verified &&
    proof.factorId === proof.id &&
    proof.factorVersion === factorVersion(proof.encryptedSecret) &&
    proof.expiresAt > at &&
    age >= 0 &&
    age < maxAge,
  );
}

export async function authenticateQueuedActor(
  database: Database,
  clock: Clock,
  identity: WorkIdentity,
) {
  const [current] = await database
    .select()
    .from(session)
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(session.userId, identity.userId),
      ),
    );
  if (!current || current.expiresAt <= clock.now())
    throw new ApplicationError("UNAUTHENTICATED");
  const roles = await privilegedRoles(database, identity.userId);
  const [account] = await database
    .select({ enrolled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.id, identity.userId));
  if (
    (roles.business || roles.operator || account?.enrolled) &&
    !(await hasMfa(database, current.token, clock.now()))
  )
    throw new ApplicationError("MFA_REQUIRED");
  return { userId: identity.userId };
}

export function createSessionAccess(options: {
  auth: ReturnType<typeof createAuth>;
  database: Database;
  clock: Clock;
}) {
  const { auth, database, clock } = options;
  async function primary(headers: Headers) {
    const identity = await auth.api.getSession({ headers });
    if (!identity) throw new ApplicationError("UNAUTHENTICATED");
    return identity;
  }
  async function status(headers: Headers): Promise<SecurityStatus> {
    const identity = await primary(headers);
    const roles = await privilegedRoles(database, identity.user.id);
    const verified = await hasMfa(
      database,
      identity.session.token,
      clock.now(),
    );
    const operatorVerified = await hasMfa(
      database,
      identity.session.token,
      clock.now(),
      operatorMfaLifetime,
    );
    return {
      email: identity.user.email,
      enrolled: Boolean(identity.user.twoFactorEnabled),
      required: roles.business || roles.operator,
      verified,
      // This is the MFA prerequisite, not a claim that all production setup is ready.
      readiness:
        verified && (!roles.operator || operatorVerified)
          ? "mfa-satisfied"
          : "mfa-incomplete",
      operatorVerified,
      operator: roles.operator,
    };
  }
  async function authenticate(headers: Headers) {
    const identity = await primary(headers);
    const state = await status(headers);
    if ((state.required || state.enrolled) && !state.verified)
      throw new ApplicationError("MFA_REQUIRED");
    return { userId: identity.user.id };
  }
  async function privileged(headers: Headers, maxAge = businessMfaLifetime) {
    const identity = await primary(headers);
    if (!(await hasMfa(database, identity.session.token, clock.now(), maxAge)))
      throw new ApplicationError("MFA_REQUIRED");
    return { userId: identity.user.id };
  }
  async function authenticateWork(identity: WorkIdentity) {
    return authenticateQueuedActor(database, clock, identity);
  }
  return {
    primary,
    status,
    authenticate,
    authenticateForWork: async (headers: Headers) => {
      const actor = await authenticate(headers);
      const identity = await primary(headers);
      return { ...actor, sessionId: identity.session.id };
    },
    authenticateWork,
    authenticatePrivileged: (headers: Headers) => privileged(headers),
    authenticatePlatform: (headers: Headers) =>
      privileged(headers, operatorMfaLifetime),
    authenticatePlatformForWork: async (headers: Headers) => {
      const actor = await privileged(headers, operatorMfaLifetime);
      const identity = await primary(headers);
      if (identity.user.id !== actor.userId)
        throw new ApplicationError("UNAUTHENTICATED");
      return { ...actor, sessionId: identity.session.id };
    },
  };
}
