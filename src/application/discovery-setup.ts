import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/runtime";
import { scoped, requireCapability } from "../db/scope";
import {
  discoveryConfiguration,
  platformOperator,
  session,
  teamAudit,
} from "../db/schema";
import { discoveryPolicySchema } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import { hasMfa, operatorMfaLifetime } from "../auth/access";

const provisioningSchema = z.strictObject({
  businessId: z.uuid(),
  operator: z.strictObject({
    userId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
  }),
  policy: discoveryPolicySchema,
});

/** Schema-owner CLI seam only. Never expose this connection through a handler.
 * Deployment credentials and executed agreement evidence remain operator-owned.
 * The CLI file identifies the current, persisted MFA session for attribution;
 * authorization to run it also requires the schema-owner database connection.
 */
export function createDiscoverySetup(database: Database, clock: Clock) {
  return async (input: unknown) => {
    const parsed = provisioningSchema.safeParse(input);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
    const { operator, businessId, policy } = parsed.data;
    return scoped(
      database,
      operator,
      businessId,
      async (tx) => {
        await requireCapability(
          tx,
          operator,
          businessId,
          "integrations.manage",
        );
        const [grant] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, operator.userId));
        if (!grant?.discovery) throw new ApplicationError("FORBIDDEN");
        const [identity] = await tx
          .select()
          .from(session)
          .where(
            and(
              eq(session.id, operator.sessionId),
              eq(session.userId, operator.userId),
            ),
          );
        if (!identity || identity.expiresAt <= clock.now())
          throw new ApplicationError("UNAUTHENTICATED");
        if (
          !(await hasMfa(tx, identity.token, clock.now(), operatorMfaLifetime))
        )
          throw new ApplicationError("MFA_REQUIRED");
        await tx
          .insert(discoveryConfiguration)
          .values({ businessId, policy })
          .onConflictDoUpdate({
            target: discoveryConfiguration.businessId,
            set: { policy },
          });
        await tx.insert(teamAudit).values({
          id: crypto.randomUUID(),
          businessId,
          actorId: operator.userId,
          action: "discovery.policy_configured",
          subjectId: businessId,
          detail: policy.exa
            ? `Exa scope: ${policy.exa.scopeRef}`
            : "Discovery policy",
          at: clock.now(),
        });
      },
      { lock: true },
    );
  };
}
