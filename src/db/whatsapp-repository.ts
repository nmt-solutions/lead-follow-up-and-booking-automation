import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type {
  WhatsAppConfiguration,
  WhatsAppView,
  MetaCompletion,
  MetaObservation,
  WhatsAppReason,
} from "../models/whatsapp";
import { whatsAppBilling } from "../models/whatsapp";
import { ApplicationError } from "../models/application-error";
import type { MetaProvider } from "../whatsapp/provider";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import { whatsAppConnection, whatsAppOauth, whatsAppEvent } from "./schema";

type Connection = typeof whatsAppConnection.$inferSelect;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

export function createWhatsAppRepository(database: Database, clock: Clock) {
  async function authorized<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction, canManage: boolean) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        // Credentials and account setup are restricted to current Owners/Admins, including reads.
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "integrations.manage",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return operation(tx, role !== "salesperson");
      },
      { lock: true },
    );
  }
  async function current(tx: Transaction, businessId: string) {
    const [row] = await tx
      .select()
      .from(whatsAppConnection)
      .where(eq(whatsAppConnection.businessId, businessId));
    return row;
  }
  async function update(
    tx: Transaction,
    row: Connection,
    values: Partial<Connection>,
  ) {
    await tx
      .update(whatsAppConnection)
      .set(values)
      .where(
        and(
          eq(whatsAppConnection.id, row.id),
          eq(whatsAppConnection.businessId, row.businessId),
        ),
      );
  }
  async function audit(
    tx: Transaction,
    actor: WorkIdentity,
    row: Connection,
    kind: string,
    terms: WhatsAppConfiguration | null = null,
  ) {
    await tx.insert(whatsAppEvent).values({
      id: randomUUID(),
      businessId: row.businessId,
      connectionId: row.id,
      actorId: actor.userId,
      kind,
      version: row.version,
      terms,
      at: clock.now(),
    });
  }
  function expected(
    row: Connection | undefined,
    version: number,
  ): asserts row is Connection {
    if (!row) throw new ApplicationError("NOT_FOUND");
    if (row.version !== version) throw new ApplicationError("CONFLICT");
  }
  return {
    ensureAccess: (actor: WorkIdentity, businessId: string) =>
      authorized(actor, businessId, async () => {}),
    async workspace(
      actor: WorkIdentity,
      businessId: string,
      provider: MetaProvider,
    ): Promise<WhatsAppView> {
      return authorized(actor, businessId, async (tx, canManage) => {
        const row = await current(tx, businessId);
        const issues: string[] = [];
        for (const [name, ready] of Object.entries(provider.setup))
          if (!ready && name !== "coexistence") issues.push(name);
        if (!row) issues.push("connection_required");
        if (row?.status !== "connected") issues.push("authorization_required");
        if (
          !row?.observation ||
          row.providerKey !== provider.key ||
          new Date(row.observation.validUntil) <= clock.now()
        )
          issues.push("current_provider_check_required");
        else
          for (const [name, check] of Object.entries(row.observation.checks)) {
            if (check !== "confirmed") issues.push(name);
          }
        if (
          row?.configuration.numberSource === "business_app" &&
          !provider.setup.coexistence
        )
          issues.push("unsupported_coexistence");
        return {
          canManage,
          setup: provider.setup,
          connection: row
            ? {
                id: row.id,
                version: row.version,
                configuration: row.configuration,
                status: row.status,
                reason: row.reason,
                termsAcceptedAt: row.termsAcceptedAt.toISOString(),
                observation: row.observation,
              }
            : null,
          readiness: {
            onboardingReady: issues.length === 0,
            automationReady: false,
            issues,
          },
          billing: whatsAppBilling,
        };
      });
    },
    save(
      actor: WorkIdentity,
      businessId: string,
      input: { expectedVersion: number; configuration: WhatsAppConfiguration },
    ) {
      return authorized(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        if ((row?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const data = {
          version: input.expectedVersion + 1,
          configuration: input.configuration,
          status: "setup_required" as const,
          reason: null,
          termsActorId: actor.userId,
          termsAcceptedAt: clock.now(),
          credentials: null,
          observation: null,
          providerKey: null,
          operationId: null,
          assets: null,
          phoneNumberId: null,
          coexistenceFinished: false,
        };
        if (row)
          await tx
            .update(whatsAppConnection)
            .set(data)
            .where(
              and(
                eq(whatsAppConnection.id, row.id),
                eq(whatsAppConnection.businessId, businessId),
              ),
            );
        else
          await tx
            .insert(whatsAppConnection)
            .values({ id: randomUUID(), businessId, ...data });
        const saved = await current(tx, businessId);
        if (!saved) throw new ApplicationError("CONFLICT");
        await audit(tx, actor, saved, "terms_saved", input.configuration);
        return { version: data.version };
      });
    },
    start(
      actor: WorkIdentity,
      businessId: string,
      version: number,
      provider: MetaProvider,
    ) {
      return authorized(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        expected(row, version);
        if (
          !provider.setup.configured ||
          !provider.login ||
          (row.configuration.numberSource === "business_app" &&
            !provider.setup.coexistence)
        )
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        const state = randomBytes(32).toString("hex");
        const nextVersion = version + 1;
        await update(tx, row, {
          version: nextVersion,
          status: "connecting",
          reason: null,
          operationId: null,
          credentials: null,
          observation: null,
          assets: null,
          phoneNumberId: null,
          providerKey: provider.key,
          coexistenceFinished: false,
        });
        await tx.insert(whatsAppOauth).values({
          id: randomUUID(),
          businessId,
          connectionId: row.id,
          version: nextVersion,
          stateHash: hash(state),
          actorId: actor.userId,
          sessionId: actor.sessionId,
          expiresAt: new Date(clock.now().getTime() + 10 * 60000),
        });
        await audit(
          tx,
          actor,
          { ...row, version: nextVersion },
          "signup_started",
        );
        return {
          state,
          version: nextVersion,
          login: provider.login,
          coexistence: row.configuration.numberSource === "business_app",
        };
      });
    },
    claim(
      actor: WorkIdentity,
      businessId: string,
      completion: MetaCompletion,
      provider: MetaProvider,
    ) {
      return authorized(actor, businessId, async (tx) => {
        const [oauth] = await tx
          .select()
          .from(whatsAppOauth)
          .where(
            and(
              eq(whatsAppOauth.businessId, businessId),
              eq(whatsAppOauth.stateHash, hash(completion.state)),
            ),
          );
        const row = await current(tx, businessId);
        if (
          !oauth ||
          oauth.consumed ||
          oauth.expiresAt <= clock.now() ||
          oauth.actorId !== actor.userId ||
          oauth.sessionId !== actor.sessionId ||
          !row ||
          oauth.connectionId !== row.id ||
          oauth.version !== row.version ||
          row.status !== "connecting" ||
          row.providerKey !== provider.key
        )
          throw new ApplicationError("CONFLICT");
        await tx
          .update(whatsAppOauth)
          .set({ consumed: true })
          .where(eq(whatsAppOauth.id, oauth.id));
        let reason: WhatsAppReason | null = null;
        if (completion.event === "CANCEL") reason = "consent_cancelled";
        else if (completion.event === "ERROR") reason = "consent_failed";
        else if (
          !completion.code ||
          !completion.assets ||
          completion.event === "FINISH_ONLY_WABA"
        )
          reason = "incomplete_setup";
        else if (
          completion.assets.portfolioId !== row.configuration.portfolioId
        )
          reason = "invalid_response";
        else if (
          row.configuration.numberSource === "business_app" &&
          (!provider.setup.coexistence ||
            completion.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")
        )
          reason = "unsupported_coexistence";
        else if (
          row.configuration.numberSource !== "business_app" &&
          completion.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
        )
          reason = "unsupported_coexistence";
        const operationId = randomUUID();
        await update(tx, row, {
          status: reason ? "setup_required" : "verifying",
          reason,
          operationId,
        });
        await audit(tx, actor, row, reason ?? "code_exchange_claimed");
        return { ...row, operationId, blocked: reason !== null };
      });
    },
    reserveCheck(
      actor: WorkIdentity,
      businessId: string,
      version: number,
      provider: MetaProvider,
      registration = false,
    ) {
      return authorized(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        expected(row, version);
        if (!provider.setup.configured)
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        if (
          row.status !== "connected" ||
          !row.credentials ||
          !row.assets ||
          row.providerKey !== provider.key
        )
          throw new ApplicationError("CONFLICT");
        if (
          registration &&
          (row.configuration.numberSource === "business_app" ||
            row.reason !== null ||
            !row.observation ||
            new Date(row.observation.validUntil) <= clock.now() ||
            row.observation.checks.customer_ownership !== "confirmed" ||
            row.observation.checks.permissions !== "confirmed" ||
            row.observation.checks.number_verified !== "confirmed" ||
            row.observation.checks.number_registered !== "missing")
        )
          throw new ApplicationError("CONFLICT");
        const operationId = randomUUID();
        await update(tx, row, {
          operationId,
          status: "verifying",
          observation: null,
          reason: null,
        });
        return { ...row, operationId };
      });
    },
    disconnect(actor: WorkIdentity, businessId: string, version: number) {
      return authorized(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        expected(row, version);
        await update(tx, row, {
          version: version + 1,
          status: "disconnected",
          credentials: null,
          assets: null,
          phoneNumberId: null,
          observation: null,
          reason: null,
          operationId: null,
          coexistenceFinished: false,
        });
        await audit(
          tx,
          actor,
          { ...row, version: version + 1 },
          "disconnected_locally",
        );
        return { version: version + 1 };
      });
    },
    finish(
      actor: WorkIdentity,
      row: Connection,
      data: {
        credentials: string | null;
        observation: MetaObservation | null;
        reason: WhatsAppReason | null;
        assets: Connection["assets"];
        coexistenceFinished: boolean;
      },
    ) {
      return authorized(actor, row.businessId, async (tx) => {
        const live = await current(tx, row.businessId);
        expected(live, row.version);
        if (live.operationId !== row.operationId || live.status !== "verifying")
          throw new ApplicationError("CONFLICT");
        const verifiedNumber =
          data.observation?.checks.customer_ownership === "confirmed" &&
          data.observation.checks.permissions === "confirmed"
            ? data.observation.phoneNumberId
            : live.phoneNumberId;
        await update(tx, live, {
          ...data,
          phoneNumberId: verifiedNumber,
          status: data.credentials ? "connected" : "reconnect_required",
          operationId: null,
        });
        await audit(tx, actor, live, data.reason ?? "assets_checked");
      });
    },
    recheck(actor: WorkIdentity, row: Connection) {
      return authorized(actor, row.businessId, async (tx) => {
        const live = await current(tx, row.businessId);
        expected(live, row.version);
        if (live.operationId !== row.operationId || live.status !== "verifying")
          throw new ApplicationError("CONFLICT");
      });
    },
  };
}
