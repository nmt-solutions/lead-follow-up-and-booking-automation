import { and, eq } from "drizzle-orm";
import type { Transaction } from "./scope";
import { whatsAppOutbound } from "./schema";

/** Only an immutable local intent plus exact native acceptance reference establishes application origin. A marker or status alone never does. */
export async function resolveMetaOutgoing(tx: Transaction, businessId: string, inboxConnectionId: string, peer: string, messageRef: string) {
  const rows = await tx.select().from(whatsAppOutbound).where(eq(whatsAppOutbound.businessId,businessId));
  const actions = new Set(rows.flatMap((r) => r.data.kind === "result" && r.data.result.status === "accepted" && r.data.result.messageRef === messageRef && r.data.result.peer === peer ? [r.data.actionId] : []));
  const intents = rows.flatMap((r) => r.data.kind === "intent" && actions.has(r.data.intent.actionId) && r.data.intent.peer === peer && r.data.intent.inboxConnectionId === inboxConnectionId ? [r.data.intent] : []);
  return intents.length === 1 ? intents[0] : null;
}
