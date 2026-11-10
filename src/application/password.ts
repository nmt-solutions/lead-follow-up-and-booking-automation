import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { createAuth } from "../auth/auth";
import {
  hasMfa,
  operatorMfaLifetime,
  type createSessionAccess,
} from "../auth/access";
import type { Database } from "../db/runtime";
import { account, session, twoFactor, user } from "../db/schema";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import { passwordSchema } from "../models/registration";

export function createPasswordApplication(options: {
  auth: ReturnType<typeof createAuth>;
  access: ReturnType<typeof createSessionAccess>;
  database: Database;
  clock: Clock;
}) {
  return {
    async save(headers: Headers, input: unknown) {
      const parsed = passwordSchema.safeParse(input);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await options.access.authenticatePlatform(headers);
      const identity = await options.access.primary(headers);
      if (!identity.user.emailVerified) throw new ApplicationError("FORBIDDEN");
      const context = await options.auth.$context;
      const password = await context.password.hash(parsed.data.password);
      await options.database.transaction(async (tx) => {
        // Serialize concurrent password changes and recheck persisted assurance
        // after hashing. A magic link alone never authorizes a password reset.
        const [owner] = await tx
          .select()
          .from(user)
          .where(eq(user.id, identity.user.id))
          .for("update");
        await tx
          .select({ id: twoFactor.id })
          .from(twoFactor)
          .where(eq(twoFactor.userId, identity.user.id))
          .for("update");
        await tx
          .select({ id: session.id })
          .from(session)
          .where(eq(session.id, identity.session.id))
          .for("update");
        if (!owner?.emailVerified) throw new ApplicationError("FORBIDDEN");
        if (
          !(await hasMfa(
            tx,
            identity.session.token,
            options.clock.now(),
            operatorMfaLifetime,
          ))
        )
          throw new ApplicationError("MFA_REQUIRED");
        const [credential] = await tx
          .select()
          .from(account)
          .where(
            and(
              eq(account.userId, owner.id),
              eq(account.providerId, "credential"),
            ),
          );
        if (credential)
          await tx
            .update(account)
            .set({ password, updatedAt: options.clock.now() })
            .where(eq(account.id, credential.id));
        else
          await tx.insert(account).values({
            id: randomUUID(),
            userId: owner.id,
            accountId: owner.id,
            providerId: "credential",
            password,
          });
        await tx
          .delete(session)
          .where(
            and(
              eq(session.userId, owner.id),
              ne(session.id, identity.session.id),
            ),
          );
      });
      return { saved: true };
    },
  };
}
