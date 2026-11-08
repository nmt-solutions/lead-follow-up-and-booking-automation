import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { ApplicationError } from "../models/application-error";
import {
  notificationTermsSchema,
  type NotificationConfiguration,
  type NotificationProvider,
} from "../models/notifications";
import { runtimeDatabase } from "../db/runtime";
import { notificationTerms, platformOperator } from "../db/schema";
import { createNotificationRepository } from "../db/notification-repository";
import { createResendProvider } from "../notifications/resend";

/** Owner CLI only: resolves first-login setup without granting session/MFA authority. */
export async function bootstrapNotificationSetup(d: {
  owner: Pool;
  configuration: NotificationConfiguration;
  approverId: string;
  terms: unknown;
  provider?: NotificationProvider;
}) {
  const role = await d.owner.query<{ owner: boolean }>(
    "select pg_has_role(current_user,c.relowner,'MEMBER') as owner from pg_class c where c.oid='public.notification_terms'::regclass",
  );
  if (role.rows[0]?.owner !== true) throw new ApplicationError("FORBIDDEN");
  const parsed = notificationTermsSchema.safeParse(d.terms);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  const database = runtimeDatabase(d.owner),
    repository = createNotificationRepository(database),
    actor = { userId: d.approverId },
    config = d.configuration;
  const [approver] = await database
    .select()
    .from(platformOperator)
    .where(
      and(
        eq(platformOperator.userId, actor.userId),
        eq(platformOperator.notifications, true),
      ),
    );
  if (!approver) throw new ApplicationError("FORBIDDEN");
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  const binding = {
    account: config.account,
    mode: config.mode,
    from: config.from,
    domainId: config.domainId,
    keyRef: hash(config.apiKey),
    receiverRef: config.webhookSecret ? hash(config.webhookSecret) : "",
  };
  const inspection = await repository.beginSetup(actor, binding);
  const setup = await (d.provider ?? createResendProvider(config)).inspect();
  await repository.saveSetup(actor, binding, inspection, setup);
  if (
    !setup.sendingReady ||
    setup.readAccess !== "verified" ||
    !setup.usage ||
    (parsed.data.kind === "free" && setup.usage.emails.daily.limit === null)
  )
    throw new ApplicationError("SETUP_REQUIRED");
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`notification:${config.account}`},0))`,
    );
    const [current] = await tx
      .select()
      .from(platformOperator)
      .where(
        and(
          eq(platformOperator.userId, actor.userId),
          eq(platformOperator.notifications, true),
        ),
      )
      .for("share");
    if (!current) throw new ApplicationError("FORBIDDEN");
    await tx.insert(notificationTerms).values({
      id: randomUUID(),
      account: config.account,
      actorId: actor.userId,
      terms: parsed.data,
      authBootstrap: true,
      at: sql`statement_timestamp()`,
    });
  });
  return { nativeReadVerified: true, authOnly: true, emailSent: false };
}
