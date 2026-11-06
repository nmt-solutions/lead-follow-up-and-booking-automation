import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type {
  WhatsAppConfiguration,
  WhatsAppView,
  MetaCompletion,
  MetaObservation,
  WhatsAppReason,
  MetaEvidenceReview,
  MetaEvidenceRevocation,
  MetaEvidenceView,
} from "../models/whatsapp";
import {
  whatsAppBilling,
  metaEvidenceReviewSchema,
  metaEvidenceRevocationSchema,
} from "../models/whatsapp";
import { ApplicationError } from "../models/application-error";
import type { MetaProvider } from "../whatsapp/provider";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import { metaIntakeView } from "./whatsapp-intake-repository";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import {
  whatsAppConnection,
  whatsAppOauth,
  whatsAppEvent,
  whatsAppEvidence,
  platformOperator,
  membership,
  session,
  user,
} from "./schema";

type Connection = typeof whatsAppConnection.$inferSelect;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

export function createWhatsAppRepository(database: Database, clock: Clock) {
  async function reviewer<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        // Recheck persisted authority, session and factor inside the protected
        // transaction. The INSERT policy also requires the current reviewer grant.
        const [operator] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        if (!operator?.whatsAppReview) throw new ApplicationError("FORBIDDEN");
        const [currentSession] = await tx
          .select({ token: session.token, expiresAt: session.expiresAt })
          .from(session)
          .innerJoin(user, eq(user.id, session.userId))
          .where(
            and(
              eq(session.id, actor.sessionId),
              eq(session.userId, actor.userId),
            ),
          );
        if (!currentSession || currentSession.expiresAt <= clock.now())
          throw new ApplicationError("UNAUTHENTICATED");
        if (
          !(await hasMfa(
            tx,
            currentSession.token,
            clock.now(),
            operatorMfaLifetime,
          ))
        )
          throw new ApplicationError("MFA_REQUIRED");
        const [member] = await tx
          .select()
          .from(membership)
          .where(
            and(
              eq(membership.businessId, businessId),
              eq(membership.userId, actor.userId),
            ),
          );
        if (member) throw new ApplicationError("FORBIDDEN");
        return operation(tx);
      },
      { lock: true },
    );
  }
  async function evidence(
    tx: Transaction,
    businessId: string,
    row: Connection | undefined,
    provider: MetaProvider,
  ): Promise<MetaEvidenceView> {
    const rows = await tx
      .select()
      .from(whatsAppEvidence)
      .where(eq(whatsAppEvidence.businessId, businessId))
      .orderBy(asc(whatsAppEvidence.version));
    const history = rows.map((r) => {
      const review = metaEvidenceReviewSchema.safeParse(r.review);
      const revocation = metaEvidenceRevocationSchema.safeParse(r.revocation);
      return {
        id: r.id,
        version: r.version,
        connectionId: r.connectionId,
        actorId: r.actorId,
        at: r.at.toISOString(),
        review: review.success ? review.data : null,
        revocation: revocation.success ? revocation.data : null,
        invalid:
          (r.review !== null && !review.success) ||
          (r.revocation !== null && !revocation.success),
      };
    });
    const latest = rows.filter((r) => r.review !== null).at(-1);
    const parsed = metaEvidenceReviewSchema.safeParse(latest?.review);
    const review = parsed.success ? parsed.data : null;
    let status: MetaEvidenceView["status"] = "missing";
    if (latest && !review) status = "stale";
    if (latest && review) {
      if (history.some((r) => r.version >= latest.version && r.invalid))
        status = "stale";
      else if (history.some((r) => r.revocation?.reviewId === latest.id))
        status = "revoked";
      else if (new Date(review.validUntil) <= clock.now()) status = "expired";
      else if (
        !row ||
        latest.at > clock.now() ||
        new Date(review.validUntil) <= latest.at ||
        [review.controlEvidence, review.paymentEvidence].some(
          (e) =>
            new Date(e.observedAt) > latest.at ||
            new Date(e.observedAt) < row.termsAcceptedAt,
        ) ||
        row.status !== "connected" ||
        !row.credentials ||
        !row.assets ||
        row.id !== review.connectionId ||
        latest.connectionId !== review.connectionId ||
        latest.version !== review.expectedEvidenceVersion + 1 ||
        row.version !== review.expectedVersion ||
        row.providerKey !== review.providerKey ||
        provider.key !== review.providerKey ||
        row.configuration.requestedNumber !== review.requestedNumber ||
        row.assets.portfolioId !== review.assets.portfolioId ||
        row.assets.wabaId !== review.assets.wabaId ||
        row.assets.phoneNumberId !== review.assets.phoneNumberId
      )
        status = "stale";
      else status = "approved";
    }
    return {
      version: rows.at(-1)?.version ?? 0,
      status,
      provenance: status === "approved" ? "assisted_review" : "unverified",
      history,
    };
  }
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
  async function workspace(
    tx: Transaction,
    businessId: string,
    provider: MetaProvider,
    canManage: boolean,
  ): Promise<WhatsAppView> {
    const row = await current(tx, businessId);
    const paymentEvidence = await evidence(tx, businessId, row, provider);
    const intake = await metaIntakeView(tx, businessId);
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
        if (
          check !== "confirmed" &&
          !(
            name === "customer_payment_method" &&
            check === "unknown" &&
            paymentEvidence.status === "approved"
          )
        )
          issues.push(name);
      }
    if (
      row?.configuration.numberSource === "business_app" &&
      !provider.setup.coexistence
    )
      issues.push("unsupported_coexistence");
    return {
      canManage,
      intake,
      paymentEvidence,
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
            assets: row.assets,
            providerKey: row.providerKey,
          }
        : null,
      readiness: {
        onboardingReady: issues.length === 0,
        automationReady:
          issues.length === 0 &&
          provider.sendingAvailable === true &&
          provider.outboundWorkerReady === true &&
          intake.enabled &&
          intake.inboundObserved &&
          intake.manualObserved &&
          !intake.gap,
        inboundReady: intake.enabled && intake.inboundObserved,
        manualVisibilityReady:
          intake.enabled &&
          intake.replyVisibility === "supported_app_events" &&
          !intake.gap,
        sendingReady:
          issues.length === 0 &&
          provider.sendingAvailable === true &&
          provider.outboundWorkerReady === true &&
          intake.enabled &&
          intake.inboundObserved &&
          intake.manualObserved &&
          !intake.gap,
        issues,
      },
      billing: whatsAppBilling,
    };
  }
  return {
    workspaceAt: (
      tx: Transaction,
      businessId: string,
      provider: MetaProvider,
    ) => workspace(tx, businessId, provider, false),
    ensureAccess: (actor: WorkIdentity, businessId: string) =>
      authorized(actor, businessId, async () => {}),
    workspace(actor: WorkIdentity, businessId: string, provider: MetaProvider) {
      return authorized(actor, businessId, (tx, canManage) =>
        workspace(tx, businessId, provider, canManage),
      );
    },
    reviewWorkspace(
      actor: WorkIdentity,
      businessId: string,
      provider: MetaProvider,
    ) {
      return reviewer(actor, businessId, (tx) =>
        workspace(tx, businessId, provider, false),
      );
    },
    approveEvidence(
      actor: WorkIdentity,
      businessId: string,
      input: MetaEvidenceReview,
      provider: MetaProvider,
    ) {
      return reviewer(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        expected(row, input.expectedVersion);
        const prior = await evidence(tx, businessId, row, provider);
        if (
          prior.version !== input.expectedEvidenceVersion ||
          row.id !== input.connectionId ||
          row.providerKey !== input.providerKey ||
          provider.key !== input.providerKey ||
          row.status !== "connected" ||
          !row.credentials ||
          !row.assets ||
          row.configuration.requestedNumber !== input.requestedNumber ||
          row.assets.portfolioId !== input.assets.portfolioId ||
          row.assets.wabaId !== input.assets.wabaId ||
          row.assets.phoneNumberId !== input.assets.phoneNumberId
        )
          throw new ApplicationError("CONFLICT");
        if (
          !row.observation ||
          new Date(row.observation.validUntil) <= clock.now() ||
          row.observation.checks.customer_ownership !== "confirmed" ||
          row.observation.checks.permissions !== "confirmed" ||
          row.observation.checks.number_verified !== "confirmed"
        )
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        if (
          new Date(input.validUntil) <= clock.now() ||
          [input.controlEvidence, input.paymentEvidence].some(
            (e) =>
              new Date(e.observedAt) > clock.now() ||
              new Date(e.observedAt) < row.termsAcceptedAt,
          )
        )
          throw new ApplicationError("INVALID_INPUT");
        await tx.insert(whatsAppEvidence).values({
          id: randomUUID(),
          businessId,
          connectionId: row.id,
          version: prior.version + 1,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          at: clock.now(),
          review: input,
        });
        return workspace(tx, businessId, provider, false);
      });
    },
    revokeEvidence(
      actor: WorkIdentity,
      businessId: string,
      input: MetaEvidenceRevocation,
      provider: MetaProvider,
    ) {
      return reviewer(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        expected(row, input.expectedVersion);
        const prior = await evidence(tx, businessId, row, provider);
        const approval = prior.history.find(
          (e) => e.id === input.reviewId && e.review,
        );
        if (
          prior.version !== input.expectedEvidenceVersion ||
          !approval ||
          prior.history.some((e) => e.revocation?.reviewId === input.reviewId)
        )
          throw new ApplicationError("CONFLICT");
        await tx.insert(whatsAppEvidence).values({
          id: randomUUID(),
          businessId,
          connectionId: row.id,
          version: prior.version + 1,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          at: clock.now(),
          revocation: input,
        });
        return workspace(tx, businessId, provider, false);
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
