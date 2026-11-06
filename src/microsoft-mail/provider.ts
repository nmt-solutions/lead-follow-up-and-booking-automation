import { createHash } from "node:crypto";
import { z } from "zod";
import type { createMicrosoftMailGrantService } from "../application/microsoft-mail-grants";
import type { Clock } from "../models/business";
import type {
  MailboxProvider,
  MailboxSnapshot,
  MailboxGrant,
  MailboxPage,
} from "../models/mailboxes";
import { selectedMetadata } from "../models/mailboxes";
import { ApplicationError } from "../models/application-error";
import {
  MicrosoftMailFailure,
  microsoftMailReadScope,
  microsoftMailSendScope,
} from "../models/microsoft-mail";
import { graphMailUrl, microsoftValue } from "./http";
import {
  graphId,
  graphMetadata,
  graphEvent,
  graphMessageSchema,
  graphMetadataFields,
} from "./messages";

const link = z.string().min(1).max(8192);
import { loadMicrosoftMailFolders } from "./folders";
const cursorSchema = z.strictObject({
  v: z.literal(1),
  query: z.string().regex(/^[a-f0-9]{64}$/),
  index: z.number().int().min(0).max(49),
  gap: z.boolean(),
  baselineComplete: z.boolean().default(false),
  folders: z
    .array(z.strictObject({ id: graphId, link: link.nullable() }))
    .min(1)
    .max(50),
});
function queryKey(context: MailboxSnapshot) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        context.work.businessId,
        context.work.mailboxId,
        context.account,
        context.configuration.scope,
        context.configuration.salesSubjectTerms ?? [],
        context.mode,
        context.mode === "history"
          ? context.configuration.history
          : context.incrementalSince,
      ]),
    )
    .digest("hex");
}
/** A continuation stays on its exact selected /me collection. Opaque tokens are never decoded or rewritten. */
function continuation(value: string, path: string, filter: string | null) {
  const url = graphMailUrl(value, `/v1.0/${path}`);
  const allowed = new Set([
    "$skiptoken",
    "$deltatoken",
    "$select",
    "$filter",
    "$top",
  ]);
  for (const key of url.searchParams.keys())
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
      throw new MicrosoftMailFailure("invalid_response");
  if (
    (url.searchParams.has("$select") &&
      ![
        graphMetadataFields,
        // Existing #30 delta links remain opaque and usable. Each referenced message is
        // still fetched independently with the current metadata selection (including Reply-To).
        graphMetadataFields.replace(",replyTo", ""),
      ].includes(url.searchParams.get("$select")!)) ||
    (url.searchParams.has("$filter") &&
      url.searchParams.get("$filter") !== filter)
  )
    throw new MicrosoftMailFailure("invalid_response");
  const top = url.searchParams.get("$top");
  if (
    top &&
    (!/^\d{1,3}$/.test(top) ||
      Number(top) < 1 ||
      Number(top) > (path.endsWith("/delta") ? 100 : 1))
  )
    throw new MicrosoftMailFailure("invalid_response");
  return url.toString();
}
export function createMicrosoftMailProvider(
  connection: ReturnType<typeof createMicrosoftMailGrantService>,
  clock: Clock,
): MailboxProvider {
  const http = connection.http;
  async function call<T>(
    context: MailboxSnapshot,
    signal: AbortSignal,
    operation: (token: string, revision: string, ownerId: string) => Promise<T>,
  ) {
    if (!http || context.provider !== "microsoft")
      throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
    let revision: string | undefined;
    try {
      const c = await connection.credential(context, signal);
      revision = c.revision;
      if (!c.scopes.includes(microsoftMailReadScope))
        throw new MicrosoftMailFailure("insufficient");
      return await operation(c.token, revision, c.ownerId);
    } catch (error) {
      if (error instanceof MicrosoftMailFailure)
        await connection.fail(context, error, revision);
      throw error;
    }
  }
  async function nativeFolders(token: string, signal: AbortSignal) {
    const ids: string[] = [];
    for (const alias of [
      "sentitems",
      "drafts",
      "junkemail",
      "deleteditems",
      "outbox",
    ])
      ids.push(
        microsoftValue(
          z.object({ id: graphId }),
          await http!.api(`me/mailFolders/${alias}?$select=id`, token, signal),
        ).id,
      );
    return { sentFolderRef: ids[0], excludedFolderRefs: ids.slice(1) };
  }
  return {
    key: "native-microsoft-mail-v1",
    mode: http ? "live" : "unconfigured",
    inspect(context, signal): Promise<MailboxGrant> {
      return call(context, signal, async (token, revision, ownerId) => {
        const purpose = microsoftValue(
          z.object({ userPurpose: z.string() }),
          await http!.api(
            "me/mailboxSettings?$select=userPurpose",
            token,
            signal,
          ),
        );
        if (purpose.userPurpose !== "user")
          throw new MicrosoftMailFailure("unsupported_account");
        const profile = await http!.profile(token, signal);
        if (
          profile.id !== ownerId ||
          (profile.mail ?? profile.userPrincipalName)?.toLowerCase() !==
            context.account.toLowerCase()
        )
          throw new MicrosoftMailFailure("account_mismatch");
        const available = await loadMicrosoftMailFolders(
            http!,
            token,
            signal,
            context.configuration.scope.kind === "folders"
              ? context.configuration.scope.refs
              : undefined,
          ),
          microsoft = await nativeFolders(token, signal),
          availableThreads: string[] = [];
        if (context.configuration.scope.kind === "threads")
          for (const ref of context.configuration.scope.refs) {
            microsoftValue(graphId, ref);
            const query = new URLSearchParams({
              $filter: `conversationId eq '${ref.replace(/'/g, "''")}'`,
              $select: "id,conversationId",
              $top: "1",
            });
            const page = microsoftValue(
              z.object({
                value: z
                  .array(
                    z.object({ id: graphId, conversationId: z.literal(ref) }),
                  )
                  .max(1),
              }),
              await http!.api(`me/messages?${query}`, token, signal),
            );
            if (page.value.length) availableThreads.push(ref);
          }
        const c = await connection.credential(context, signal);
        if (c.revision !== revision) throw new ApplicationError("CONFLICT");
        return {
          provider: "microsoft",
          account: context.account,
          revision,
          read: "granted",
          send: c.scopes.includes(microsoftMailSendScope)
            ? "granted"
            : "missing",
          folders: null,
          threads: null,
          availableFolders: available.map((f) => f.id),
          availableThreads,
          microsoft,
          observedAt: clock.now().toISOString(),
          validUntil: new Date(clock.now().getTime() + 300000).toISOString(),
        };
      });
    },
    list(context, grant, signal): Promise<MailboxPage> {
      return call(context, signal, async (token) => {
        if (!grant.microsoft)
          throw new MicrosoftMailFailure("invalid_response");
        const query = queryKey(context);
        let cursor: z.infer<typeof cursorSchema>;
        try {
          cursor = context.cursor
            ? microsoftValue(cursorSchema, JSON.parse(context.cursor))
            : {
                v: 1,
                query,
                index: 0,
                gap: false,
                baselineComplete: false,
                folders: grant.availableFolders
                  .filter(
                    (id) => !grant.microsoft!.excludedFolderRefs.includes(id),
                  )
                  .map((id) => ({ id, link: null })),
              };
        } catch {
          throw new MicrosoftMailFailure("invalid_response");
        }
        if (
          cursor.query !== query ||
          !cursor.folders.length ||
          cursor.index >= cursor.folders.length ||
          cursor.folders.some((f) => !grant.availableFolders.includes(f.id))
        )
          throw new MicrosoftMailFailure("invalid_response");
        // Mailbox/thread selections include newly observed folders without changing the authorized time boundary.
        if (context.configuration.scope.kind !== "folders") {
          for (const id of grant.availableFolders)
            if (
              !grant.microsoft.excludedFolderRefs.includes(id) &&
              !cursor.folders.some((f) => f.id === id)
            ) {
              cursor.folders.push({ id, link: null });
              cursor.baselineComplete = false;
            }
        }
        const folder = cursor.folders[cursor.index],
          incremental = context.mode === "incremental";
        const path = `me/mailFolders/${encodeURIComponent(folder.id)}/messages${incremental ? "/delta" : ""}`;
        // Filtered delta can cap results at 5,000. Enumerate selected-folder metadata only; the application enforces the new-mail boundary before bodies.
        const timeField =
          folder.id === grant.microsoft.sentFolderRef
            ? "sentDateTime"
            : "receivedDateTime";
        const filter = incremental
          ? null
          : `${timeField} ge ${context.configuration.history!.from} and ${timeField} lt ${context.configuration.history!.to}`;
        const initial = `${path}?${new URLSearchParams({ $select: graphMetadataFields, ...(filter ? { $filter: filter } : {}), $top: incremental ? "100" : "1" })}`;
        const previouslyCurrent =
          incremental &&
          Boolean(context.cursor && context.permissionObservation) &&
          cursor.baselineComplete &&
          context.visibility === "current" &&
          !cursor.gap;
        const result = (
          messages: MailboxPage["messages"],
          more: boolean,
        ): MailboxPage => ({
          provider: "microsoft",
          account: context.account,
          grantRevision: grant.revision,
          cursor: context.cursor,
          nextCursor: JSON.stringify(microsoftValue(cursorSchema, cursor)),
          hasMore: more,
          messages,
          visibility: cursor.gap
            ? more
              ? "recovering"
              : "limited"
            : more && !previouslyCurrent
              ? "recovering"
              : "current",
          completeReplyCapture: false,
        });
        let raw: unknown;
        try {
          raw = await http!.api(
            folder.link ? continuation(folder.link, path, filter) : initial,
            token,
            signal,
            `/v1.0/${path}`,
          );
        } catch (error) {
          if (!(
            error instanceof MicrosoftMailFailure &&
            error.reason === "delta_expired" &&
            folder.link
          ))
            throw error;
          folder.link = null;
          cursor.gap = true;
          cursor.baselineComplete = false;
          return result([], true);
        }
        const page = microsoftValue(
          z
            .object({
              value: z
                .array(
                  z.object({
                    id: graphId,
                    "@removed": z
                      .object({ reason: z.enum(["deleted", "changed"]) })
                      .optional(),
                  }),
                )
                .max(incremental ? 100 : 1),
              "@odata.nextLink": link.optional(),
              "@odata.deltaLink": link.optional(),
            })
            .refine((p) =>
              incremental
                ? Boolean(p["@odata.nextLink"]) !==
                  Boolean(p["@odata.deltaLink"])
                : !p["@odata.deltaLink"],
            ),
          raw,
        );
        const next = page["@odata.nextLink"] ?? page["@odata.deltaLink"];
        if (next) continuation(next, path, filter);
        const messages: MailboxPage["messages"] = [];
        for (const entry of page.value) {
          try {
            const value = microsoftValue(
              graphMessageSchema,
              await http!.api(
                `me/messages/${encodeURIComponent(entry.id)}?$select=${graphMetadataFields}`,
                token,
                signal,
              ),
            );
            if (value.id !== entry.id)
              throw new MicrosoftMailFailure("invalid_response");
            const metadata = graphMetadata(value, context, grant.microsoft);
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
              cursor.gap = true;
            messages.push(metadata);
          } catch (error) {
            if (!(
              error instanceof MicrosoftMailFailure &&
              error.reason === "not_found"
            ))
              throw error;
            cursor.gap = true;
          }
        }
        folder.link = next ?? null;
        const more =
          Boolean(page["@odata.nextLink"]) ||
          cursor.index + 1 < cursor.folders.length;
        if (!page["@odata.nextLink"])
          cursor.index = more ? cursor.index + 1 : 0;
        if (!more) cursor.baselineComplete = true;
        return result(messages, more);
      });
    },
    read(context, metadata, signal) {
      return call(context, signal, async (token) => {
        const native = await nativeFolders(token, signal);
        return graphEvent(
          await http!.api(
            `me/messages/${encodeURIComponent(metadata.messageRef)}?$select=${graphMetadataFields},body`,
            token,
            signal,
          ),
          context,
          metadata,
          native,
        );
      });
    },
  };
}
