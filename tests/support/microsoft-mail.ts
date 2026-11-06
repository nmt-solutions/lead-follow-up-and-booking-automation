import { microsoftFixture } from "./microsoft-calendar";
import type { Clock } from "../../src/models/business";

export function microsoftMailFixture(clock: Clock) {
  const identity = microsoftFixture(clock);
  identity.control.email = "sales@supplier.example";
  identity.control.scopes =
    "openid email profile offline_access User.Read Mail.Read MailboxSettings.Read";
  const messages = new Map<string, Record<string, unknown>>();
  const pages = new Map<string, unknown>();
  const sends: string[] = [];
  const bodyReads: string[] = [];
  const calls: { url: URL; headers: Headers }[] = [];
  const control = {
    purpose: "user",
    userType: "Member",
    ownerId: "profile-id",
    apiError: 0,
    sendError: 0,
    sendLost: false,
    sendMalformed: false,
    unexpectedAcceptedBody: false,
    expiresIn: 3600,
    errorCode: "ErrorAccessDenied",
    retryAfter: "60",
    beforeBody: undefined as (() => Promise<void>) | undefined,
    folders: ["sales", "sent", "inbox", "other"],
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const response = (raw: unknown, status = 200) =>
      new Response(JSON.stringify(raw), { status });
    if (url.hostname !== "graph.microsoft.com") {
      const result = await identity.fetch(input, init);
      if (url.pathname.endsWith("/token") && result.ok)
        return response({
          ...(await result.json()),
          expires_in: control.expiresIn,
        });
      return result;
    }
    if (control.apiError)
      return new Response(
        JSON.stringify({
          error: { code: control.errorCode, message: "private-token-payload" },
        }),
        {
          status: control.apiError,
          headers: { "Retry-After": control.retryAfter },
        },
      );
    if (
      init?.method === "POST" &&
      (url.pathname.endsWith("/sendMail") || url.pathname.endsWith("/reply"))
    ) {
      sends.push(Buffer.from(String(init.body), "base64").toString("utf8"));
      if (control.sendLost) throw new Error("private-graph-response-lost");
      if (control.sendError)
        return new Response(
          JSON.stringify({
            error: {
              code: "ErrorAccessDenied",
              message: "private-token-payload",
            },
          }),
          {
            status: control.sendError,
            headers: { "Retry-After": control.retryAfter },
          },
        );
      return new Response(
        control.sendMalformed || control.unexpectedAcceptedBody
          ? "malformed-private"
          : null,
        {
          status: control.sendMalformed ? 200 : 202,
        },
      );
    }
    if (url.pathname === "/v1.0/me")
      return response({
        id: control.ownerId,
        mail: identity.control.email,
        userPrincipalName: identity.control.email,
        userType: control.userType,
      });
    if (url.pathname === "/v1.0/me/mailboxSettings")
      return response({ userPurpose: control.purpose });
    if (/\/mailFolders\/[^/]+$/.test(url.pathname)) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      const canonical = id === "sentitems" ? "sent" : id;
      return response({
        id: canonical,
        displayName: canonical,
        childFolderCount: 0,
      });
    }
    if (url.pathname.endsWith("/mailFolders"))
      return response({
        value: control.folders.map((id) => ({
          id,
          displayName: id,
          childFolderCount: 0,
        })),
      });
    if (
      url.pathname.endsWith("/messages/delta") ||
      url.pathname.endsWith("/messages")
    ) {
      if (url.pathname === "/v1.0/me/messages") {
        const thread = /^conversationId eq '([^']+)'$/.exec(
          url.searchParams.get("$filter") ?? "",
        )?.[1];
        return response({
          value: [...messages.values()]
            .filter((m) => !thread || m.conversationId === thread)
            .slice(0, 1)
            .map((m) => ({ id: m.id, conversationId: m.conversationId })),
        });
      }
      const folder =
        url.pathname.split("/").at(url.pathname.endsWith("/delta") ? -3 : -2) ??
        "mailbox";
      const key =
        url.searchParams.get("$skiptoken") ??
        url.searchParams.get("$deltatoken") ??
        folder;
      const page = pages.get(key);
      if (page === "expired")
        return response({ error: { code: "syncStateNotFound" } }, 410);
      return response(
        page ?? {
          value: [],
          ...(url.pathname.endsWith("/delta")
            ? {
                "@odata.deltaLink": `https://graph.microsoft.com${url.pathname}?$deltatoken=${folder}-steady`,
              }
            : {}),
        },
      );
    }
    if (url.pathname.includes("/messages/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1)!);
      const message = messages.get(id);
      if (!message) return response({}, 404);
      if (url.searchParams.get("$select")?.split(",").includes("body")) {
        await control.beforeBody?.();
        bodyReads.push(id);
        return response(message);
      }
      const { body: _body, ...metadata } = message;
      void _body;
      return response(metadata);
    }
    throw new Error("Unexpected Microsoft mail endpoint");
  };
  function add(
    id: string,
    options: {
      at?: string;
      thread?: string;
      folder?: string;
      from?: string;
      to?: string;
      bcc?: string;
      reply?: string;
      subject?: string;
      text?: string;
    } = {},
  ) {
    const from = options.from ?? "buyer@example.com";
    const message = {
      id,
      conversationId: options.thread ?? "thread-1",
      parentFolderId: options.folder ?? "sales",
      receivedDateTime: options.at ?? "2026-11-05T09:01:00Z",
      sentDateTime: options.at ?? "2026-11-05T09:01:00Z",
      isDraft: false,
      subject: options.subject ?? "Steel inquiry",
      internetMessageId: `<${id}@example.com>`,
      from: { emailAddress: { address: from } },
      sender: { emailAddress: { address: from } },
      toRecipients: [
        { emailAddress: { address: options.to ?? identity.control.email } },
      ],
      ccRecipients: [],
      bccRecipients: options.bcc
        ? [{ emailAddress: { address: options.bcc } }]
        : [],
      internetMessageHeaders: options.reply
        ? [{ name: "In-Reply-To", value: options.reply }]
        : [],
      body: {
        contentType: "text",
        content: options.text ?? "Need steel please",
      },
    };
    messages.set(id, message);
    return message;
  }
  return {
    configuration: identity.configuration,
    identity: identity.control,
    calls,
    sends,
    control,
    messages,
    pages,
    bodyReads,
    add,
    fetch: fetcher,
  };
}
