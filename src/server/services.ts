import "server-only";
import { Pool } from "pg";
import { createAuth } from "../auth/auth";
import { createSignInMailer } from "../auth/resend";
import { createBusinessApplication } from "../application/business";
import { createBusinessRepository } from "../db/business-repository";
import { runtimeDatabase, verifyRuntimeRole } from "../db/runtime";
import { createBusinessHttp } from "../http/business";
import type { FailureDiagnostic } from "../http/respond";
import { createSessionAccess } from "../auth/access";
import { readEnvironment } from "./environment";
import { createTeamApplication } from "../application/team";
import { createTeamRepository } from "../db/team-repository";
import { createTeamHttp } from "../http/team";
import { createInvitationMailer } from "../auth/invitation-mailer";
import { invitationTokens } from "../auth/invitation-tokens";
import { createFileApplication } from "../application/files";
import { createFileRepository } from "../db/file-repository";
import { createFilesHttp } from "../http/files";
import { filesConfiguration } from "./files-configuration";
import { createKnowledgeApplication } from "../application/knowledge";
import { createKnowledgeRepository } from "../db/knowledge-repository";
import { createKnowledgeHttp } from "../http/knowledge";

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
  const access = createSessionAccess({
    auth,
    database: runtimeDatabase(pool),
    clock: { now: () => new Date() },
  });
  const { authenticate, authenticatePrivileged, authenticatePlatform } = access;
  const application = createBusinessApplication({
    authenticate,
    authenticatePrivileged,
    repository: createBusinessRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
  });
  const team = createTeamApplication({
    authenticate,
    authenticatePlatform,
    repository: createTeamRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    tokens: invitationTokens(environment.BETTER_AUTH_SECRET),
    mailer: createInvitationMailer({
      apiKey: environment.RESEND_API_KEY,
      from: environment.AUTH_EMAIL_FROM,
    }),
    origin: environment.BETTER_AUTH_URL,
  });
  const files = createFileApplication({
    authenticate,
    repository: createFileRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    ...filesConfiguration(),
  });
  const knowledge = createKnowledgeApplication({
    authenticate,
    repository: createKnowledgeRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
  });
  return {
    auth,
    access,
    application,
    team,
    files,
    knowledge,
    knowledgeHttp: createKnowledgeHttp({
      application: knowledge,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    filesHttp: createFilesHttp({
      application: files,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
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
