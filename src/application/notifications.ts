import { createHash, randomUUID } from "node:crypto";
import type { SignInMailer } from "../auth/auth";
import type { InvitationMailer } from "../models/team";
import type { CostMailer } from "../models/costs";
import { z } from "zod";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  notificationTermsSchema,
  notificationPreferenceSchema,
  type NotificationConfiguration,
  type NotificationProvider,
  type NoticeWork,
  type NoticeDraft,
  type NativeNotificationMail,
  type NotificationWorkspace,
} from "../models/notifications";
import type {
  createNotificationRepository,
  NotificationBinding,
} from "../db/notification-repository";
import type { notificationVault } from "../notifications/vault";
import { NotificationDeliveryError } from "../notifications/resend";
import { verifyNotificationWebhook } from "../notifications/webhook";
import { needsAttention } from "./operations";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function createNotificationApplication<C>(d: {
  authenticatePlatform(credentials: C): Promise<Actor>;
  authenticate(credentials: C): Promise<Actor>;
  repository: ReturnType<typeof createNotificationRepository>;
  provider: NotificationProvider;
  vault: ReturnType<typeof notificationVault>;
  configuration: NotificationConfiguration;
  recoveryConfigured?: boolean;
  deployment?: NotificationWorkspace["deployment"];
}) {
  const r = d.repository,
    config = d.configuration;
  const binding: NotificationBinding = {
    account: config.account,
    mode: config.mode,
    from: config.from,
    domainId: config.domainId,
    keyRef: hash(config.apiKey),
    receiverRef: config.webhookSecret ? hash(config.webhookSecret) : "",
  };
  const payloadBinding = (id: string, purpose: string, sourceId: string) =>
    JSON.stringify([config.account, id, purpose, sourceId]);
  async function deliver(work: NoticeWork) {
    const saved = await r.outcome(work);
    if (saved.providerId) return { id: saved.providerId };
    const claim = await r.claim(work, binding);
    if (!claim) throw new ApplicationError("PROVIDER_UNAVAILABLE");
    try {
      const mail = d.vault.open(
        claim.sealed,
        payloadBinding(claim.id, claim.purpose, claim.sourceId),
        claim.now,
      );
      if (
        config.mode === "test_recipient" &&
        mail.to[0].toLowerCase() !== config.testRecipient?.toLowerCase()
      )
        throw new ApplicationError("CONFLICT");
      if (!(await r.gate(claim))) {
        await r.finish(claim, "held", null, 60);
        throw new ApplicationError("FORBIDDEN");
      }
      const result = await d.provider.send(mail, claim.key);
      await r.finish(claim, "accepted", result.id, result.waitSeconds);
      return { id: result.id };
    } catch (error: unknown) {
      const failure =
        error instanceof NotificationDeliveryError
          ? error
          : new NotificationDeliveryError(
              error instanceof ApplicationError && error.code === "CONFLICT"
                ? "held"
                : "uncertain",
            );
      await r.finish(claim, failure.state, null, failure.waitSeconds);
      throw new ApplicationError("PROVIDER_UNAVAILABLE");
    }
  }
  async function produce(
    source: Omit<NoticeDraft, "payloadHash" | "sealed" | "key"> & {
      key: string;
    },
    mail: NativeNotificationMail,
  ) {
    const authority = await r.source(source);
    if (!authority) throw new ApplicationError("FORBIDDEN");
    const work = await r.enqueue(
      {
        ...source,
        payloadHash: hash(JSON.stringify(mail)),
        sealed: d.vault.seal(
          mail,
          payloadBinding(source.id, source.purpose, source.sourceId),
          authority.expiresAt,
        ),
      },
      { ...binding, from: mail.from },
    );
    return deliver(work);
  }
  const signInMailer: SignInMailer = {
    async send({ email, url }) {
      // The public response never reveals provider acceptance, account existence,
      // queued work or setup. Better Auth has already committed its hashed token.
      try {
        const parsed = new URL(url),
          token = parsed.searchParams.get("token");
        if (
          parsed.origin !== new URL(config.origin).origin ||
          parsed.pathname !== "/api/auth/magic-link/verify" ||
          !token
        )
          throw new ApplicationError("INVALID_INPUT");
        const id = randomUUID();
        await produce(
          {
            id,
            purpose: "authentication",
            sourceStage: "magic_link_requested",
            sourceId: id,
            businessId: null,
            actorId: null,
            authority: `magic-link:${createHash("sha256").update(token).digest("base64url")}`,
            key: `authentication/${id}`,
          },
          {
            from: config.from,
            to: [email],
            subject: "Sign in to your Business",
            text: `Use this link to sign in:\n\n${url}\n\nIt expires in 10 minutes and can only be used once. If you did not request it, ignore this email.`,
          },
        );
      } catch {
        /* Safe generic response; persisted attempts recover independently. */
      }
    },
  };
  const invitationMailer: InvitationMailer = {
    async send(message) {
      const url = new URL(message.url);
      const token = new URLSearchParams(url.hash.slice(1)).get("token");
      if (
        url.origin !== new URL(config.origin).origin ||
        url.pathname !== "/invitations" ||
        !token
      )
        throw new ApplicationError("INVALID_INPUT");
      const source = {
        id: randomUUID(),
        purpose: "invitation" as const,
        sourceStage: "invitation_pending",
        sourceId: message.invitationId,
        businessId: message.businessId,
        actorId: message.actorId,
        authority: `${message.invitationId}:${hash(token)}`,
        key: `business-invitation/${message.invitationId}`,
      };
      const current = await r.source(source);
      if (
        !current ||
        current.email !== message.email ||
        current.businessName !== message.businessName ||
        current.role !== message.role ||
        current.invitationExpiresAt?.getTime() !== message.expiresAt.getTime()
      )
        throw new ApplicationError("FORBIDDEN");
      await produce(source, {
        from: config.from,
        to: [message.email],
        subject: `Invitation to ${message.businessName}`,
        text: `You have been invited to ${message.businessName} as ${message.role}.\n\nSign in with ${message.email} and accept the invitation:\n${message.url}\n\nExpires: ${message.expiresAt.toISOString()}. If you did not expect this invitation, ignore it.`,
      });
    },
  };
  const costMailer: CostMailer = {
    async send(message) {
      const source = {
        id: randomUUID(),
        purpose: "cost_alert" as const,
        sourceStage: "budget_threshold_available",
        sourceId: message.authority.alertId,
        businessId: null,
        actorId: message.authority.actorId,
        authority: message.authority.lease,
        key: message.key,
      };
      const current = await r.source(source);
      if (
        !current ||
        current.email !== message.email ||
        current.summary !== message.text ||
        message.key !== `operator-cost/${message.authority.alertId}`
      )
        throw new ApplicationError("FORBIDDEN");
      const from = config.costFrom ?? config.from;
      return produce(source, {
        from,
        to: [message.email],
        subject: "Operator budget threshold reached",
        text: message.text,
      });
    },
  };
  return {
    async setPreference(c: C, businessId: unknown, value: unknown) {
      const tenant = z.uuid().nullable().safeParse(businessId),
        choice = notificationPreferenceSchema.safeParse(value);
      if (!tenant.success || !choice.success)
        throw new ApplicationError("INVALID_INPUT");
      const actor = tenant.data
        ? await d.authenticate(c)
        : await d.authenticatePlatform(c);
      await r.setPreference(actor, config.account, tenant.data, choice.data);
    },
    async preferences(c: C, businessId: unknown) {
      const tenant = z.uuid().nullable().safeParse(businessId);
      if (!tenant.success) throw new ApplicationError("INVALID_INPUT");
      return r.preferences(
        tenant.data ? await d.authenticate(c) : await d.authenticatePlatform(c),
        config.account,
        tenant.data,
      );
    },
    signInMailer,
    invitationMailer,
    costMailer,
    async retry(c: C, value: unknown) {
      const id = z.uuid().safeParse(value);
      if (!id.success) throw new ApplicationError("INVALID_INPUT");
      const work = await r.retry(
        await d.authenticatePlatform(c),
        config.account,
        id.data,
      );
      try {
        await deliver(work);
      } catch {
        /* Status retains the exact reason and next permitted attempt. */
      }
      return r.workspace(await d.authenticatePlatform(c), config.account);
    },
    async receiveWebhook(raw: Buffer, headers: Headers) {
      const receipt = verifyNotificationWebhook(
        raw,
        headers,
        config,
        await r.time(),
      );
      if (receipt) await r.receive(binding, receipt);
      return { received: true as const };
    },
    async businessWorkspace(c: C, businessId: unknown) {
      const parsed = z.uuid().safeParse(businessId);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      return r.businessWorkspace(
        await d.authenticate(c),
        config.account,
        parsed.data,
      );
    },
    async selectTerms(c: C, value: unknown) {
      const actor = await d.authenticatePlatform(c),
        parsed = notificationTermsSchema.safeParse(value);
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      await r.selectTerms(actor, config.account, parsed.data);
    },
    async refreshSetup(c: C) {
      const actor = await d.authenticatePlatform(c);
      const inspection = await r.beginSetup(actor, binding);
      const setup = await d.provider.inspect();
      const current = await d.authenticatePlatform(c);
      await r.saveSetup(current, binding, inspection, setup);
      return setup;
    },
    async workspace(c: C): Promise<NotificationWorkspace> {
      const state = await r.workspace(
        await d.authenticatePlatform(c),
        config.account,
      );
      return {
        ...state,
        deployment: d.deployment ?? {
          account: true,
          domain: true,
          mode: true,
          payloadKey: true,
          readKey: Boolean(config.readApiKey),
          sendingKey: Boolean(config.apiKey),
        },
        account: config.account,
        mode: config.mode,
        sender: config.from,
        webhookConfigured: Boolean(config.webhookSecret),
        recoveryConfigured: d.recoveryConfigured ?? false,
      };
    },
    async recoverPending() {
      let recovered = 0;
      await r.syncCosts(config.account);
      const inspection = await r.maintenanceSetup(binding);
      if (inspection)
        await r.saveSetup(
          { userId: inspection.actorId },
          binding,
          inspection,
          await d.provider.inspect(),
        );
      for (const candidate of await r.candidates(config.account)) {
        const source = await r.source(candidate);
        if (!source?.email) continue;
        if (
          candidate.purpose === "operations" &&
          source.outcome !== "escalated" &&
          (!source.snapshot ||
            !source.currentSnapshot ||
            !needsAttention(source.snapshot) ||
            !needsAttention(source.currentSnapshot))
        )
          continue;
        const path =
          source.financial && candidate.businessId
            ? `/businesses/${candidate.businessId}/financial-adjustments`
            : source.healthOnly
              ? "/platform/sender-health"
              : candidate.businessId
                ? `/businesses/${candidate.businessId}/${candidate.purpose === "subscription" ? "subscription-payments" : "operations"}`
                : `/platform/${candidate.purpose === "subscription" ? "subscription-payments" : "operations"}`;
        try {
          await produce(
            {
              ...candidate,
              key: `platform-notice/${hash(candidate.sourceId)}`,
            },
            {
              from: config.from,
              to: [source.email],
              subject: source.financial
                ? "Refund or dispute status updated"
                : candidate.purpose === "subscription"
                  ? "Subscription status updated"
                  : "Platform action needs attention",
              text: `A saved ${candidate.purpose === "subscription" ? "subscription" : "platform"} notice is available. Recorded stage: ${candidate.sourceStage}. Review current status and the responsible next action:\n\n${new URL(path, config.origin).toString()}`,
            },
          );
        } catch {
          /* Persisted work retains its selected audience and exact source stage. */
        }
      }
      for (const work of await r.work(config.account)) {
        try {
          await deliver(work);
          recovered++;
        } catch {
          /* Durable state contains the safe recovery reason. */
        }
      }
      await r.prune();
      return { recovered };
    },
  };
}
