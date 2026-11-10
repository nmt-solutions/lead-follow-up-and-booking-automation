import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { googleCalendarGrant, googleCalendarOauth } from "./schema";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  googleCalendarScopes,
  type GoogleCalendarView,
} from "../models/google-calendar";
import type { GoogleCalendarConfiguration } from "../google-calendar/configuration";
import { googleCredentialVault } from "../google-calendar/credentials";
import {
  createGoogleHttp,
  GoogleCalendarFailure,
  type GoogleToken,
} from "../google-calendar/http";
import { requireSalesSession } from "./opportunity-control-repository";

type Grant = typeof googleCalendarGrant.$inferSelect;
const storedTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
});
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function createGoogleCalendarRepository(
  database: Database,
  options: {
    clock: Clock;
    configuration: GoogleCalendarConfiguration | null;
    fetch: typeof fetch;
  },
) {
  const { clock, configuration } = options;
  const http = configuration
    ? createGoogleHttp(configuration, options.fetch)
    : null;
  const vault = configuration ? googleCredentialVault(configuration) : null;
  const aad = (g: Grant) => `google-calendar:${g.businessId}:${g.id}`;
  async function active(tx: Transaction, businessId: string) {
    const [g] = await tx
      .select()
      .from(googleCalendarGrant)
      .where(
        and(
          eq(googleCalendarGrant.businessId, businessId),
          ne(googleCalendarGrant.status, "disconnected"),
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
        | "rejectedCredentials"
        | "scopes"
        | "authorizedAt"
        | "actorId"
        | "at"
      >
    >,
  ) {
    await tx
      .update(googleCalendarGrant)
      .set(data)
      .where(
        and(
          eq(googleCalendarGrant.id, g.id),
          eq(googleCalendarGrant.businessId, g.businessId),
        ),
      );
    Object.assign(g, data);
  }
  async function failure(tx: Transaction, g: Grant, error: unknown) {
    const reason =
      error instanceof GoogleCalendarFailure ? error.reason : "unavailable";
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
    if (!vault || !g.credentials) throw new GoogleCalendarFailure("revoked");
    try {
      return storedTokens.parse(
        JSON.parse(vault.decrypt(g.credentials, aad(g))),
      );
    } catch {
      throw new GoogleCalendarFailure("unavailable");
    }
  }
  function rejectedTokens(g: Grant) {
    if (!g.rejectedCredentials) return [];
    if (!vault) throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
    return z
      .array(z.string())
      .max(32)
      .parse(
        JSON.parse(vault.decrypt(g.rejectedCredentials, `${aad(g)}:rejected`)),
      );
  }
  function scopes(token: GoogleToken, previous: string[] = []) {
    return token.scope === undefined
      ? previous
      : token.scope.split(/\s+/).filter(Boolean);
  }
  function sufficient(granted: string[]) {
    return googleCalendarScopes
      .filter((s) => s.startsWith("https://www.googleapis.com/auth/calendar"))
      .every((s) => granted.includes(s));
  }
  async function accessToken(tx: Transaction, g: Grant) {
    if (
      !http ||
      !vault ||
      !["ready", "selection_required"].includes(g.status) ||
      !sufficient(g.scopes)
    )
      throw new GoogleCalendarFailure("insufficient");
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
    if (!sufficient(granted)) throw new GoogleCalendarFailure("insufficient");
    return token.access_token;
  }
  async function authorized<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "integrations.manage",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return operation(tx);
      },
      { lock: true },
    );
  }
  async function view(
    tx: Transaction,
    businessId: string,
  ): Promise<GoogleCalendarView> {
    let g = await active(tx, businessId);
    if (!g)
      [g] = await tx
        .select()
        .from(googleCalendarGrant)
        .where(eq(googleCalendarGrant.businessId, businessId))
        .orderBy(desc(googleCalendarGrant.at))
        .limit(1);
    let calendars: GoogleCalendarView["calendars"] = [];
    if (g && http && ["ready", "selection_required"].includes(g.status)) {
      try {
        calendars = await http.calendars(await accessToken(tx, g));
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
        : "Google Calendar requires approved OAuth project configuration and encryption keys. Ask the operator to finish setup.",
      status: g?.status ?? "not_connected",
      reason: g?.reason ?? null,
      connectionId: g?.id ?? null,
      accountEmail: g?.accountEmail ?? null,
      selectedCalendarId: g?.selectedCalendarId ?? null,
      calendars,
      grantedScopes: g?.scopes ?? [],
      authorizedAt: g?.authorizedAt?.toISOString() ?? null,
    };
  }
  return {
    active,
    update,
    failure,
    accessToken,
    http,
    read: (actor: WorkIdentity, businessId: string) =>
      authorized(actor, businessId, (tx) => view(tx, businessId)),
    async start(actor: WorkIdentity, businessId: string, returnPath: string) {
      return authorized(actor, businessId, async (tx) => {
        if (!configuration || !vault)
          throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
        let g = await active(tx, businessId);
        if (g?.status === "revocation_pending")
          throw new ApplicationError("CONFLICT");
        if (g && rejectedTokens(g).length >= 32)
          throw new ApplicationError("CONFLICT");
        if (!g)
          [g] = await tx
            .insert(googleCalendarGrant)
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
        await tx.insert(googleCalendarOauth).values({
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
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
          client_id: configuration.clientId,
          redirect_uri: `${configuration.origin}${configuration.redirectPath ?? `/api/businesses/${businessId}/calendar/google/callback`}`,
          response_type: "code",
          scope: googleCalendarScopes.join(" "),
          state,
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "false",
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
      const state = await authorized(actor, businessId, async (tx) => {
        const [s] = await tx
          .select()
          .from(googleCalendarOauth)
          .where(
            and(
              eq(googleCalendarOauth.businessId, businessId),
              eq(googleCalendarOauth.stateHash, digest(input.state)),
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
          .update(googleCalendarOauth)
          .set({ consumed: true })
          .where(eq(googleCalendarOauth.id, s.id));
        return s;
      });
      return authorized(actor, businessId, async (tx) => {
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
        let token: GoogleToken | undefined;
        let adopted = false;
        try {
          token = await http.token({
            code: input.code,
            code_verifier: vault.decrypt(
              state.verifier,
              `${aad(g)}:${state.stateHash}`,
            ),
            grant_type: "authorization_code",
            redirect_uri: `${configuration.origin}${configuration.redirectPath ?? `/api/businesses/${businessId}/calendar/google/callback`}`,
          });
          const granted = scopes(token);
          if (!sufficient(granted))
            throw new GoogleCalendarFailure("insufficient");
          const identity = await http.identity(token.access_token);
          if (g.accountSubject && g.accountSubject !== identity.sub)
            throw new GoogleCalendarFailure("insufficient");
          const refreshToken =
            token.refresh_token ??
            (g.credentials ? decode(g).refreshToken : null);
          if (!refreshToken) throw new GoogleCalendarFailure("revoked");
          await update(tx, g, {
            accountSubject: identity.sub,
            accountEmail: identity.email,
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
          adopted = true;
          await view(tx, businessId);
        } catch (error) {
          await failure(tx, g, error);
          if (!["insufficient", "reconnect_required"].includes(g.status))
            await update(tx, g, { status: "reconnect_required" });
          // Tokens from failed/partial consent or a substituted account are quarantined
          // for explicit revocation. They never replace the validated account credential.
          if (token && !adopted)
            await update(tx, g, {
              rejectedCredentials: vault.encrypt(
                JSON.stringify([
                  ...new Set([
                    ...rejectedTokens(g),
                    token.refresh_token ?? token.access_token,
                  ]),
                ]),
                `${aad(g)}:rejected`,
              ),
            });
        }
        return { returnPath: state.returnPath };
      });
    },
    async select(actor: WorkIdentity, businessId: string, calendarId: string) {
      const result = await authorized(actor, businessId, async (tx) => {
        const g = await active(tx, businessId);
        if (!g || !http) throw new ApplicationError("CALENDAR_SETUP_REQUIRED");
        let calendars;
        try {
          calendars = await http.calendars(await accessToken(tx, g));
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
      return authorized(actor, businessId, (tx) => view(tx, businessId));
    },
    async disconnect(actor: WorkIdentity, businessId: string) {
      // Local disable is durable even when the revoke request fails or the process exits.
      const disabled = await authorized(actor, businessId, async (tx) => {
        const g = await active(tx, businessId);
        if (!g) return null;
        await update(tx, g, {
          generation: g.generation + 1,
          status: "revocation_pending",
          reason: "revocation_pending",
        });
        return { id: g.id, generation: g.generation };
      });
      return authorized(actor, businessId, async (tx) => {
        const g = await active(tx, businessId);
        if (
          !g ||
          !disabled ||
          g.id !== disabled.id ||
          g.generation !== disabled.generation ||
          g.status !== "revocation_pending"
        )
          return view(tx, businessId);
        let reason: "manual_required" | "shared_identity" | null =
          g.rejectedCredentials ? "manual_required" : null;
        if (g.credentials) {
          if (!http || !vault) return view(tx, businessId);
          const allowed = await tx.execute<{ allowed: boolean }>(
            sql`select public.google_primary_revocable('google_calendar',${g.id}::uuid,${g.generation}) allowed`,
          );
          if (!allowed.rows[0]?.allowed)
            reason ??= g.accountSubject ? "shared_identity" : "manual_required";
          else {
            try {
              await http.revoke(decode(g).refreshToken);
            } catch {
              await update(tx, g, { reason: "revocation_pending" });
              return view(tx, businessId);
            }
          }
        }
        await update(tx, g, {
          status: "disconnected",
          reason,
          credentials: null,
          rejectedCredentials: null,
        });
        return view(tx, businessId);
      });
    },
  };
}
