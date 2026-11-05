import "server-only";
import { Pool } from "pg";
import { createAuth } from "../auth/auth";
import { createSignInMailer } from "../auth/resend";
import { createBusinessApplication } from "../application/business";
import { createBusinessRepository } from "../db/business-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createBusinessHttp } from "../http/business";
import type { FailureDiagnostic } from "../http/respond";
import { ApplicationError } from "../models/application-error";
import { readEnvironment } from "./environment";
import { createTeamApplication } from "../application/team";
import { createTeamRepository } from "../db/team-repository";
import { createTeamHttp } from "../http/team";
import { createInvitationMailer } from "../auth/invitation-mailer";
import { invitationTokens } from "../auth/invitation-tokens";

export function reportFailure(diagnostic: FailureDiagnostic) {
  console.error(JSON.stringify({ event: "request_failed", ...diagnostic }));
}

async function composeServices() {
  const environment = readEnvironment();
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  });
  pool.on("error", () =>
    reportFailure({ requestId: "database-pool", code: "DATABASE_UNAVAILABLE" }),
  );
  try {
    await verifyRuntimeRole(pool);
  } catch (error: unknown) {
    await pool.end();
    throw error;
  }
  const auth = createAuth({
    database: runtimeDatabase(pool),
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    mailer: createSignInMailer({
      apiKey: environment.RESEND_API_KEY,
      from: environment.AUTH_EMAIL_FROM,
    }),
  });
  const authenticate = async (headers: Headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session) throw new ApplicationError("UNAUTHENTICATED");
    return { userId: session.user.id };
  };
  const application = createBusinessApplication({
    authenticate,
    repository: createBusinessRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
  });
  const team = createTeamApplication({
    authenticate,
    // ADR 0002 requires MFA before privileged production access. No Business
    // role or magic-link session can stand in for that separate adapter.
    authenticatePlatform: async (headers: Headers) => {
      await authenticate(headers);
      throw new ApplicationError("SETUP_REQUIRED");
    },
    repository: createTeamRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    tokens: invitationTokens(environment.BETTER_AUTH_SECRET),
    mailer: createInvitationMailer({
      apiKey: environment.RESEND_API_KEY,
      from: environment.AUTH_EMAIL_FROM,
    }),
    origin: environment.BETTER_AUTH_URL,
  });
  return {
    auth,
    application,
    team,
    teamHttp: createTeamHttp({
      application: team,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    http: createBusinessHttp({
      application,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
  };
}

let services: ReturnType<typeof composeServices> | undefined;
export function getServices() {
  services ??= composeServices().catch((error) => {
    services = undefined;
    throw error;
  });
  return services;
}
