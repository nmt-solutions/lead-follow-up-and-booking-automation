import { createHash, randomUUID } from "node:crypto";
import type { SignInMailer } from "../auth/auth";
import type { InvitationMailer } from "../models/team";
import { z } from "zod";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  notificationTermsSchema,
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
      binding,
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
  return {
    signInMailer,
    invitationMailer,
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
        account: config.account,
        mode: config.mode,
        sender: config.from,
        webhookConfigured: Boolean(config.webhookSecret),
        recoveryConfigured: d.recoveryConfigured ?? false,
      };
    },
    async recoverPending() {
      let recovered = 0;
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
