import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { isPendingEmailAccount } from "../models/email-setup";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type {
  MailboxCredentialVault,
  MailboxAuthorizationStore,
} from "../models/mailbox-authorization";
import type { MailboxSnapshot } from "../models/mailboxes";
import { loadMicrosoftMailFolders } from "../microsoft-mail/folders";
import { ApplicationError } from "../models/application-error";
import {
  MicrosoftMailFailure,
  microsoftMailReadScope,
  microsoftMailSendScope,
  microsoftMailReasonSchema,
  microsoftMailViewSchema,
  type MicrosoftMailView,
  type MicrosoftMailStoredGrant as Grant,
  type MicrosoftMailRepository,
} from "../models/microsoft-mail";
import type { createMicrosoftMailHttp } from "../microsoft-mail/http";
import { microsoftValue } from "../microsoft-mail/http";
import type { MicrosoftToken } from "../microsoft-calendar/http";

const tokensSchema = z.object({
  accessToken: z.string().min(1).max(32768),
  refreshToken: z.string().min(1).max(32768),
  expiresAt: z.number().finite(),
  ownerId: z.string().min(1).max(256),
});
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const aad = (g: Grant) => `microsoft-mail:${g.businessId}:${g.id}`;
const scopesOf = (token: MicrosoftToken) =>
  token.scope
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//, ""));
type AuthorizationContext = Pick<
  MailboxSnapshot,
  "oauthGeneration" | "authorizeNative"
> & {
  work: Pick<
    MailboxSnapshot["work"],
    "identity" | "businessId" | "mailboxId" | "policyVersion"
  >;
};
function safeReason(error: unknown): NonNullable<MicrosoftMailView["reason"]> {
  const parsed = microsoftMailReasonSchema.safeParse(
    error instanceof MicrosoftMailFailure ? error.reason : "unavailable",
  );
  return parsed.success ? parsed.data : "unavailable";
}
export function createMicrosoftMailGrantService(options: {
  repository: MicrosoftMailRepository;
  clock: Clock;
  client: { clientId: string; origin: string; redirectPath?: string } | null;
  http: ReturnType<typeof createMicrosoftMailHttp> | null;
  vault: MailboxCredentialVault | null;
}) {
  const { repository, clock, client, http, vault } = options;
  function policyAt(tx: MailboxAuthorizationStore, enabled = false) {
    if (enabled && !tx.processingEnabled)
      throw new ApplicationError("CONFLICT");
    return tx.policy;
  }
  function decode(g: Grant) {
    if (!vault || !g.credentials) throw new MicrosoftMailFailure("revoked");
    try {
      return tokensSchema.parse(
        JSON.parse(vault.decrypt(g.credentials, aad(g))),
      );
    } catch {
      throw new MicrosoftMailFailure("unavailable");
    }
  }
  function view(tx: MailboxAuthorizationStore): MicrosoftMailView {
    const p = policyAt(tx),
      g = tx.grant;
    const kind = g?.accountSubject?.split(":")[0];
    return microsoftMailViewSchema.parse({
      configured: Boolean(client),
      status: g?.status ?? null,
      reason: g?.reason ?? null,
      account: p.account,
      accountKind:
        kind === "microsoft_personal" || kind === "microsoft_work"
          ? kind
          : null,
      authorizedAt: g?.authorizedAt?.toISOString() ?? null,
      read:
        g?.status === "connected" &&
        p.configuration.requestedRead &&
        g.scopes.includes(microsoftMailReadScope) &&
        g.scopes.includes("MailboxSettings.Read"),
      send:
        g?.status === "connected" &&
        p.configuration.requestedSend &&
        g.scopes.includes(microsoftMailSendScope),
      folders: [],
    });
  }
  async function fail(
    snapshot: AuthorizationContext,
    error: unknown,
    revision?: string,
  ) {
    return repository.withMailbox(
      snapshot.work.identity,
      snapshot.work.businessId,
      snapshot.work.mailboxId,
      async (tx) => {
        const p = policyAt(tx),
          g = tx.grant;
        if (
          !g ||
          p.version !== snapshot.work.policyVersion ||
          g.generation !== snapshot.oauthGeneration ||
          revision !== `${g.generation}:${digest(g.credentials ?? "")}`
        )
          return;
        const reason = safeReason(error);
        const permissionFailure = [
          "revoked",
          "insufficient",
          "approval_required",
          "license_required",
          "unsupported_account",
          "account_mismatch",
        ].includes(reason);
        await tx.updateGrant({
          reason,
          ...(reason === "revoked"
            ? { status: "reconnect_required" as const }
            : permissionFailure
              ? { status: "insufficient" as const }
              : {}),
        });
        if (permissionFailure) await tx.invalidate();
      },
    );
  }
  async function credential(
    snapshot: AuthorizationContext,
    signal: AbortSignal,
  ) {
    const { identity, businessId, mailboxId } = snapshot.work;
    const captured = await repository.withMailbox(
      identity,
      businessId,
      mailboxId,
      async (tx) => {
        const p = policyAt(tx, true),
          g = tx.grant;
        if (
          p.version !== snapshot.work.policyVersion ||
          (g?.generation ?? null) !== snapshot.oauthGeneration
        )
          throw new ApplicationError("CONFLICT");
        if (
          !g ||
          g.status !== "connected" ||
          !p.configuration.requestedRead ||
          !g.scopes.includes(microsoftMailReadScope) ||
          !g.scopes.includes("MailboxSettings.Read")
        )
          throw new MicrosoftMailFailure(
            g?.status === "disconnected" || g?.status === "reconnect_required"
              ? "revoked"
              : "insufficient",
          );
        return { p, g, tokens: decode(g) };
      },
    );
    if (!http || !vault) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
    const revision = `${captured.g.generation}:${digest(captured.g.credentials!)}`;
    if (captured.tokens.expiresAt > clock.now().getTime() + 60000)
      return {
        token: captured.tokens.accessToken,
        revision,
        scopes: captured.g.scopes,
        ownerId: captured.tokens.ownerId,
      };
    let token: MicrosoftToken;
    try {
      await snapshot.authorizeNative?.("microsoft:refresh");
      token = await http.token(
        {
          grant_type: "refresh_token",
          refresh_token: captured.tokens.refreshToken,
          scope: captured.g.scopes.join(" "),
        },
        signal,
      );
      await snapshot.authorizeNative?.("microsoft:refresh-profile");
      const owner = await http.profile(token.access_token, signal);
      if (
        owner.id !== captured.tokens.ownerId ||
        (owner.mail ?? owner.userPrincipalName)?.toLowerCase() !==
          captured.p.account.toLowerCase()
      )
        throw new MicrosoftMailFailure("account_mismatch");
      if (
        captured.g.accountSubject?.startsWith("microsoft_work:") &&
        owner.userType !== "Member"
      )
        throw new MicrosoftMailFailure("unsupported_account");
    } catch (error) {
      await fail(snapshot, error, revision);
      throw error;
    }
    return repository.withMailbox(
      identity,
      businessId,
      mailboxId,
      async (tx) => {
        const p = policyAt(tx, true),
          g = tx.grant;
        if (
          !g ||
          g.status !== "connected" ||
          g.generation !== captured.g.generation ||
          g.credentials !== captured.g.credentials ||
          p.version !== captured.p.version
        )
          throw new ApplicationError("CONFLICT");
        const scopes = scopesOf(token);
        const sufficient =
          scopes.includes(microsoftMailReadScope) &&
          scopes.includes("MailboxSettings.Read");
        const credentials = vault.encrypt(
          JSON.stringify({
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? captured.tokens.refreshToken,
            expiresAt: clock.now().getTime() + token.expires_in * 1000,
            ownerId: captured.tokens.ownerId,
          }),
          aad(g),
        );
        await tx.updateGrant({
          credentials,
          scopes,
          status: sufficient ? "connected" : "insufficient",
          reason: sufficient ? null : "insufficient",
        });
        if (!sufficient) await tx.invalidate();
        return {
          token: token.access_token,
          scopes,
          revision: `${g.generation}:${digest(credentials)}`,
          ownerId: captured.tokens.ownerId,
        };
      },
    );
  }
  const callbackPath = (businessId: string, id: string) =>
    client?.redirectPath ??
    `/api/businesses/${businessId}/mailboxes/${id}/microsoft/callback`;
  return {
    http,
    credential,
    fail,
    async folders(
      identity: WorkIdentity,
      businessId: string,
      mailboxId: string,
    ) {
      const captured = await repository.withMailbox(
        identity,
        businessId,
        mailboxId,
        async (tx) => ({ p: policyAt(tx, true), g: tx.grant }),
      );
      const context: AuthorizationContext = {
        work: {
          identity,
          businessId,
          mailboxId,
          policyVersion: captured.p.version,
        },
        oauthGeneration: captured.g?.generation ?? null,
      };
      const c = await credential(context, AbortSignal.timeout(30000));
      if (!http) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      let folders;
      try {
        folders = await loadMicrosoftMailFolders(
          http,
          c.token,
          AbortSignal.timeout(30000),
        );
      } catch (error) {
        await fail(context, error, c.revision);
        throw error;
      }
      await repository.withMailbox(
        identity,
        businessId,
        mailboxId,
        async (tx) => {
          const p = policyAt(tx, true),
            g = tx.grant;
          if (
            !g ||
            p.version !== captured.p.version ||
            g.status !== "connected" ||
            `${g.generation}:${digest(g.credentials ?? "")}` !== c.revision
          )
            throw new ApplicationError("CONFLICT");
        },
      );
      return folders.map((f) => ({ id: f.id, label: f.displayName }));
    },
    read: (identity: WorkIdentity, businessId: string, id: string) =>
      repository.withMailbox(identity, businessId, id, async (tx) => view(tx)),
    async start(identity: WorkIdentity, businessId: string, id: string) {
      return repository.withMailbox(identity, businessId, id, async (tx) => {
        if (!client || !vault)
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        const p = policyAt(tx, true);
        if (!p.configuration.requestedRead && !p.configuration.requestedSend)
          throw new ApplicationError("INVALID_INPUT");
        let g = tx.grant;
        if (!g) g = await tx.createGrant();
        else {
          g = { ...g, generation: g.generation + 1 };
          await tx.updateGrant({
            generation: g.generation,
            status: "connecting",
            reason: null,
          });
        }
        await tx.invalidate();
        const state = randomBytes(32).toString("hex"),
          verifier = randomBytes(32).toString("base64url"),
          hash = digest(state);
        await tx.createState({
          id: randomUUID(),
          businessId,
          mailboxId: id,
          generation: g.generation,
          policyVersion: p.version,
          stateHash: hash,
          verifier: vault.encrypt(verifier, `${aad(g)}:${hash}`),
          actorId: identity.userId,
          sessionId: identity.sessionId,
          expiresAt: new Date(clock.now().getTime() + 600000),
        });
        const url = new URL(
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        );
        url.search = new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: `${client.origin}${callbackPath(businessId, id)}`,
          response_type: "code",
          response_mode: "query",
          scope: [
            "openid",
            "email",
            "profile",
            "offline_access",
            "User.Read",
            ...(p.configuration.requestedRead ? [microsoftMailReadScope] : []),
            "MailboxSettings.Read",
            ...(p.configuration.requestedSend ? [microsoftMailSendScope] : []),
          ].join(" "),
          state,
          nonce: hash,
          prompt: "consent",
          ...(isPendingEmailAccount(p.account)
            ? {}
            : { login_hint: p.account }),
          code_challenge: digestBase64(verifier),
          code_challenge_method: "S256",
        }).toString();
        return { authorizationUrl: url.toString() };
      });
    },
    async callback(
      identity: WorkIdentity,
      businessId: string,
      id: string,
      input: { state: string; code?: string; error?: string },
    ) {
      const captured = await repository.withMailbox(
        identity,
        businessId,
        id,
        async (tx) => {
          const p = policyAt(tx, true),
            g = tx.grant,
            s = await tx.state(digest(input.state));
          if (
            !s ||
            !g ||
            s.consumed ||
            s.mailboxId !== id ||
            s.generation !== g.generation ||
            s.policyVersion !== p.version ||
            s.expiresAt <= clock.now() ||
            s.actorId !== identity.userId ||
            s.sessionId !== identity.sessionId
          )
            throw new ApplicationError("INVALID_INPUT");
          await tx.consumeState(s.id);
          return { p, g, s };
        },
      );
      if (!client || !http || !vault)
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      let token: MicrosoftToken | undefined,
        subject: string | undefined,
        ownerId: string | undefined,
        accountEmail: string | undefined;
      let reason: MicrosoftMailView["reason"] = input.error
        ? "consent_denied"
        : null;
      try {
        if (!reason) {
          token = await http.token({
            grant_type: "authorization_code",
            code: input.code!,
            redirect_uri: `${client.origin}${callbackPath(businessId, id)}`,
            code_verifier: vault.decrypt(
              captured.s.verifier,
              `${aad(captured.g)}:${captured.s.stateHash}`,
            ),
          });
          const account = await http.identity(
            token,
            captured.s.stateHash,
            clock.now(),
          );
          subject = `${account.accountKind}:${account.tenantId}:${digest(JSON.stringify([account.subject, account.ownerId]))}`;
          ownerId = account.ownerId;
          accountEmail = account.email;
          if (
            (!isPendingEmailAccount(captured.p.account) &&
              account.email.toLowerCase() !==
                captured.p.account.toLowerCase()) ||
            (captured.g.accountSubject && captured.g.accountSubject !== subject)
          )
            throw new MicrosoftMailFailure("account_mismatch");
          if (!scopesOf(token).includes("MailboxSettings.Read"))
            throw new MicrosoftMailFailure("insufficient");
          const purpose = microsoftValue(
            z.object({ userPurpose: z.string() }),
            await http.api(
              "me/mailboxSettings?$select=userPurpose",
              token.access_token,
              AbortSignal.timeout(10000),
            ),
          );
          if (purpose.userPurpose !== "user")
            throw new MicrosoftMailFailure("unsupported_account");
        }
      } catch (error) {
        reason = safeReason(error);
      }
      await repository.withMailbox(identity, businessId, id, async (tx) => {
        const p = policyAt(tx),
          g = tx.grant;
        // A concurrent disconnect/scope edit wins. Unaccepted network credentials are discarded, never reactivated.
        if (
          !g ||
          g.generation !== captured.g.generation ||
          p.version !== captured.p.version ||
          g.status !== "connecting"
        )
          throw new ApplicationError("CONFLICT");
        if (reason || !token || !subject || !ownerId) {
          await tx.updateGrant({
            status: "reconnect_required",
            reason: reason ?? "invalid_response",
            credentials: null,
          });
          await tx.invalidate();
          return;
        }
        const scopes = scopesOf(token),
          refresh = token.refresh_token;
        if (isPendingEmailAccount(p.account)) {
          if (!accountEmail) throw new ApplicationError("CONFLICT");
          await tx.bindPendingAccount(accountEmail);
        }
        const read =
            p.configuration.requestedRead &&
            scopes.includes(microsoftMailReadScope),
          send =
            p.configuration.requestedSend &&
            scopes.includes(microsoftMailSendScope);
        const sufficient =
          (!p.configuration.requestedRead || read) &&
          (!p.configuration.requestedSend || send);
        await tx.updateGrant({
          accountSubject: subject,
          scopes,
          authorizedAt: clock.now(),
          status: !refresh
            ? "reconnect_required"
            : read || send
              ? "connected"
              : "insufficient",
          reason: !refresh ? "revoked" : sufficient ? null : "insufficient",
          credentials: refresh
            ? vault.encrypt(
                JSON.stringify({
                  accessToken: token.access_token,
                  refreshToken: refresh,
                  expiresAt: clock.now().getTime() + token.expires_in * 1000,
                  ownerId,
                }),
                aad(g),
              )
            : null,
        });
        await tx.invalidate();
      });
      return { returnPath: `/businesses/${businessId}/mailboxes` };
    },
    async disconnect(identity: WorkIdentity, businessId: string, id: string) {
      return repository.withMailbox(identity, businessId, id, async (tx) => {
        const g = tx.grant;
        if (g)
          await tx.updateGrant({
            generation: g.generation + 1,
            status: "disconnected",
            reason: "provider_consent_retained",
            credentials: null,
            rejectedCredentials: null,
            scopes: [],
          });
        await tx.invalidate();
        // No narrowly delegated Graph endpoint revokes just this app's consent. Do not revoke every user session or request directory grants.
        return {
          ...view(tx),
          status: "disconnected" as const,
          reason: "provider_consent_retained" as const,
          read: false,
          send: false,
        };
      });
    },
  };
}
function digestBase64(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}
