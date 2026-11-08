import { createHash } from "node:crypto";
import { z } from "zod";
import type { createGmailGrantService } from "../application/gmail-grants";
import type { Clock } from "../models/business";
import type {
  MailboxProvider,
  MailboxSnapshot,
  MailboxGrant,
  MailboxPage,
} from "../models/mailboxes";
import { gmailReadScope, gmailSendScope } from "../models/gmail";
import { selectedMetadata } from "../models/mailboxes";
import { ApplicationError } from "../models/application-error";
import { gmailId, gmailMetadata, gmailEvent, messageSchema } from "./messages";
import { GmailFailure, providerValue } from "./http";

const historyId = z.string().regex(/^\d{1,80}$/);
const pageToken = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const cursorSchema = z.strictObject({
  v: z.literal(1),
  phase: z.enum(["scan", "delta", "steady"]),
  historyId,
  page: pageToken.optional(),
  selection: z.number().int().min(0).max(100),
  offset: z.number().int().min(0).max(10000).default(0),
  pending: z.array(gmailId).max(3000).default([]),
  after: z.enum(["page", "steady"]).optional(),
  target: historyId.optional(),
  gap: z.boolean(),
});
type Cursor = z.infer<typeof cursorSchema>;
const refsSchema = z.object({
  messages: z
    .array(z.object({ id: gmailId, threadId: gmailId }))
    .max(100)
    .default([]),
  nextPageToken: pageToken.optional(),
});

export function createGmailProvider(
  repository: ReturnType<typeof createGmailGrantService>,
  clock: Clock,
): MailboxProvider {
  const http = repository.http;
  async function api(
    context: MailboxSnapshot,
    ...args: Parameters<NonNullable<typeof http>["api"]>
  ) {
    await context.authorizeNative?.(
      `gmail:read:${createHash("sha256").update(args[0]).digest("hex")}`,
    );
    return http!.api(...args);
  }

  async function call<T>(
    context: MailboxSnapshot,
    operation: (token: string) => Promise<T>,
    signal: AbortSignal,
  ) {
    if (!http || context.provider !== "gmail")
      throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
    let revision: string | undefined;
    try {
      const credential = await repository.credential(context, signal);
      revision = credential.revision;
      if (!credential.scopes.includes(gmailReadScope))
        throw new GmailFailure("insufficient");
      return await operation(credential.token);
    } catch (error) {
      if (
        error instanceof GmailFailure &&
        ["revoked", "insufficient"].includes(error.reason)
      )
        await repository.fail(context, error, revision);
      throw error;
    }
  }
  return {
    key: "native-gmail-v1",
    mode: http ? "live" : "unconfigured",
    async inspect(context, signal): Promise<MailboxGrant> {
      return call(
        context,
        async (token) => {
          const profile = providerValue(
            z.object({ emailAddress: z.email(), historyId }),
            await api(context, "profile", token, signal),
          );
          if (
            profile.emailAddress.toLowerCase() !== context.account.toLowerCase()
          )
            throw new GmailFailure("account_mismatch");
          const labels = providerValue(
            z.object({
              labels: z
                .array(z.object({ id: z.string().min(1).max(256) }))
                .max(1000),
            }),
            await api(context, "labels", token, signal),
          );
          const availableThreads: string[] = [];
          if (context.configuration.scope.kind === "threads")
            for (const ref of context.configuration.scope.refs) {
              if (!gmailId.safeParse(ref).success)
                throw new GmailFailure("invalid_response");
              try {
                const thread = providerValue(
                  z.object({ id: gmailId }),
                  await api(
                    context,
                    `threads/${encodeURIComponent(ref)}?format=minimal&fields=id`,
                    token,
                    signal,
                  ),
                );
                if (thread.id !== ref)
                  throw new GmailFailure("invalid_response");
                availableThreads.push(ref);
              } catch (error) {
                if (!(
                  error instanceof GmailFailure && error.reason === "not_found"
                ))
                  throw error;
              }
            }
          const credential = await repository.credential(context, signal);
          return {
            provider: "gmail",
            account: context.account,
            revision: credential.revision,
            read: "granted",
            send: credential.scopes.includes(gmailSendScope)
              ? "granted"
              : "missing",
            folders: null,
            threads: null,
            availableFolders: labels.labels.map((l) => l.id),
            availableThreads,
            observedAt: clock.now().toISOString(),
            validUntil: new Date(
              clock.now().getTime() + 5 * 60000,
            ).toISOString(),
          };
        },
        signal,
      );
    },
    async list(context, grant, signal): Promise<MailboxPage> {
      return call(
        context,
        async (token) => {
          let cursor: Cursor;
          if (context.cursor) {
            try {
              cursor = providerValue(cursorSchema, JSON.parse(context.cursor));
            } catch {
              throw new GmailFailure("invalid_response");
            }
          } else {
            const profile = providerValue(
              z.object({ historyId }),
              await api(context, "profile", token, signal),
            );
            cursor = {
              v: 1,
              phase: "scan",
              historyId: profile.historyId,
              selection: 0,
              offset: 0,
              pending: [],
              gap: false,
            };
          }
          let missing = false;
          const result = (
            _ids: string[],
            next: Cursor,
            more: boolean,
            messages: MailboxPage["messages"] = [],
          ): MailboxPage => {
            const gap = next.gap || missing;
            return {
              provider: "gmail",
              account: context.account,
              grantRevision: grant.revision,
              cursor: context.cursor,
              nextCursor: JSON.stringify(
                providerValue(cursorSchema, { ...next, gap }),
              ),
              hasMore: more,
              messages,
              completeReplyCapture: false,
              visibility: gap
                ? more
                  ? "recovering"
                  : "limited"
                : more
                  ? "recovering"
                  : "current",
            };
          };
          const load = async (ids: string[]) => {
            const messages: MailboxPage["messages"] = [];
            for (const id of ids) {
              try {
                const message = providerValue(
                  messageSchema,
                  await api(
                    context,
                    `messages/${encodeURIComponent(id)}?format=metadata`,
                    token,
                    signal,
                  ),
                );
                if (message.id !== id)
                  throw new GmailFailure("invalid_response");
                const metadata = gmailMetadata(message, context);
                if (
                  metadata.relevance === "unknown" &&
                  context.knownThreads?.includes(metadata.conversationRef) &&
                  selectedMetadata(
                    context.configuration,
                    { ...metadata, relevance: "sales" },
                    context.incrementalSince,
                    context.mode,
                  )
                )
                  missing = true;
                messages.push(metadata);
              } catch (error) {
                if (!(
                  error instanceof GmailFailure && error.reason === "not_found"
                ))
                  throw error;
                missing = true;
              }
            }
            return messages;
          };
          const scope = context.configuration.scope;
          if (cursor.phase === "scan") {
            let ids: string[] = [],
              nextPage: string | undefined;
            try {
              if (scope.kind === "threads") {
                const id = scope.refs[cursor.selection];
                const thread = providerValue(
                  z.object({
                    id: gmailId,
                    messages: z.array(messageSchema).max(10000).default([]),
                  }),
                  await api(
                    context,
                    `threads/${encodeURIComponent(id)}?format=metadata`,
                    token,
                    signal,
                  ),
                );
                if (thread.id !== id)
                  throw new GmailFailure("invalid_response");
                const selected = thread.messages
                  .map((m) => gmailMetadata(m, context))
                  .filter((m) =>
                    selectedMetadata(
                      context.configuration,
                      m,
                      context.incrementalSince,
                      context.mode,
                    ),
                  );
                const messages = selected.slice(
                  cursor.offset,
                  cursor.offset + context.limit,
                );
                const within =
                  cursor.offset + messages.length < selected.length;
                const next = {
                  ...cursor,
                  offset: within ? cursor.offset + messages.length : 0,
                  selection: within ? cursor.selection : cursor.selection + 1,
                };
                const moreSelections = next.selection < scope.refs.length;
                if (!moreSelections) {
                  next.phase = context.mode === "history" ? "steady" : "delta";
                  next.selection = 0;
                }
                return result(
                  [],
                  next,
                  moreSelections || context.mode !== "history",
                  messages,
                );
              }
              const from =
                context.mode === "history"
                  ? context.configuration.history!.from
                  : context.incrementalSince;
              const query = new URLSearchParams({
                maxResults: String(context.limit),
                q: `after:${Math.floor(new Date(from).getTime() / 1000) - 1}${context.mode === "history" ? ` before:${Math.ceil(new Date(context.configuration.history!.to).getTime() / 1000)}` : ""}`,
                includeSpamTrash: "false",
              });
              if (scope.kind === "folders")
                query.set("labelIds", scope.refs[cursor.selection]);
              if (cursor.page) query.set("pageToken", cursor.page);
              const page = providerValue(
                refsSchema,
                await api(context, `messages?${query}`, token, signal),
              );
              ids = page.messages.map((m) => m.id);
              nextPage = page.nextPageToken;
            } catch (error) {
              if (!(
                error instanceof GmailFailure &&
                error.reason === "invalid_page" &&
                cursor.page
              ))
                throw error;
              return result(
                [],
                {
                  ...cursor,
                  page: undefined,
                  selection: 0,
                  offset: 0,
                  gap: true,
                },
                true,
              );
            }
            const moreSelections =
              scope.kind === "folders" &&
              cursor.selection + 1 < scope.refs.length;
            const phase =
              nextPage || moreSelections
                ? "scan"
                : context.mode === "history"
                  ? "steady"
                  : "delta";
            const next: Cursor = {
              ...cursor,
              phase,
              page: nextPage,
              selection: nextPage
                ? cursor.selection
                : moreSelections
                  ? cursor.selection + 1
                  : 0,
            };
            return result(ids, next, phase !== "steady", await load(ids));
          }
          if (context.mode === "history")
            return result([], { ...cursor, phase: "steady" }, false);
          if (cursor.pending.length) {
            const ids = cursor.pending.slice(0, context.limit),
              pending = cursor.pending.slice(context.limit);
            const steady = !pending.length && cursor.after === "steady";
            return result(
              ids,
              {
                ...cursor,
                pending,
                phase: steady ? "steady" : "delta",
                historyId: steady ? cursor.target! : cursor.historyId,
              },
              !steady,
              await load(ids),
            );
          }
          const query = new URLSearchParams({
            startHistoryId: cursor.historyId,
            maxResults: "10",
          });
          if (cursor.page) query.set("pageToken", cursor.page);
          try {
            const changed = z.object({ message: z.object({ id: gmailId }) });
            const removed = z.object({
              message: z.object({
                id: gmailId,
                threadId: gmailId.optional(),
                labelIds: z.array(z.string().max(256)).max(100).optional(),
              }),
            });
            const history = providerValue(
              z.object({
                historyId,
                nextPageToken: pageToken.optional(),
                history: z
                  .array(
                    z.object({
                      id: historyId,
                      messagesAdded: z.array(changed).max(100).optional(),
                      labelsAdded: z.array(changed).max(100).optional(),
                      labelsRemoved: z.array(changed).max(100).optional(),
                      messagesDeleted: z.array(removed).max(100).optional(),
                    }),
                  )
                  .max(10)
                  .default([]),
              }),
              await api(context, `history?${query}`, token, signal),
            );
            if (
              history.history.some((h) =>
                h.messagesDeleted?.some(({ message }) =>
                  scope.kind === "threads"
                    ? !message.threadId || scope.refs.includes(message.threadId)
                    : scope.kind === "folders"
                      ? !message.labelIds ||
                        scope.refs.some((id) => message.labelIds?.includes(id))
                      : !message.threadId ||
                        context.knownThreads?.includes(message.threadId),
                ),
              )
            )
              missing = true;
            const ids = [
              ...new Set(
                history.history.flatMap((h) =>
                  [
                    ...(h.messagesAdded ?? []),
                    ...(h.labelsAdded ?? []),
                    ...(h.labelsRemoved ?? []),
                  ].map((m) => m.message.id),
                ),
              ),
            ];
            const selected = ids.slice(0, context.limit),
              pending = ids.slice(context.limit);
            const more = Boolean(history.nextPageToken || pending.length);
            const next: Cursor = {
              ...cursor,
              phase: more ? "delta" : "steady",
              page: history.nextPageToken,
              historyId: more ? cursor.historyId : history.historyId,
              pending,
              target: history.historyId,
              after: history.nextPageToken ? "page" : "steady",
            };
            return result(selected, next, more, await load(selected));
          } catch (error) {
            if (!(
              error instanceof GmailFailure &&
              (error.reason === "not_found" ||
                (error.reason === "invalid_page" && cursor.page))
            ))
              throw error;
            const profile = providerValue(
              z.object({ historyId }),
              await api(context, "profile", token, signal),
            );
            return result(
              [],
              {
                v: 1,
                phase: "scan",
                historyId: profile.historyId,
                selection: 0,
                offset: 0,
                pending: [],
                gap: true,
              },
              true,
            );
          }
        },
        signal,
      );
    },
    read(context, metadata, signal) {
      return call(
        context,
        async (token) =>
          gmailEvent(
            await api(
              context,
              `messages/${encodeURIComponent(metadata.messageRef)}?format=full`,
              token,
              signal,
            ),
            context,
            metadata,
          ),
        signal,
      );
    },
  };
}
