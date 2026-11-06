import { and, eq } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import { hasMfa } from "../auth/access";
import type { BusinessRole } from "../models/team";
import type { WorkIdentity } from "../models/discovery";
import type { Transaction } from "./scope";
import { session, user } from "./schema";

// Recheck persisted session/factor on the protected transaction connection.
// Avoid nested authentication transactions while holding the Business lock.
export async function requireSalesSession(
  tx: Transaction,
  identity: WorkIdentity,
  at: Date,
  role: BusinessRole,
) {
  const [current] = await tx
    .select({
      token: session.token,
      expiresAt: session.expiresAt,
      enrolled: user.twoFactorEnabled,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(session.userId, identity.userId),
      ),
    );
  if (!current || current.expiresAt <= at)
    throw new ApplicationError("UNAUTHENTICATED");
  if (
    (role !== "salesperson" || current.enrolled) &&
    !(await hasMfa(tx, current.token, at))
  )
    throw new ApplicationError("MFA_REQUIRED");
}
