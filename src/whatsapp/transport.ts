import { z } from "zod";
import { ApplicationError } from "../models/application-error";
import type { MetaAssets, MetaToken } from "../models/whatsapp";
import { metaTemplateSchema, type MetaIntent, type MetaSendResult, type MetaTemplateSelection } from "../models/whatsapp-sending";

/** One POST, no retry, no idempotency header. Callback data correlates evidence; it does not deduplicate Meta sends. */
export function createMetaTransport(d: { graphVersion: string; fetch: typeof fetch }) {
  if (!/^v\d{2,3}\.0$/.test(d.graphVersion)) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
  async function request(path: string, token: MetaToken, signal: AbortSignal, body?: unknown, query?: Record<string, string>) {
    const url = new URL(`https://graph.facebook.com/${d.graphVersion}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    return d.fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token.accessToken}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal, cache: "no-store", redirect: "error" });
  }
  return {
    available: true,
    async template(token: MetaToken, assets: MetaAssets, selection: MetaTemplateSelection, signal: AbortSignal) {
      const response = await request(`${assets.wabaId}/message_templates`, token, signal, undefined, { name: selection.name, fields: "id,name,language,status,category,components", limit: "100" });
      if (!response.ok) throw new ApplicationError("PROVIDER_UNAVAILABLE");
      const parsed = z.object({ data: z.array(z.object({ id: z.string(), name: z.string(), language: z.string(), status: z.string(), category: z.string(), components: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()) })).max(100), paging: z.object({ next: z.string().optional() }).optional() }).safeParse(await response.json());
      if (!parsed.success) throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
      const matches = parsed.data.data.filter((t) => t.name === selection.name && t.language === selection.language);
      if (matches.length !== 1 || parsed.data.paging?.next) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      const t = matches[0];
      // This executable subset supports body-only positional text. Media, buttons, named parameters and authentication remain explicit gates.
      if (t.status !== "APPROVED" || t.components.length !== 1 || t.components[0].type !== "BODY" || !t.components[0].text) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      const body = t.components[0].text;
      const indexes = [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      if (Math.max(0, ...indexes) !== selection.parameters.length || indexes.some((n) => n < 1) || selection.parameters.some((_, i) => !indexes.includes(i + 1))) throw new ApplicationError("INVALID_INPUT");
      const rendered = body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => selection.parameters[Number(index) - 1]);
      if (/[{}]/.test(rendered)) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      const result = metaTemplateSchema.safeParse({ ...selection, id: t.id, category: t.category, body, rendered });
      if (!result.success) throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
      return result.data;
    },
    async send(token: MetaToken, intent: MetaIntent, signal: AbortSignal): Promise<MetaSendResult> {
      try {
        const response = await request(`${intent.assets.phoneNumberId}/messages`, token, signal, {
          messaging_product: "whatsapp", recipient_type: "individual", to: intent.peer,
          biz_opaque_callback_data: intent.actionId,
          ...(intent.parent ? { context: { message_id: intent.parent } } : {}),
          ...(intent.template ? { type: "template", template: { name: intent.template.name, language: { code: intent.template.language }, components: intent.template.parameters.length ? [{ type: "body", parameters: intent.template.parameters.map((value) => ({ type: "text", text: value })) }] : [] } } : { type: "text", text: { preview_url: false, body: intent.body } }),
        });
        const value: unknown = await response.json();
        if (!response.ok) {
          const error = z.object({ error: z.object({ code: z.number().int() }) }).safeParse(value);
          if (!error.success || response.status >= 500) return { status: "unknown", reason: "transport_ambiguous" };
          return { status: "not_accepted", reason: [10, 190, 200].includes(error.data.error.code) ? "permission_denied" : response.status === 429 ? "rate_limited" : response.status === 400 ? "invalid_request" : "provider_rejected" };
        }
        const parsed = z.object({ messaging_product: z.literal("whatsapp"), contacts: z.array(z.object({ wa_id: z.string() })).length(1), messages: z.array(z.object({ id: z.string().regex(/^wamid\.[^\s\u0000-\u001f]{1,250}$/) })).length(1) }).safeParse(value);
        if (!parsed.success || parsed.data.contacts[0].wa_id !== intent.peer) return { status: "unknown", reason: "invalid_provider_response" };
        return { status: "accepted", messageRef: parsed.data.messages[0].id, peer: intent.peer };
      } catch { return { status: "unknown", reason: "transport_ambiguous" }; }
    },
  };
}
export type MetaTransport = ReturnType<typeof createMetaTransport>;
