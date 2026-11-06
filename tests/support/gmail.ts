import type { GmailConfiguration } from "../../src/gmail/configuration";
import { gmailReadScope } from "../../src/models/gmail";

export function gmailFixture() {
  const configuration: GmailConfiguration = {
    clientId: "gmail-fixture",
    clientSecret: "fixture-secret",
    origin: "http://localhost:3000",
    activeKeyId: "fixture",
    keys: { fixture: "cd".repeat(32) },
  };
  const calls: { url: URL; body: Record<string, string>; method: string }[] =
    [];
  const messages = new Map<string, Record<string, unknown>>();
  const pages = new Map<string, unknown>();
  const histories = new Map<string, unknown>();
  const bodyReads: string[] = [];
  const control = {
    scopes: `openid email ${gmailReadScope}`,
    subject: "gmail-subject",
    email: "sales@supplier.example",
    tokenError: 0,
    apiError: 0,
    revokeError: 0,
    refreshes: 0,
    beforeRefresh: undefined as (() => Promise<void>) | undefined,
    beforeBody: undefined as (() => Promise<void>) | undefined,
    beforeToken: undefined as (() => Promise<void>) | undefined,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body =
      init?.body instanceof URLSearchParams
        ? Object.fromEntries(init.body)
        : {};
    calls.push({ url, body, method: init?.method ?? "GET" });
    const response = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (url.pathname === "/token") {
      await control.beforeToken?.();
      if (body.grant_type === "refresh_token") {
        control.refreshes++;
        await control.beforeRefresh?.();
      }
      if (control.tokenError)
        return response({ error: "invalid_grant" }, control.tokenError);
      return response({
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        token_type: "Bearer",
        expires_in: 3600,
        scope: control.scopes,
      });
    }
    if (url.pathname.endsWith("/userinfo"))
      return response({
        sub: control.subject,
        email: control.email,
        email_verified: true,
      });
    if (url.pathname === "/revoke")
      return response({}, control.revokeError || 200);
    if (control.apiError)
      return response(
        {
          error: {
            errors: [
              {
                reason:
                  control.apiError === 429 ? "rateLimitExceeded" : "forbidden",
              },
            ],
          },
        },
        control.apiError,
      );
    if (url.pathname.endsWith("/profile"))
      return response({
        emailAddress: control.email,
        historyId: "18446744073709551629",
      });
    if (url.pathname.endsWith("/labels"))
      return response({
        labels: [
          { id: "Label_sales", name: "Sales" },
          { id: "Label_quotes", name: "Quotes" },
          { id: "INBOX", name: "Inbox" },
        ],
      });
    if (url.pathname.endsWith("/history")) {
      const key =
        url.searchParams.get("pageToken") ??
        url.searchParams.get("startHistoryId") ??
        "";
      const value = histories.get(key);
      return value === "expired"
        ? response({}, 404)
        : response(value ?? { historyId: "18446744073709551630", history: [] });
    }
    if (url.pathname.endsWith("/messages"))
      return response(
        pages.get(
          url.searchParams.get("pageToken") ??
            url.searchParams.get("labelIds") ??
            "mailbox",
        ) ?? { messages: [] },
      );
    if (url.pathname.includes("/threads/")) {
      const id = url.pathname.split("/").at(-1);
      return response({
        id,
        messages: [...messages.values()]
          .filter((m) => m.threadId === id)
          .map((m) => ({
            ...m,
            payload: { headers: (m.payload as { headers: unknown }).headers },
          })),
      });
    }
    if (url.pathname.includes("/messages/")) {
      const id = url.pathname.split("/").at(-1)!;
      const m = messages.get(id);
      if (!m) return response({}, 404);
      if (url.searchParams.get("format") === "full") {
        await control.beforeBody?.();
        bodyReads.push(id);
        return response(m);
      }
      return response({
        ...m,
        payload: { headers: (m.payload as { headers: unknown }).headers },
      });
    }
    throw new Error("Unexpected Gmail fixture endpoint");
  };
  function add(
    id: string,
    options: {
      at?: string;
      thread?: string;
      labels?: string[];
      from?: string;
      to?: string;
      reply?: string;
      text?: string;
      internetId?: string;
    } = {},
  ) {
    const message = {
      id,
      threadId: options.thread ?? "abc123",
      labelIds: options.labels ?? ["Label_sales", "INBOX"],
      internalDate: String(
        new Date(options.at ?? "2026-11-05T09:01:00Z").getTime(),
      ),
      sizeEstimate: 1000,
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: options.from ?? "Buyer <buyer@example.com>" },
          { name: "To", value: options.to ?? control.email },
          { name: "Subject", value: "Steel inquiry" },
          {
            name: "Message-ID",
            value: options.internetId ?? `<${id}@example.com>`,
          },
          ...(options.reply
            ? [{ name: "In-Reply-To", value: options.reply }]
            : []),
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              {
                mimeType: "text/plain",
                body: {
                  size: 18,
                  data: Buffer.from(
                    options.text ?? "Need steel please",
                  ).toString("base64url"),
                },
              },
              {
                mimeType: "text/html",
                body: {
                  size: 20,
                  data: Buffer.from("<p>Need steel</p>").toString("base64url"),
                },
              },
            ],
          },
        ],
      },
    };
    messages.set(id, message);
    return message;
  }
  return {
    configuration,
    calls,
    control,
    messages,
    pages,
    histories,
    bodyReads,
    add,
    fetch: fetcher,
  };
}
