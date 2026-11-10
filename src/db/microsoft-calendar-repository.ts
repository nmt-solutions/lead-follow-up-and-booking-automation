import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { microsoftCalendarGrant, microsoftCalendarOauth } from "./schema";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  microsoftCalendarScopes,
  type MicrosoftCalendarView,
  type MicrosoftIdentity,
} from "../models/microsoft-calendar";
import type { MicrosoftCalendarConfiguration } from "../microsoft-calendar/configuration";
import { calendarCredentialVault as microsoftCredentialVault } from "../appointments/credentials";
import {
  createMicrosoftHttp,
  MicrosoftCalendarFailure,
  type MicrosoftToken,
} from "../microsoft-calendar/http";
import { session } from "./schema";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import { requireSalesSession } from "./opportunity-control-repository";

type Grant = typeof microsoftCalendarGrant.$inferSelect;
const storedTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function createMicrosoftCalendarRepository(
  database: Database,
  options: {
    clock: Clock;
    configuration: MicrosoftCalendarConfiguration | null;
    fetch: typeof fetch;
  },
) {
  const { clock, configuration } = options;
  const http = configuration
    ? createMicrosoftHttp(configuration, options.fetch)
    : null;
  const vault = configuration ? microsoftCredentialVault(configuration) : null;
  function identity(g: Grant): MicrosoftIdentity {
    if (!g.accountKind || !g.accountSubject || !g.tenantId || !g.accountEmail)
      throw new MicrosoftCalendarFailure("insufficient");
    return {
      subject: g.accountSubject,
      tenantId: g.tenantId,
      accountKind: g.accountKind,
      email: g.accountEmail,
    };
  }
  const aad = (g: Grant) => `microsoft-calendar:${g.businessId}:${g.id}`;
  async function active(tx: Transaction, businessId: string) {
    const [g] = await tx
      .select()
      .from(microsoftCalendarGrant)
      .where(
        and(
          eq(microsoftCalendarGrant.businessId, businessId),
          ne(microsoftCalendarGrant.status, "disconnected"),
        ),
      );
    return g;
  }
  async function update(
    tx: Transaction,
    g: Grant,
    data: Partial<
      Pick<
        Grant,
        | "generation"
        | "status"
        | "reason"
        | "accountSubject"
        | "accountEmail"
        | "selectedCalendarId"
        | "credentials"
        | "accountKind"
        | "tenantId"
        | "scopes"
        | "authorizedAt"
        | "actorId"
        | "at"
      >
    >,
  ) {
    await tx
      .update(microsoftCalendarGrant)
      .set(data)
      .where(
        and(
          eq(microsoftCalendarGrant.id, g.id),
          eq(microsoftCalendarGrant.businessId, g.businessId),
        ),
      );
    Object.assign(g, data);
  }
  async function failure(tx: Transaction, g: Grant, error: unknown) {
    const reason =
      error instanceof MicrosoftCalendarFailure ? error.reason : "unavailable";
    if (reason === "revoked" || reason === "insufficient")
      await update(tx, g, {
        status: reason === "revoked" ? "reconnect_required" : "insufficient",
        reason,
        ...(reason === "revoked" ? { credentials: null } : {}),
      });
    else await update(tx, g, { reason });
    return reason;
  }
  function decode(g: Grant) {
    if (!vault || !g.credentials) throw new MicrosoftCalendarFailure("revoked");
    try {
      return storedTokens.parse(
        JSON.parse(vault.decrypt(g.credentials, aad(g))),
      );
    } catch {
      throw new MicrosoftCalendarFailure("unavailable");
    }
  }
  function scopes(token: MicrosoftToken, previous: string[] = []) {
    return token.scope === undefined
      ? previous
      : token.scope.split(/\s+/).filter(Boolean);
  }
  function sufficient(granted: string[]) {
    return ["User.Read", "Calendars.ReadWrite"].every(
      (s) =>
        granted.includes(s) ||
        granted.includes(`https://graph.microsoft.com/${s}`),
    );
  }
  async function accessToken(tx: Transaction, g: Grant) {
    if (
      !http ||
      !vault ||
      !["ready", "selection_required"].includes(g.status) ||
      !sufficient(g.scopes)
    )
      throw new MicrosoftCalendarFailure("insufficient");
    const current = decode(g);
    if (current.expiresAt > clock.now().getTime() + 60000)
      return current.accessToken;
    const token = await http.token({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
    });
    const granted = scopes(token, g.scopes);
    await update(tx, g, {
      credentials: vault.encrypt(
        JSON.stringify({
          accessToken: token.access_token,
          refreshToken: token.refresh_token ?? current.refreshToken,
          expiresAt: clock.now().getTime() + token.expires_in * 1000,
        }),
        aad(g),
      ),
      scopes: granted,
    });
    if (!sufficient(granted))
      throw new MicrosoftCalendarFailure("insufficient");
    return token.access_token;
  }
  async function authorized<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
    recent = false,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        async function check() {
          const currentRole = await requireCapability(
            tx,
            actor,
            businessId,
            "integrations.manage",
          );
          await requireSalesSession(tx, actor, clock.now(), currentRole);
          if (recent) {
            const [current] = await tx
              .select({ token: session.token })
              .from(session)
              .where(
                and(
                  eq(session.id, actor.sessionId),
                  eq(session.userId, actor.userId),
                ),
              );
            if (
              !current ||
              !(await hasMfa(
                tx,
                current.token,
                clock.now(),
                operatorMfaLifetime,
              ))
            )
              throw new ApplicationError("MFA_REQUIRED");
          }
        }
        await check();
        const result = await operation(tx);
        await check();
        return result;
      },
      { lock: true },
    );
  }
  async function view(
    tx: Transaction,
    businessId: string,
  ): Promise<MicrosoftCalendarView> {
    let g = await active(tx, businessId);
    if (!g)
      [g] = await tx
        .select()
        .from(microsoftCalendarGrant)
        .where(eq(microsoftCalendarGrant.businessId, businessId))
        .orderBy(desc(microsoftCalendarGrant.at))
        .limit(1);
    let calendars: MicrosoftCalendarView["calendars"] = [];
    if (g && http && ["ready", "selection_required"].includes(g.status)) {
      try {
        calendars = await http.calendars(await accessToken(tx, g), identity(g));
        if (
          g.selectedCalendarId &&
          !calendars.some((c) => c.id === g.selectedCalendarId)
        )
          await update(tx, g, {
            status: "insufficient",
            reason: "calendar_access_lost",
          });
        else await update(tx, g, { reason: null });
      } catch (error) {
        await failure(tx, g, error);
      }
    }
    return {
      configured: Boolean(configuration),
      setupReason: configuration
        ? null
        : "Microsoft Calendar requires approved OAuth project configuration and encryption keys. Ask the operator to finish setup.",
      status: g?.status ?? "not_connected",
      reason: g?.reason ?? null,
      connectionId: g?.id ?? null,
      accountEmail: g?.accountEmail ?? null,
      accountKind: g?.accountKind ?? null,
      tenantId: g?.tenantId ?? null,
      selectedCalendarId: g?.selectedCalendarId ?? null,
      calendars,
      grantedScopes: g?.scopes ?? [],
      authorizedAt: g?.authorizedAt?.toISOString() ?? null,
    };
  }
  const security = <T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) => authorized(actor, businessId, operation, true);
  return {
    active,
    identity,
    update,
    failure,
    accessToken,
    http,
    read: (actor: WorkIdentity, businessId: string) =>
      authorized(actor, businessId, (tx) => view(tx, businessId)),
    async start(actor: WorkIdentity, businessId: string, returnPath: string) {
      return security(actor, businessId, async (tx) => {
        if (!configuration || !vault)
          throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
        let g = await active(tx, businessId);
        if (!g)
          [g] = await tx
            .insert(microsoftCalendarGrant)
            .values({
              id: randomUUID(),
              businessId,
              generation: 1,
              status: "connecting",
              scopes: [],
              actorId: actor.userId,
              at: clock.now(),
            })
            .returning();
        else
          await update(tx, g, {
            generation: g.generation + 1,
            status: "connecting",
            reason: null,
          });
        const state = randomBytes(32).toString("hex");
        const verifier = randomBytes(32).toString("base64url");
        await tx.insert(microsoftCalendarOauth).values({
          id: randomUUID(),
          businessId,
          connectionId: g.id,
          generation: g.generation,
          stateHash: digest(state),
          verifier: vault.encrypt(verifier, `${aad(g)}:${digest(state)}`),
          actorId: actor.userId,
          sessionId: actor.sessionId,
          returnPath,
          expiresAt: new Date(clock.now().getTime() + 10 * 60000),
        });
        const url = new URL(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        );
        url.search = new URLSearchParams({
          client_id: configuration.clientId,
          redirect_uri: `${configuration.origin}${configuration.redirectPath ?? `/api/businesses/${businessId}/calendar/microsoft/callback`}`,
          response_type: "code",
          scope: microsoftCalendarScopes.join(" "),
          state,
          prompt: "consent",
          nonce: digest(`${state}:${verifier}`),
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        }).toString();
        return { authorizationUrl: url.toString() };
      });
    },
    async callback(
      actor: WorkIdentity,
      businessId: string,
      input: { state: string; code?: string; error?: string },
    ) {
      // Consumption commits before any exchange: errors, process loss and replay can never exchange twice.
      const state = await security(actor, businessId, async (tx) => {
        const [s] = await tx
          .select()
          .from(microsoftCalendarOauth)
          .where(
            and(
              eq(microsoftCalendarOauth.businessId, businessId),
              eq(microsoftCalendarOauth.stateHash, digest(input.state)),
            ),
          );
        const g = await active(tx, businessId);
        if (
          !s ||
          !g ||
          s.connectionId !== g.id ||
          s.generation !== g.generation ||
          s.consumed ||
          s.expiresAt <= clock.now() ||
          s.actorId !== actor.userId ||
          s.sessionId !== actor.sessionId
        )
          throw new ApplicationError("INVALID_INPUT");
        await tx
          .update(microsoftCalendarOauth)
          .set({ consumed: true })
          .where(eq(microsoftCalendarOauth.id, s.id));
        return s;
      });
      return security(actor, businessId, async (tx) => {
        const g = await active(tx, businessId);
        if (
          !g ||
          g.id !== state.connectionId ||
          g.generation !== state.generation
        )
          throw new ApplicationError("INVALID_INPUT");
        if (!configuration || !http || !vault)
          throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
        if (input.error || !input.code) {
          await update(tx, g, {
            status: "reconnect_required",
            reason: "consent_denied",
          });
          return { returnPath: state.returnPath };
        }
        let token: MicrosoftToken | undefined;
        try {
          token = await http.token({
            code: input.code,
            code_verifier: vault.decrypt(
              state.verifier,
              `${aad(g)}:${state.stateHash}`,
            ),
            grant_type: "authorization_code",
            redirect_uri: `${configuration.origin}${configuration.redirectPath ?? `/api/businesses/${businessId}/calendar/microsoft/callback`}`,
          });
          const granted = scopes(token);
          if (!sufficient(granted))
            throw new MicrosoftCalendarFailure("insufficient");
          const account = await http.identity(
            token,
            digest(
              `${input.state}:${vault.decrypt(state.verifier, `${aad(g)}:${state.stateHash}`)}`,
            ),
            clock.now(),
          );
          if (
            g.accountSubject &&
            (g.accountSubject !== account.subject ||
              g.tenantId !== account.tenantId)
          )
            throw new MicrosoftCalendarFailure("insufficient");
          const refreshToken =
            token.refresh_token ??
            (g.credentials ? decode(g).refreshToken : null);
          if (!refreshToken) throw new MicrosoftCalendarFailure("revoked");
          await update(tx, g, {
            accountSubject: account.subject,
            accountEmail: account.email,
            accountKind: account.accountKind,
            tenantId: account.tenantId,
            scopes: granted,
            authorizedAt: clock.now(),
            actorId: actor.userId,
            credentials: vault.encrypt(
              JSON.stringify({
                accessToken: token.access_token,
                refreshToken,
                expiresAt: clock.now().getTime() + token.expires_in * 1000,
              }),
              aad(g),
            ),
            status: g.selectedCalendarId ? "ready" : "selection_required",
            reason: null,
          });
          await view(tx, businessId);
        } catch (error) {
          await failure(tx, g, error);
          if (!["insufficient", "reconnect_required"].includes(g.status))
            await update(tx, g, { status: "reconnect_required" });
          // Microsoft has no per-token delegated revocation endpoint. Rejected tokens
          // are discarded locally; the account holder must remove app consent at Microsoft.
        }
        return { returnPath: state.returnPath };
      });
    },
    async select(actor: WorkIdentity, businessId: string, calendarId: string) {
      const result = await security(actor, businessId, async (tx) => {
        const g = await active(tx, businessId);
        if (!g || !http) throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
        let calendars;
        try {
          calendars = await http.calendars(
            await accessToken(tx, g),
            identity(g),
          );
        } catch (error) {
          await failure(tx, g, error);
          return false;
        }
        if (!calendars.some((c) => c.id === calendarId))
          throw new ApplicationError("INVALID_INPUT");
        await update(tx, g, {
          selectedCalendarId: calendarId,
          status: "ready",
          reason: null,
        });
        return true;
      });
      if (!result) throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
      return security(actor, businessId, (tx) => view(tx, businessId));
    },
    async disconnect(actor: WorkIdentity, businessId: string) {
      return security(actor, businessId, async (tx) => {
        const g = await active(tx, businessId);
        if (g)
          await update(tx, g, {
            generation: g.generation + 1,
            status: "disconnected",
            reason: "provider_consent_remains",
            credentials: null,
          });
        return view(tx, businessId);
      });
    },
  };
}
