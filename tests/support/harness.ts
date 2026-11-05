import { createAuth, type SignInMail } from "../../src/auth/auth";
import { runtimeDatabase, verifyRuntimeRole } from "../../src/db/runtime";
import { createBusinessRepository } from "../../src/db/business-repository";
import { createBusinessApplication } from "../../src/application/business";
import { ApplicationError } from "../../src/models/application-error";
import { startPostgres } from "./postgres";
import { vi } from "vitest";
import type { Actor } from "../../src/models/business";
import { createBusinessHttp } from "../../src/http/business";
import type { FailureDiagnostic } from "../../src/http/respond";
import { createTeamApplication } from "../../src/application/team";
import { createTeamRepository } from "../../src/db/team-repository";
import { invitationTokens } from "../../src/auth/invitation-tokens";
import type { InvitationMail } from "../../src/models/team";
import { createTeamHttp } from "../../src/http/team";
import { createSessionAccess } from "../../src/auth/access";
import { authenticatorCode } from "./totp";

export async function createHarness() {
  const postgres = await startPostgres();
  await verifyRuntimeRole(postgres.runtime);
  const database = runtimeDatabase(postgres.runtime);
  const sent: SignInMail[] = [];
  const mail = {
    sent,
    async send(message: SignInMail) {
      this.sent.push(message);
    },
  };
  let now = new Date("2026-11-05T09:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  const clock = {
    now: () => new Date(now),
    set(value: string) {
      now = new Date(value);
      vi.setSystemTime(now);
    },
  };
  const baseURL = "http://localhost:3000";
  const authenticators = new Map<string, string>();
  let signInRequests = 0;
  const auth = createAuth({
    database,
    baseURL,
    secret: "test-only-secret-for-isolated-business-database",
    mailer: mail,
  });
  const access = createSessionAccess({ auth, database, clock });
  const { authenticate, authenticatePrivileged } = access;
  const repository = createBusinessRepository(database);
  const application = createBusinessApplication({
    authenticate,
    authenticatePrivileged,
    repository,
    clock,
  });
  const diagnostics: FailureDiagnostic[] = [];
  const invitationMessages: InvitationMail[] = [];
  const acceptedInvitations = new Map<string, string>();
  const invitations = {
    sent: invitationMessages,
    fail: false,
    failAfterAccept: false,
    async send(message: InvitationMail) {
      if (this.fail) throw new Error("sensitive-provider-body");
      const original = acceptedInvitations.get(message.invitationId);
      if (original && original !== JSON.stringify(message))
        throw new Error("Idempotency key payload changed");
      if (!original) {
        this.sent.push(message);
        acceptedInvitations.set(message.invitationId, JSON.stringify(message));
      }
      if (this.failAfterAccept)
        throw new Error("sensitive-provider-timeout-after-acceptance");
    },
  };
  const teamDependencies = {
    repository: createTeamRepository(database),
    clock,
    tokens: invitationTokens("test-only-invitation-secret"),
    mailer: invitations,
    origin: baseURL,
  };
  const team = createTeamApplication({
    ...teamDependencies,
    authenticate,
    authenticatePlatform: access.authenticatePlatform,
  });
  const http = createBusinessHttp({
    application,
    origin: baseURL,
    reportFailure: (diagnostic) => diagnostics.push(diagnostic),
  });
  return {
    ...postgres,
    application,
    auth,
    access,
    mail,
    clock,
    authenticate,
    repository,
    http,
    diagnostics,
    team,
    teamHttp: createTeamHttp({
      application: team,
      origin: baseURL,
      reportFailure: (diagnostic) => diagnostics.push(diagnostic),
    }),
    invitations,
    async provisionOperator(
      headers: Headers,
      grants: { tax: boolean; reconciliation: boolean },
    ) {
      const actor = await authenticate(headers);
      await postgres.admin.query(
        "INSERT INTO platform_operator (user_id, tax, reconciliation) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET tax = excluded.tax, reconciliation = excluded.reconciliation",
        [actor.userId, grants.tax, grants.reconciliation],
      );
    },
    teamWorkerFor(actor: Actor) {
      return createTeamApplication<void>({
        ...teamDependencies,
        authenticate: async () => actor,
        authenticatePlatform: async () => {
          throw new ApplicationError("FORBIDDEN");
        },
      });
    },
    // A worker receives its actor from trusted job ownership, never the job's untrusted payload.
    workerFor(actor: Actor) {
      return createBusinessApplication<void>({
        authenticate: async () => actor,
        authenticatePrivileged: async () => actor,
        repository,
        clock,
      });
    },
    async close() {
      try {
        await postgres.close();
      } finally {
        vi.useRealTimers();
      }
    },
    async signIn(email: string, mfa = true) {
      const response = await auth.handler(
        new Request(`${baseURL}/api/auth/sign-in/magic-link`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: baseURL,
            "x-forwarded-for": `198.51.100.${++signInRequests}`,
          },
          body: JSON.stringify({
            email,
            callbackURL: "/businesses",
            errorCallbackURL: "/sign-in",
          }),
        }),
      );
      if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
      const message = mail.sent.at(-1);
      if (!message || message.email !== email)
        throw new Error("Sign-in email missing");
      const verified = await auth.handler(
        new Request(message.url, {
          headers: { "x-forwarded-for": `198.51.100.${signInRequests}` },
        }),
      );
      const cookie = verified.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      if (!cookie) throw new Error(`Verification failed (${verified.status})`);
      const headers = new Headers({ cookie });
      if (!mfa) return headers;
      // Existing scenario fixtures use real authenticator enrollment/challenge,
      // never injected MFA booleans. New security scenarios opt into primary-only.
      const identity = await auth.api.getSession({ headers });
      let uri = authenticators.get(email);
      if (!identity?.user.twoFactorEnabled) {
        const enrollment = await auth.api.enableTwoFactor({
          headers,
          body: {},
        });
        if (enrollment.method !== "totp") throw new Error("Missing TOTP setup");
        uri = enrollment.totpURI;
        authenticators.set(email, uri);
      }
      if (!uri) throw new Error("Missing fixture authenticator");
      const verifiedMfa = await auth.api.verifyTOTP({
        headers,
        body: { code: authenticatorCode(uri, clock.now()) },
        asResponse: true,
      });
      if (!verifiedMfa.ok)
        throw new Error(`MFA fixture failed (${verifiedMfa.status})`);
      const updates = verifiedMfa.headers
        .getSetCookie()
        .map((value) => value.split(";")[0]);
      if (updates.length) headers.set("cookie", updates.join("; "));
      return headers;
    },
    async signOut(headers: Headers) {
      await auth.api.signOut({ headers });
    },
  };
}
