import type { Clock } from "../../src/models/business";
import type {
  MailboxGrant,
  MailboxMetadata,
  MailboxSnapshot,
} from "../../src/models/mailboxes";
import type { IncomingInquiry } from "../../src/models/inbox";

export function mailboxFixture(clock: Clock) {
  const messages: { metadata: MailboxMetadata; event: IncomingInquiry }[] = [];
  const bodyReads: string[] = [];
  const fixture = {
    key: "deterministic-mailbox-v1",
    mode: "fixture" as const,
    bodyReads,
    pageSize: 100,
    failure: false,
    replayFromStart: false,
    reverse() {
      messages.reverse();
    },
    changes: {} as Partial<MailboxGrant>,
    beforeRead: null as null | (() => Promise<void>),
    beforeList: null as null | (() => Promise<void>),
    afterInspect: null as null | ((context: MailboxSnapshot) => Promise<void>),
    async inspect(context: MailboxSnapshot) {
      const observation = {
        provider: context.provider,
        account: context.account,
        revision: "grant-1",
        read: "granted",
        send: "missing",
        folders: null,
        threads: null,
        availableFolders: ["sales", "personal", "other"],
        availableThreads: ["sales-thread", "other-thread"],
        observedAt: clock.now().toISOString(),
        validUntil: new Date(clock.now().getTime() + 3600000).toISOString(),
        ...this.changes,
      };
      await this.afterInspect?.(context);
      return observation;
    },
    async list(context: MailboxSnapshot, grant: MailboxGrant) {
      await this.beforeList?.();
      if (this.failure) throw new Error("sensitive-provider-token-body");
      const offset =
        !this.replayFromStart && context.cursor
          ? Number(context.cursor.replace("cursor-secret-", ""))
          : 0;
      const entries = messages.slice(
        offset,
        offset + Math.min(this.pageSize, context.limit),
      );
      return {
        provider: context.provider,
        account: context.account,
        grantRevision: grant.revision,
        cursor: context.cursor,
        nextCursor: `cursor-secret-${offset + entries.length}`,
        hasMore: offset + entries.length < messages.length,
        messages: entries.map((m) => m.metadata),
      };
    },
    async read(_context: MailboxSnapshot, metadata: MailboxMetadata) {
      await this.beforeRead?.();
      bodyReads.push(metadata.messageRef);
      return messages.find((m) => m.metadata.messageRef === metadata.messageRef)
        ?.event;
    },
    add(ref: string, at: string, changes: Partial<MailboxMetadata> = {}) {
      const metadata: MailboxMetadata = {
        messageRef: ref,
        conversationRef: "sales-thread",
        folderRefs: ["sales"],
        occurredAt: at,
        relevance: "sales",
        ...changes,
      };
      const event: IncomingInquiry = {
        eventId: `event-${ref}`,
        messageRef: ref,
        conversationRef: metadata.conversationRef,
        senderRef: "buyer@example.com",
        senderName: "Buyer",
        geography: "US",
        kind: "direct_inquiry",
        subject: "Steel need",
        text: `Need steel ${ref}`,
        occurredAt: at,
      };
      messages.push({ metadata, event });
    },
  };
  return fixture;
}
