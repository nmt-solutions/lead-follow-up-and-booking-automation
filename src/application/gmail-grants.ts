import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { ApplicationError } from "../models/application-error";
import {
  gmailReadScope,
  gmailSendScope,
  gmailViewSchema,
  type GmailView,
  type GmailStoredGrant as Grant,
  type GmailPolicy as Policy,
  type GmailRepository,
  type GmailStore,
  type GmailAuthorizationProvider,
  type GmailCredentialVault,
  type GmailToken,
  GmailFailure,
} from "../models/gmail";
import type { MailboxSnapshot } from "../models/mailboxes";
const storedTokens = z.object({
  accessToken: z.string().min(1).max(8192),
  refreshToken: z.string().min(1).max(8192),
  expiresAt: z.number().finite(),
});
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const aad = (g: Pick<Grant, "id" | "businessId">) =>
  `gmail:${g.businessId}:${g.id}`;

function safeGmailFailure(error: unknown): NonNullable<GmailView["reason"]> {
  if (!(error instanceof GmailFailure)) return "unavailable";
  const parsed = gmailViewSchema.shape.reason.safeParse(error.reason);
  return parsed.success ? (parsed.data ?? "unavailable") : "unavailable";
}

export function createGmailGrantService(options: {
  repository: GmailRepository;
  clock: Clock;
  client: { clientId: string; origin: string } | null;
  http: GmailAuthorizationProvider | null;
  vault: GmailCredentialVault | null;
}) {
  const { clock, client: configuration, http, vault, repository } = options;
  function policyAt(store: GmailStore, enabled = false) {
    if (enabled && !store.processingEnabled)
      throw new ApplicationError("CONFLICT");
    return store.policy;
  }
  const invalidate = (store: GmailStore) => store.invalidate();
  function decode(g: Grant) {
    if (!vault || !g.credentials) throw new GmailFailure("revoked");
    try {
      return storedTokens.parse(
        JSON.parse(vault.decrypt(g.credentials, aad(g))),
      );
    } catch {
      throw new GmailFailure("unavailable");
    }
  }
  function rejected(g: Grant): string[] {
    if (!g.rejectedCredentials) return [];
    if (!vault) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
    return z
      .array(z.string().min(1).max(8192))
      .max(32)
      .parse(
        JSON.parse(vault.decrypt(g.rejectedCredentials, `${aad(g)}:rejected`)),
      );
  }
  function view(p: Policy, g: Grant | undefined): GmailView {
    return gmailViewSchema.parse({
      configured: Boolean(configuration),
      status: g?.status ?? null,
      reason: g?.reason ?? null,
      account: p.account,
      authorizedAt: g?.authorizedAt?.toISOString() ?? null,
      read:
        g?.status === "connected" &&
        p.configuration.requestedRead &&
        g.scopes.includes(gmailReadScope),
      send:
        g?.status === "connected" &&
        p.configuration.requestedSend &&
        g.scopes.includes(gmailSendScope),
    });
  }
  const callbackPath = (businessId: string, mailboxId: string) =>
    `/api/businesses/${businessId}/mailboxes/${mailboxId}/gmail/callback`;
  async function saveFailure(
    actor: WorkIdentity,
    p: Policy,
    expected: Grant,
    error: unknown,
  ) {
    return repository.withMailbox(actor, p.businessId, p.id, async (tx) => {
      const current = policyAt(tx);
      const g = tx.grant;
      if (
        !g ||
        g.generation !== expected.generation ||
        g.credentials !== expected.credentials ||
        current.version !== p.version
      )
        throw new ApplicationError("CONFLICT");
      const safe = safeGmailFailure(error);
      await tx.updateGrant({
        reason: safe,
        ...(safe === "revoked"
          ? { status: "reconnect_required" as const }
          : safe === "insufficient"
            ? { status: "insufficient" as const }
            : {}),
      });
      await invalidate(tx);
    });
  }
  async function credential(snapshot: MailboxSnapshot, signal: AbortSignal) {
    const { identity, businessId, mailboxId } = snapshot.work;
    const captured = await repository.withMailbox(
      identity,
      businessId,
      mailboxId,
      async (tx) => {
        const p = policyAt(tx, true);
        const g = tx.grant;
        if (p.version !== snapshot.work.policyVersion)
          throw new ApplicationError("CONFLICT");
        if ((g?.generation ?? null) !== snapshot.oauthGeneration)
          throw new ApplicationError("CONFLICT");
        if (
          !g ||
          g.status !== "connected" ||
          !p.configuration.requestedRead ||
          !g.scopes.includes(gmailReadScope)
        )
          throw new GmailFailure(
            g?.status === "reconnect_required" ||
              g?.status === "disconnected" ||
              g?.status === "revocation_pending"
              ? "revoked"
              : "insufficient",
          );
        return { p, g, tokens: decode(g) };
      },
    );
    if (!http || !vault) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
    if (captured.tokens.expiresAt > clock.now().getTime() + 60000)
      return {
        token: captured.tokens.accessToken,
        revision: `${captured.g.generation}:${digest(captured.g.credentials!)}`,
        scopes: captured.g.scopes,
      };
    let token: GmailToken;
    try {
      token = await http.token(
        {
          grant_type: "refresh_token",
          refresh_token: captured.tokens.refreshToken,
        },
        signal,
      );
    } catch (error) {
      await saveFailure(identity, captured.p, captured.g, error);
      throw error;
    }
    return repository.withMailbox(
      identity,
      businessId,
      mailboxId,
      async (tx) => {
        const p = policyAt(tx, true);
        const g = tx.grant;
        if (
          p.version !== captured.p.version ||
          !g ||
          g.status !== "connected" ||
          g.generation !== captured.g.generation ||
          g.credentials !== captured.g.credentials
        )
          throw new ApplicationError("CONFLICT");
        const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? g.scopes;
        const credentials = vault.encrypt(
          JSON.stringify({
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? captured.tokens.refreshToken,
            expiresAt: clock.now().getTime() + token.expires_in * 1000,
          }),
          aad(g),
        );
        await tx.updateGrant({
          credentials,
          scopes,
          reason: scopes.includes(gmailReadScope) ? null : "insufficient",
          status: scopes.includes(gmailReadScope)
            ? "connected"
            : "insufficient",
        });
        if (!scopes.includes(gmailReadScope)) await invalidate(tx);
        return {
          token: token.access_token,
          revision: `${g.generation}:${digest(credentials)}`,
          scopes,
        };
      },
    );
  }
  return {
    http,
    credential,
    async fail(snapshot: MailboxSnapshot, error: unknown, revision?: string) {
      const captured = await repository.withMailbox(
        snapshot.work.identity,
        snapshot.work.businessId,
        snapshot.work.mailboxId,
        async (tx) => ({
          p: policyAt(tx),
          g: tx.grant,
        }),
      );
      if (
        captured.g &&
        captured.g.generation === snapshot.oauthGeneration &&
        captured.p.version === snapshot.work.policyVersion &&
        revision ===
          `${captured.g.generation}:${digest(captured.g.credentials ?? "")}`
      )
        await saveFailure(
          snapshot.work.identity,
          captured.p,
          captured.g,
          error,
        );
    },
    read: (actor: WorkIdentity, businessId: string, id: string) =>
      repository.withMailbox(actor, businessId, id, async (tx) =>
        view(policyAt(tx), tx.grant),
      ),
    async start(actor: WorkIdentity, businessId: string, id: string) {
      return repository.withMailbox(actor, businessId, id, async (tx) => {
        if (!configuration || !vault)
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        const p = policyAt(tx, true);
        const requested = [
          ...(p.configuration.requestedRead ? [gmailReadScope] : []),
          ...(p.configuration.requestedSend ? [gmailSendScope] : []),
        ];
        if (!requested.length) throw new ApplicationError("INVALID_INPUT");
        let g = tx.grant;
        if (
          g?.status === "revocation_pending" ||
          (g && rejected(g).length >= 32)
        )
          throw new ApplicationError("CONFLICT");
        if (!g) g = await tx.createGrant();
        else {
          await tx.updateGrant({
            generation: g.generation + 1,
            status: "connecting",
            reason: null,
          });
          g.generation++;
        }
        await invalidate(tx);
        const state = randomBytes(32).toString("hex"),
          verifier = randomBytes(32).toString("base64url");
        await tx.createState({
          id: randomUUID(),
          businessId,
          mailboxId: id,
          generation: g.generation,
          policyVersion: p.version,
          stateHash: digest(state),
          verifier: vault.encrypt(verifier, `${aad(g)}:${digest(state)}`),
          actorId: actor.userId,
          sessionId: actor.sessionId,
          expiresAt: new Date(clock.now().getTime() + 600000),
        });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
          client_id: configuration.clientId,
          redirect_uri: `${configuration.origin}${callbackPath(businessId, id)}`,
          response_type: "code",
          scope: ["openid", "email", ...requested].join(" "),
          state,
          access_type: "offline",
          prompt: "consent",
          login_hint: p.account,
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
      id: string,
      input: { state: string; code?: string; error?: string },
    ) {
      const captured = await repository.withMailbox(
        actor,
        businessId,
        id,
        async (tx) => {
          const p = policyAt(tx, true),
            g = tx.grant;
          const s = await tx.state(digest(input.state));
          if (
            !s ||
            !g ||
            s.mailboxId !== id ||
            s.generation !== g.generation ||
            s.policyVersion !== p.version ||
            s.consumed ||
            s.expiresAt <= clock.now() ||
            s.actorId !== actor.userId ||
            s.sessionId !== actor.sessionId
          )
            throw new ApplicationError("INVALID_INPUT");
          await tx.consumeState(s.id);
          return { p, g, s };
        },
      );
      if (!configuration || !http || !vault)
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      let token: GmailToken | undefined;
      let account:
        Awaited<ReturnType<GmailAuthorizationProvider["identity"]>> | undefined;
      let reason: GmailView["reason"] = input.error ? "consent_denied" : null;
      try {
        if (!reason) {
          token = await http.token({
            code: input.code!,
            code_verifier: vault.decrypt(
              captured.s.verifier,
              `${aad(captured.g)}:${captured.s.stateHash}`,
            ),
            grant_type: "authorization_code",
            redirect_uri: `${configuration.origin}${callbackPath(businessId, id)}`,
          });
          account = await http.identity(token.access_token);
          if (
            account.email.toLowerCase() !== captured.p.account.toLowerCase() ||
            (captured.g.accountSubject &&
              captured.g.accountSubject !== account.sub)
          )
            throw new GmailFailure("account_mismatch");
        }
      } catch (error) {
        reason = safeGmailFailure(error);
      }
      await repository.withMailbox(actor, businessId, id, async (tx) => {
        const p = policyAt(tx),
          g = tx.grant;
        if (!g) throw new ApplicationError("CONFLICT");
        const stale =
          g.generation !== captured.g.generation ||
          p.version !== captured.p.version ||
          g.status !== "connecting";
        if (stale || reason) {
          if (token)
            await tx.updateGrant({
              rejectedCredentials: vault.encrypt(
                JSON.stringify([
                  ...new Set([
                    ...rejected(g),
                    token.refresh_token ?? token.access_token,
                  ]),
                ]),
                `${aad(g)}:rejected`,
              ),
              ...(g.status === "disconnected"
                ? {
                    status: "revocation_pending" as const,
                    reason: "revocation_pending",
                  }
                : {}),
            });
          if (!stale)
            await tx.updateGrant({ status: "reconnect_required", reason });
          return;
        }
        if (!token || !account) throw new ApplicationError("CONFLICT");
        const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
        const refreshToken =
          token.refresh_token ??
          (g.credentials ? decode(g).refreshToken : null);
        const sufficient =
          (!p.configuration.requestedRead || scopes.includes(gmailReadScope)) &&
          (!p.configuration.requestedSend || scopes.includes(gmailSendScope));
        const usable =
          (p.configuration.requestedRead && scopes.includes(gmailReadScope)) ||
          (p.configuration.requestedSend && scopes.includes(gmailSendScope));
        await tx.updateGrant({
          accountSubject: account.sub,
          scopes,
          authorizedAt: clock.now(),
          status: !refreshToken
            ? "reconnect_required"
            : usable
              ? "connected"
              : "insufficient",
          reason: !refreshToken
            ? "revoked"
            : sufficient
              ? null
              : "insufficient",
          credentials: refreshToken
            ? vault.encrypt(
                JSON.stringify({
                  accessToken: token.access_token,
                  refreshToken,
                  expiresAt: clock.now().getTime() + token.expires_in * 1000,
                }),
                aad(g),
              )
            : null,
        });
        await invalidate(tx);
      });
      return { returnPath: `/businesses/${businessId}/mailboxes` };
    },
    async disconnect(actor: WorkIdentity, businessId: string, id: string) {
      const captured = await repository.withMailbox(
        actor,
        businessId,
        id,
        async (tx) => {
          const g = tx.grant;
          if (!g) return null;
          const generation = g.generation + 1;
          await tx.updateGrant({
            generation,
            status: "revocation_pending",
            reason: "revocation_pending",
          });
          await invalidate(tx);
          return { ...g, generation };
        },
      );
      if (!captured || !http || !vault) return this.read(actor, businessId, id);
      try {
        for (const token of new Set([
          ...(captured.credentials ? [decode(captured).refreshToken] : []),
          ...rejected(captured),
        ]))
          await http.revoke(token);
      } catch {
        return this.read(actor, businessId, id);
      }
      await repository.withMailbox(actor, businessId, id, async (tx) => {
        const g = tx.grant;
        if (
          !g ||
          g.generation !== captured.generation ||
          g.rejectedCredentials !== captured.rejectedCredentials ||
          g.status !== "revocation_pending"
        )
          throw new ApplicationError("CONFLICT");
        await tx.updateGrant({
          status: "disconnected",
          reason: null,
          credentials: null,
          rejectedCredentials: null,
        });
      });
      return this.read(actor, businessId, id);
    },
  };
}
