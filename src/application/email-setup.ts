import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { isPendingEmailAccount } from "../models/email-setup";
import type { createMailboxApplication } from "./mailboxes";
import type { createSenderApplication } from "./senders";

export function createEmailSetup(options: {
  mailboxes: Pick<
    ReturnType<typeof createMailboxApplication<Headers>>,
    "workspace" | "save"
  >;
  senders: Pick<
    ReturnType<typeof createSenderApplication<Headers>>,
    "saveConnection"
  >;
  providers: Record<
    "gmail" | "microsoft",
    {
      configured: boolean;
      start(
        credentials: Headers,
        businessId: string,
        mailboxId: string,
      ): Promise<{ authorizationUrl: string }>;
    }
  >;
}) {
  return {
    async start(credentials: Headers, id: unknown, input: unknown) {
      const parsed = z
        .object({
          businessId: z.uuid(),
          input: z.strictObject({ provider: z.enum(["gmail", "microsoft"]) }),
        })
        .safeParse({ businessId: id, input });
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
      const {
        businessId,
        input: { provider },
      } = parsed.data;
      const workspace = await options.mailboxes.workspace(
        credentials,
        businessId,
      );
      if (!workspace.canManage) throw new ApplicationError("FORBIDDEN");
      if (!options.providers[provider].configured)
        throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      let mailbox = workspace.mailboxes.find(
        (m) => m.provider === provider && isPendingEmailAccount(m.account),
      );
      if (!mailbox) {
        const connection =
          workspace.connections.find(
            (c) => c.provider === provider && isPendingEmailAccount(c.account),
          ) ??
          (await options.senders.saveConnection(credentials, businessId, {
            id: null,
            expectedVersion: 0,
            configuration: {
              label:
                provider === "gmail"
                  ? "Google connection"
                  : "Microsoft connection",
              provider,
              account: `connect-${randomUUID()}@pending.leadrelay.invalid`,
              enabled: true,
            },
          }));
        mailbox = await options.mailboxes.save(credentials, businessId, {
          id: null,
          expectedVersion: 0,
          configuration: {
            connectionId: connection.id,
            enabled: true,
            requestedRead: true,
            requestedSend: true,
            scope: { kind: "mailbox" },
            history: null,
          },
        });
      }
      const result = await options.providers[provider].start(
        credentials,
        businessId,
        mailbox.id,
      );
      return { ...result, mailboxId: mailbox.id, provider };
    },
  };
}
