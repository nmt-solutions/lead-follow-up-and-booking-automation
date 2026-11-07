import { createRecoveryApplication } from "../application/infrastructure-recovery";
import { createRecoveryRepository } from "../db/recovery-repository";
import { createRecoveryHttp } from "../http/infrastructure-recovery";
import { configuredRecoveryWeb } from "./recovery-web";
import { createFinancialAdjustmentApplication } from "../application/financial-adjustments";
import { createReportingApplication } from "../application/reporting";
import { createReportingRepository } from "../db/reporting-repository";
import { createReportingHttp } from "../http/reporting";
import { createFinancialAdjustmentRepository } from "../db/financial-adjustment-repository";
import { createFinancialAdjustmentHttp } from "../http/financial-adjustments";
import { configuredFinancialAdjustments } from "../financial-adjustments/configuration";
import { routeOpportunityMail } from "../email-sequences/opportunity-provider";
import { createReachChangeApplication } from "../application/reach-changes";
import { createReachChangeRepository } from "../db/reach-change-repository";
import { createReachChangeHttp } from "../http/reach-changes";
import { configuredReachPolicy } from "../subscription-payments/configuration";
import { createDataGovernanceApplication } from "../application/data-governance";
import { createDataGovernanceRepository } from "../db/data-governance-repository";
import { createDataGovernanceHttp } from "../http/data-governance";
import { configuredDataGovernance } from "./data-governance-configuration";
import { createOperationsApplication } from "../application/operations";
import { createOperationsRepository } from "../db/operations-repository";
import { createOperationsHttp } from "../http/operations";
import { configuredOperationLogs } from "../operations/configuration";
import { createCostApplication } from "../application/costs";
import { createCostRepository } from "../db/cost-repository";
import { createCostHttp } from "../http/costs";
import { configuredNotifications } from "../notifications/configuration";
import { createNotificationHttp } from "../http/notifications";
import { routeSenderAdapters } from "../senders/adapter";
import { createMicrosoftOpportunityMail } from "../microsoft-mail/opportunity-mail";
import { createMicrosoftSenderAdapter } from "../microsoft-mail/sender";
import { createGmailOpportunityMail } from "../gmail/opportunity-mail";
import { createWhatsAppSendingRepository } from "../db/whatsapp-sending-repository";
import { createWhatsAppSendingApplication } from "../application/whatsapp-sending";
import { createWhatsAppSendingHttp } from "../http/whatsapp-sending";
import { createMetaTransport } from "../whatsapp/transport";
import type { OpportunityActionProvider } from "../models/opportunity-control";
import { configuredMailboxQueue } from "../mailboxes/queue";
import { createMailboxApplication } from "../application/mailboxes";
import { createMailboxRepository } from "../db/mailbox-repository";
import { createMailboxHttp } from "../http/mailboxes";
import { createGmailConnection } from "../gmail/connection";
import { createNativeMailboxProvider } from "../mailboxes/provider";
import { createMicrosoftMailConnection } from "../microsoft-mail/connection";
import { createMicrosoftMailApplication } from "../application/microsoft-mail";
import { configuredMicrosoftMail } from "../microsoft-mail/configuration";
import { createMicrosoftMailHttpHandlers } from "../http/microsoft-mail";
import { createGmailApplication } from "../application/gmail";
import { configuredGmail } from "../gmail/configuration";
import { createGmailHttpHandlers } from "../http/gmail";
import { createMicrosoftCalendarApplication } from "../application/microsoft-calendar";
import { createMicrosoftCalendarRepository } from "../db/microsoft-calendar-repository";
import { createMicrosoftCalendarProvider } from "../microsoft-calendar/provider";
import { configuredMicrosoftCalendar } from "../microsoft-calendar/configuration";
import { createMicrosoftCalendarHttp } from "../http/microsoft-calendar";
import { combineCalendarProviders } from "../appointments/providers";
import "server-only";
import { createWhatsAppApplication } from "../application/whatsapp";
import { createWhatsAppIntakeApplication } from "../application/whatsapp-intake";
import { createWhatsAppIntakeRepository } from "../db/whatsapp-intake-repository";
import { createWhatsAppIntakeHttp } from "../http/whatsapp-intake";
import { configuredMetaWebhook } from "../whatsapp/intake-configuration";
import { createWhatsAppRepository } from "../db/whatsapp-repository";
import { configuredMetaCloud } from "../whatsapp/configuration";
import { createWhatsAppHttp } from "../http/whatsapp";
import { createEmailSequenceApplication } from "../application/email-sequences";
import { createEmailSequenceRepository } from "../db/email-sequence-repository";
import { createEmailSequenceHttp } from "../http/email-sequences";
import { configuredSequenceQueue } from "../email-sequences/queue";
import { configuredSequenceMail } from "../email-sequences/provider";
import {
  configuredGmailSenderEvidence,
  createGmailSenderAdapter,
} from "../gmail/sender";
import { createCampaignApplication } from "../application/campaigns";
import { createCampaignRepository } from "../db/campaign-repository";
import { createCampaignHttp } from "../http/campaigns";
import { createEmailHandoffApplication } from "../application/email-handoffs";
import { createEmailHandoffRepository } from "../db/email-handoff-repository";
import { createEmailHandoffHttp } from "../http/email-handoffs";
import { createEmailEligibilityApplication } from "../application/email-eligibility";
import { createEmailEligibilityRepository } from "../db/email-eligibility-repository";
import { createEmailEligibilityHttp } from "../http/email-eligibility";
import { createSenderApplication } from "../application/senders";
import { createSenderHealthApplication } from "../application/sender-health";
import { createSenderHealthRepository } from "../db/sender-health-repository";
import { createSenderHealthHttp } from "../http/sender-health";
import { createSenderRepository } from "../db/sender-repository";
import { createSenderHttp } from "../http/senders";
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
import { invitationTokens } from "../auth/invitation-tokens";
import { createFileApplication } from "../application/files";
import { createBillingApplication } from "../application/billing";
import { createBillingRepository } from "../db/billing-repository";
import { createBillingHttp } from "../http/billing";
import { createTaxApplication } from "../application/tax";
import { createTaxRepository } from "../db/tax-repository";
import { createTaxHttp } from "../http/tax";
import { createSubscriptionQuoteApplication } from "../application/subscription-quotes";
import { createSubscriptionQuoteRepository } from "../db/subscription-quote-repository";
import { createSubscriptionQuoteHttp } from "../http/subscription-quotes";
import { createSubscriptionPaymentApplication } from "../application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../db/subscription-payment-repository";
import { createSubscriptionPaymentHttp } from "../http/subscription-payments";
import { configuredPayments } from "../subscription-payments/configuration";
import { createSellerDocumentApplication } from "../application/seller-documents";
import { createSellerDocumentRepository } from "../db/seller-document-repository";
import { createSellerDocumentHttp } from "../http/seller-documents";
import { configuredSellerDocumentStorage } from "../seller-documents/configuration";
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
  const notificationAccess: {
    current?: ReturnType<typeof createSessionAccess>;
  } = {};
  const notificationRuntime = configuredNotifications<Headers>({
    database: runtimeDatabase(pool),
    env: process.env,
    authenticate: (credentials) => {
      if (!notificationAccess.current)
        throw new ApplicationError("UNAUTHENTICATED");
      return notificationAccess.current.authenticate(credentials);
    },
    authenticatePlatform: (credentials) => {
      if (!notificationAccess.current)
        throw new ApplicationError("UNAUTHENTICATED");
      return notificationAccess.current.authenticatePlatform(credentials);
    },
  });
  const notifications = notificationRuntime.application;
  const auth = createAuth({
    database: runtimeDatabase(pool),
    baseURL: environment.BETTER_AUTH_URL,
    secret: environment.BETTER_AUTH_SECRET,
    mailer: notifications.signInMailer,
  });
  const access = createSessionAccess({
    auth,
    database: runtimeDatabase(pool),
    clock: { now: () => new Date() },
  });
  notificationAccess.current = access;
  const { authenticate, authenticatePrivileged, authenticatePlatform } = access;
  const costs = createCostApplication({
    authenticatePlatform,
    repository: createCostRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    mailer: notificationRuntime.costEmailConfigured
      ? notifications.costMailer
      : null,
    scheduleConfigured: Boolean(process.env.TRIGGER_COST_BUDGET_CRON?.trim()),
  });
  const campaigns = createCampaignApplication({
    authenticate: access.authenticateForWork,
    repository: createCampaignRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
  });
  const emailSequences = createEmailSequenceApplication({
    authenticate: access.authenticateForWork,
    repository: createEmailSequenceRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
    provider: configuredSequenceMail({
      env: process.env,
      clock: { now: () => new Date() },
      fetch,
    }),
    queue: configuredSequenceQueue(process.env),
  });
  const emailHandoffs = createEmailHandoffApplication({
    authenticate: access.authenticateForWork,
    repository: createEmailHandoffRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
  });
  const emailEligibility = createEmailEligibilityApplication({
    authenticate: access.authenticateForWork,
    repository: createEmailEligibilityRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
  });
  const mailboxes = createMailboxApplication({
    authenticate: access.authenticateForWork,
    repository: createMailboxRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    provider: createNativeMailboxProvider(runtimeDatabase(pool), {
      clock: { now: () => new Date() },
      env: process.env,
      fetch,
    }),
    clock: { now: () => new Date() },
    enqueue: configuredMailboxQueue(process.env),
  });
  const senders = createSenderApplication({
    authenticate: access.authenticateForWork,
    repository: createSenderRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    adapter: routeSenderAdapters({
      ...(configuredGmail(process.env)
        ? {
            gmail: createGmailSenderAdapter({
              clock: { now: () => new Date() },
              evidence: configuredGmailSenderEvidence(process.env),
            }),
          }
        : {}),
      ...(configuredMicrosoftMail(process.env)
        ? {
            microsoft: createMicrosoftSenderAdapter({
              clock: { now: () => new Date() },
            }),
          }
        : {}),
    }),
    clock: { now: () => new Date() },
  });
  const senderHealth = createSenderHealthApplication({
    authenticate: access.authenticateForWork,
    repository: createSenderHealthRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
  });
  const gmail = createGmailApplication({
    access,
    connection: createGmailConnection(runtimeDatabase(pool), {
      clock: { now: () => new Date() },
      configuration: configuredGmail(process.env),
      fetch,
    }),
    queueInitialSync: (credentials, businessId, mailboxId) =>
      mailboxes.queue(credentials, businessId, mailboxId, {
        mode: "incremental",
      }),
  });
  const microsoftMail = createMicrosoftMailApplication({
    access,
    connection: createMicrosoftMailConnection(runtimeDatabase(pool), {
      clock: { now: () => new Date() },
      configuration: configuredMicrosoftMail(process.env),
      fetch,
    }),
    queueInitialSync: (credentials, businessId, mailboxId) =>
      mailboxes.queue(credentials, businessId, mailboxId, {
        mode: "incremental",
      }),
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
    mailer: notifications.invitationMailer,
    origin: environment.BETTER_AUTH_URL,
  });
  const billing = createBillingApplication({
    authenticate,
    authenticatePlatform,
    repository: createBillingRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
  });
  const tax = createTaxApplication({
    authenticate,
    authenticatePlatform,
    repository: createTaxRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    mode: "live",
  });
  const subscriptionQuotes = createSubscriptionQuoteApplication({
    authenticate,
    authenticatePlatform,
    repository: createSubscriptionQuoteRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
  });
  const paymentGateway = configuredPayments();
  const reachChanges = createReachChangeApplication({
    authenticate,
    authenticatePlatform,
    repository: createReachChangeRepository(runtimeDatabase(pool)),
    gateway: paymentGateway,
    policy: configuredReachPolicy(),
    clock: { now: () => new Date() },
  });
  const subscriptionPayments = createSubscriptionPaymentApplication({
    authenticate,
    authenticatePlatform,
    repository: createSubscriptionPaymentRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    gateway: paymentGateway,
  });
  const sellerDocuments = createSellerDocumentApplication({
    authenticate,
    authenticatePlatform,
    repository: createSellerDocumentRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    mode: paymentGateway.mode === "test" ? "fixture" : "live",
    ...configuredSellerDocumentStorage(process.env),
  });
  const dataGovernance = createDataGovernanceApplication({
    authenticate: authenticatePrivileged,
    repository: createDataGovernanceRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    ...configuredDataGovernance(
      process.env,
      paymentGateway.mode === "test" ? "test" : "live",
    ),
    cancel: subscriptionPayments.cancel,
    documents: sellerDocuments,
  });
  const financialAdjustments = createFinancialAdjustmentApplication({
    authenticate,
    authenticatePlatform,
    repository: createFinancialAdjustmentRepository(runtimeDatabase(pool)),
    clock: { now: () => new Date() },
    gateway: configuredFinancialAdjustments(),
    documents: sellerDocuments,
  });

  const billingReviewFiles = createFileApplication({
    authenticate: authenticatePlatform,
    repository: createFileRepository(runtimeDatabase(pool), {
      billingReview: true,
    }),
    clock: { now: () => new Date() },
    ...filesConfiguration(),
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
  const whatsappComposition = configuredMetaCloud(process.env, fetch, {
    now: () => new Date(),
  });
  const whatsappSendingRepository = createWhatsAppSendingRepository(
    runtimeDatabase(pool),
    { now: () => new Date() },
    {
      ...whatsappComposition,
      transport:
        whatsappComposition.vault && process.env.META_GRAPH_VERSION
          ? createMetaTransport({
              graphVersion: process.env.META_GRAPH_VERSION,
              fetch,
            })
          : null,
      workerReady:
        process.env.META_OUTBOUND_WORKER_DEPLOYMENT_CONFIRMED === "true",
    },
  );
  const opportunityRepository = createOpportunityRepository(
    runtimeDatabase(pool),
    { now: () => new Date() },
    whatsappSendingRepository,
  );
  const gmailConfiguration = configuredGmail(process.env),
    microsoftConfiguration = configuredMicrosoftMail(process.env);
  const emailInquiryProvider = routeOpportunityMail([
    ...(gmailConfiguration
      ? [
          createGmailOpportunityMail({
            configuration: gmailConfiguration,
            fetch,
            clock: { now: () => new Date() },
          }),
        ]
      : []),
    ...(microsoftConfiguration
      ? [
          createMicrosoftOpportunityMail({
            configuration: microsoftConfiguration,
            fetch,
            clock: { now: () => new Date() },
          }),
        ]
      : []),
  ]);
  const inquiryProvider: OpportunityActionProvider = {
    ...emailInquiryProvider,
    channels: [...emailInquiryProvider.channels, "whatsapp"],
  };
  const whatsappSending = createWhatsAppSendingApplication({
    authenticate: access.authenticateForWork,
    repository: whatsappSendingRepository,
    opportunities: opportunityRepository,
    clock: { now: () => new Date() },
  });
  const opportunities = createOpportunityApplication({
    authenticate,
    authenticateForWork: access.authenticateForWork,
    repository: opportunityRepository,
    clock: { now: () => new Date() },
    provider: inquiryProvider,
  });
  const inquiries = createInquiryApplication({
    authenticate,
    authenticateForWork: access.authenticateForWork,
    repository: createInquiryRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    clock: { now: () => new Date() },
    ai,
    opportunityRepository,
    provider: inquiryProvider,
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
  const whatsapp = createWhatsAppApplication({
    authenticate: access.authenticateForWork,
    repository: createWhatsAppRepository(
      runtimeDatabase(pool),
      googleOptions.clock,
    ),
    clock: googleOptions.clock,
    ...whatsappComposition,
  });
  const whatsappIntake = createWhatsAppIntakeApplication({
    authenticate: access.authenticateForWork,
    repository: createWhatsAppIntakeRepository(
      runtimeDatabase(pool),
      googleOptions.clock,
    ),
    clock: googleOptions.clock,
    ...whatsappComposition,
    configuration: configuredMetaWebhook(process.env),
  });
  const recovery = createRecoveryApplication({
    authenticate: access.authenticateForWork,
    repository: createRecoveryRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    adapter: null,
    costs,
    ...configuredRecoveryWeb(process.env),
  });
  const operations = createOperationsApplication({
    authenticate: access.authenticateForWork,
    repository: createOperationsRepository(runtimeDatabase(pool), {
      now: () => new Date(),
    }),
    commands: {
      mailbox: mailboxes,
      discovery,
      appointments,
      inquiries,
      whatsapp: whatsappSending,
      sequences: emailSequences,
      payments: subscriptionPayments,
      documents: sellerDocuments,
    },
    logs: configuredOperationLogs(process.env),
  });
  const reporting = createReportingApplication({
    authenticate: access.authenticateForWork,
    repository: createReportingRepository(
      runtimeDatabase(pool),
      googleOptions.clock,
    ),
    clock: googleOptions.clock,
  });
  return {
    reporting,
    reportingHttp: createReportingHttp({
      application: reporting,
      reportFailure,
    }),
    dataGovernance,
    dataGovernanceHttp: createDataGovernanceHttp({
      application: dataGovernance,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    operations,
    recovery,
    recoveryHttp: createRecoveryHttp({
      application: recovery,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    operationsHttp: createOperationsHttp({
      application: operations,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    whatsappSending,
    whatsappSendingHttp: createWhatsAppSendingHttp({
      application: whatsappSending,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    whatsappIntake,
    whatsappIntakeHttp: createWhatsAppIntakeHttp({
      application: whatsappIntake,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    whatsapp,
    whatsappHttp: createWhatsAppHttp({
      application: whatsapp,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    emailSequences,
    emailSequencesHttp: createEmailSequenceHttp({
      application: emailSequences,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    campaigns,
    emailHandoffs,
    emailHandoffsHttp: createEmailHandoffHttp({
      application: emailHandoffs,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    campaignsHttp: createCampaignHttp({
      application: campaigns,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    emailEligibility,
    emailEligibilityHttp: createEmailEligibilityHttp({
      application: emailEligibility,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    mailboxes,
    mailboxesHttp: createMailboxHttp({
      application: mailboxes,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    senders,
    senderHealth,
    senderHealthHttp: createSenderHealthHttp({
      application: senderHealth,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    gmail,
    microsoftMail,
    gmailHttp: createGmailHttpHandlers({
      application: gmail,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    microsoftMailHttp: createMicrosoftMailHttpHandlers({
      application: microsoftMail,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
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
    notifications,
    notificationsHttp: createNotificationHttp({
      application: notifications,
      origin: environment.BETTER_AUTH_URL,
      reportFailure,
    }),
    files,
    billing,
    tax,
    taxHttp: createTaxHttp({
      application: tax,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    subscriptionQuotes,
    costs,
    costsHttp: createCostHttp({
      application: costs,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    subscriptionPayments,
    reachChanges,
    reachChangesHttp: createReachChangeHttp({
      application: reachChanges,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    financialAdjustments,
    financialAdjustmentsHttp: createFinancialAdjustmentHttp({
      application: financialAdjustments,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    sellerDocuments,
    sellerDocumentsHttp: createSellerDocumentHttp({
      application: sellerDocuments,
      origin: environment.BETTER_AUTH_URL,
      reportFailure,
    }),
    subscriptionPaymentsHttp: createSubscriptionPaymentHttp({
      application: subscriptionPayments,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    subscriptionQuotesHttp: createSubscriptionQuoteHttp({
      application: subscriptionQuotes,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    billingReviewFiles,
    billingHttp: createBillingHttp({
      application: billing,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
    billingReviewFilesHttp: createFilesHttp({
      application: billingReviewFiles,
      origin: new URL(environment.BETTER_AUTH_URL).origin,
      reportFailure,
    }),
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
