import { createMicrosoftCalendarApplication } from "../application/microsoft-calendar";
import { createMicrosoftCalendarRepository } from "../db/microsoft-calendar-repository";
import { createMicrosoftCalendarProvider } from "../microsoft-calendar/provider";
import { configuredMicrosoftCalendar } from "../microsoft-calendar/configuration";
import { createMicrosoftCalendarHttp } from "../http/microsoft-calendar";
import { combineCalendarProviders } from "../appointments/providers";
import "server-only";
import { createSenderApplication } from "../application/senders";
import { createSenderRepository } from "../db/sender-repository";
import { createSenderHttp } from "../http/senders";
import { unavailableSenderAdapter } from "../senders/adapter";
import { createCallApplication } from "../application/calls";
import { createCallRepository } from "../db/call-repository";
import { createCallHttp } from "../http/calls";
import { createAppointmentApplication } from "../application/appointments";
import { createAppointmentRepository } from "../db/appointment-repository";
import { createAppointmentHttp } from "../http/appointments";
import { unavailableCalendarProvider } from "../appointments/provider";
import { createGoogleCalendarApplication } from "../application/google-calendar";
import { createGoogleCalendarRepository } from "../db/google-calendar-repository";
import { createGoogleCalendarProvider } from "../google-calendar/provider";
import { configuredGoogleCalendar } from "../google-calendar/configuration";
import { createGoogleCalendarHttp } from "../http/google-calendar";
import { createCommercialApplication } from "../application/commercial-actions";
import { createCommercialRepository } from "../db/commercial-actions-repository";
import { createCommercialHttp } from "../http/commercial-actions";
import { createRfqApplication } from "../application/rfq";
import { createRfqRepository } from "../db/rfq-repository";
import { createRfqHttp } from "../http/rfq";
import { createInquiryApplication } from "../application/inquiries";
import { createInquiryRepository } from "../db/inquiry-repository";
import { createInquiryHttp } from "../http/inquiries";
import { createOpportunityApplication } from "../application/opportunity-control";
import { createOpportunityRepository } from "../db/opportunity-control-repository";
import { createOpportunityHttp } from "../http/opportunity-control";
import { ApplicationError } from "../models/application-error";
import { createInboxApplication } from "../application/inbox";
import { createInboxRepository } from "../db/inbox-repository";
import { createInboxHttp } from "../http/inbox";
import { normalizedInquiryAdapter } from "../inbox/adapter";
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
import { createCommercialAuthorityApplication } from "../application/commercial-authority";
import { createCommercialAuthorityRepository } from "../db/commercial-authority-repository";
import { createCommercialAuthorityHttp } from "../http/commercial-authority";
import { createDiscoveryApplication } from "../application/discovery";
import { createDiscoveryRepository } from "../db/discovery-repository";
import { createDiscoveryHttp } from "../http/discovery";
import { createAiApplication } from "../application/ai";
import { createAiRepository } from "../db/ai-repository";
import { createAiHttp } from "../http/ai";
import { configuredAi } from "../ai/configuration";
import {
  configuredDiscoveryProvider,
  configuredExaRetrieval,
  configuredDiscoveryQueue,
} from "../discovery/configuration";

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
  const senders = createSenderApplication({
    authenticate: access.authenticateForWork,
    repository: createSenderRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    adapter: unavailableSenderAdapter,
    clock: { now: () => new Date() },
  });
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
  const commercialAuthority = createCommercialAuthorityApplication({
    authenticate,
    authenticatePrivileged,
    repository: createCommercialAuthorityRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
  });
  const ai = createAiApplication({
    authenticate,
    authenticatePlatform,
    authenticateWork: access.authenticateWork,
    repository: createAiRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    ...configuredAi(process.env),
  });
  const discovery = createDiscoveryApplication({
    authenticate,
    authenticateForWork: access.authenticateForWork,
    authenticateWork: access.authenticateWork,
    repository: createDiscoveryRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
    provider: configuredDiscoveryProvider(
      ai,
      configuredExaRetrieval(process.env),
    ),
    queue: configuredDiscoveryQueue(process.env),
    reportFailure: ({ businessId, runId, code }) =>
      console.error(
        JSON.stringify({ event: "discovery_failed", businessId, runId, code }),
      ),
  });
  const inbox = createInboxApplication({
    authenticate,
    repository: createInboxRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    adapter: normalizedInquiryAdapter,
  });
  const opportunities = createOpportunityApplication({
    authenticate,
    authenticateForWork: access.authenticateForWork,
    repository: createOpportunityRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
    // Response generation uses the shared approved AI service. Live channel
    // transports remain unavailable until separately configured integration work.
    provider: {
      channels: [],
      async dispatch() {
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      },
    },
  });
  const inquiries = createInquiryApplication({
    authenticate,
    authenticateForWork: access.authenticateForWork,
    repository: createInquiryRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
    ai,
    opportunities,
  });
  const rfqs = createRfqApplication({
    authenticate,
    authenticateForWork: access.authenticateForWork,
    repository: createRfqRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
  });
  const calls = createCallApplication({
    authenticateForWork: access.authenticateForWork,
    repository: createCallRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
  });
  const commercialActions = createCommercialApplication({
    authenticateForWork: access.authenticateForWork,
    repository: createCommercialRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    provider: {
      key: "unconfigured",
      available: false,
      async execute() {
        throw new ApplicationError("COMMERCIAL_SETUP_REQUIRED");
      },
    },
  });
  const googleConfiguration = configuredGoogleCalendar(process.env);
  const googleOptions = {
    configuration: googleConfiguration,
    clock: { now: () => new Date() },
    fetch,
  };
  const googleCalendar = createGoogleCalendarApplication({
    database: runtimeDatabase(pool),
    access,
    ...googleOptions,
  });
  const googleRepository = createGoogleCalendarRepository(
    runtimeDatabase(pool),
    googleOptions,
  );
  const microsoftOptions = {
    configuration: configuredMicrosoftCalendar(process.env),
    clock: googleOptions.clock,
    fetch,
  };
  const microsoftCalendar = createMicrosoftCalendarApplication({
    database: runtimeDatabase(pool),
    access,
    ...microsoftOptions,
  });
  const microsoftRepository = createMicrosoftCalendarRepository(
    runtimeDatabase(pool),
    microsoftOptions,
  );
  const appointments = createAppointmentApplication({
    authenticateForWork: access.authenticateForWork,
    repository: createAppointmentRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
    provider: unavailableCalendarProvider,
    providerForTransaction: (tx) =>
      combineCalendarProviders(
        createGoogleCalendarProvider(googleRepository, tx, googleOptions.clock),
        createMicrosoftCalendarProvider(
          microsoftRepository,
          tx,
          microsoftOptions.clock,
        ),
      ),
    timeoutMs: 5000,
  });
  return {
    senders,
    sendersHttp: createSenderHttp({
      application: senders,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    microsoftCalendar,
    microsoftCalendarHttp: createMicrosoftCalendarHttp({
      application: microsoftCalendar,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    googleCalendar,
    googleCalendarHttp: createGoogleCalendarHttp({
      application: googleCalendar,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    appointments,
    appointmentsHttp: createAppointmentHttp({
      application: appointments,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    commercialActions,
    commercialActionsHttp: createCommercialHttp({
      application: commercialActions,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    inquiries,
    calls,
    callsHttp: createCallHttp({
      application: calls,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    rfqs,
    rfqsHttp: createRfqHttp({
      application: rfqs,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    inquiriesHttp: createInquiryHttp({
      application: inquiries,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    opportunities,
    opportunitiesHttp: createOpportunityHttp({
      application: opportunities,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    inbox,
    inboxHttp: createInboxHttp({
      application: inbox,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    auth,
    access,
    application,
    team,
    files,
    knowledge,
    commercialAuthority,
    discovery,
    ai,
    aiHttp: createAiHttp({
      application: ai,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    discoveryHttp: createDiscoveryHttp({
      application: discovery,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    commercialAuthorityHttp: createCommercialAuthorityHttp({
      application: commercialAuthority,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
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
