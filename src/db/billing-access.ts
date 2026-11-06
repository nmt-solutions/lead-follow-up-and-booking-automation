import { eq, sql } from "drizzle-orm";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import type { Transaction } from "./scope";
import { platformOperator } from "./schema";

export async function requireBillingReviewer(tx: Transaction, actor: Actor) {
  const [operator] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!operator?.tax) throw new ApplicationError("FORBIDDEN");
  await tx.execute(sql`select set_config('app.billing_review', 'true', true)`);
}
