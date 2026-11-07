import { createHmac } from "node:crypto";
import { z } from "zod";
import { calendarCredentialVault } from "../appointments/credentials";
import type { GoogleCalendarConfiguration } from "../google-calendar/configuration";
import type {
  NativeCleanup,
  RevocationOutcome,
} from "../models/data-governance";
import type { MetaConfiguration } from "../whatsapp/configuration";

/** Native contracts only. Microsoft delegated grants have no app-scoped revoke API. */
export function createDataRevoker(d: {
  fetch: typeof fetch;
  gmail: GoogleCalendarConfiguration | null;
  google: GoogleCalendarConfiguration | null;
  meta: (MetaConfiguration & { providerKey?: string }) | null;
}) {
  return async (
    target: NativeCleanup,
    current: () => Promise<boolean>,
  ): Promise<RevocationOutcome> => {
    if (
      target.kind === "microsoft_mail" ||
      target.kind === "microsoft_calendar"
    )
      return "manual_required";
    if (target.kind === "gmail" || target.kind === "google_calendar") {
      const configuration = target.kind === "gmail" ? d.gmail : d.google;
      if (!configuration) return "unconfirmed";
      const vault = calendarCredentialVault(configuration),
        aad = `${target.kind === "gmail" ? "gmail" : "google-calendar"}:${target.businessId}:${target.targetId}`;
      const tokens: string[] = [];
      if (target.secret?.credentials)
        tokens.push(
          z
            .object({ refreshToken: z.string().min(1).max(8192) })
            .parse(JSON.parse(vault.decrypt(target.secret.credentials, aad)))
            .refreshToken,
        );
      // Rejected OAuth tokens have no persisted verified subject. They may be
      // wrong-account callbacks belonging to another Business; the original
      // subject's sharing guard cannot authorize their project-wide revocation.
      const unattributed = Boolean(
        target.secret && target.secret.rejected !== null,
      );
      if (!tokens.length) return "manual_required";
      for (const token of new Set(tokens)) {
        if (!(await current())) return "unconfirmed";
        const r = await d.fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          body: new URLSearchParams({ token }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        // A 200 is authoritative acceptance. Invalid/expired token alone cannot
        // prove project-wide consent removal; keep that outcome incomplete.
        await r.body?.cancel();
        if (r.status !== 200) return "unconfirmed";
      }
      return unattributed ? "manual_required" : "confirmed";
    }
    if (target.kind !== "meta" || !d.meta || !target.secret?.credentials)
      return "unconfirmed";
    const config = d.meta,
      vault = calendarCredentialVault(config),
      version = Number(target.details.version) - 1;
    if (
      target.details.providerKey !==
      (config.providerKey ??
        `direct-meta:${config.appId}:${config.configId}:${config.graphVersion}`)
    )
      return "unconfirmed";
    const token = z
      .object({ accessToken: z.string().min(1).max(16384) })
      .parse(
        JSON.parse(
          vault.decrypt(
            target.secret.credentials,
            `whatsapp:${target.businessId}:${target.targetId}:${version}`,
          ),
        ),
      ).accessToken;
    const waba = z
      .string()
      .regex(/^[0-9]{1,40}$/)
      .parse(target.details.wabaId);
    const url = new URL(
      `https://graph.facebook.com/${config.graphVersion}/${waba}/subscribed_apps`,
    );
    url.searchParams.set(
      "appsecret_proof",
      createHmac("sha256", config.appSecret).update(token).digest("hex"),
    );
    // Inspect first, including on retry/lost DELETE acknowledgement. The app's
    // absence is the only success; this never deletes a number/account or token's user.
    const request = async (method: "GET" | "DELETE") => {
      const r = await d.fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        await r.body?.cancel();
        return null;
      }
      const reader = r.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const v = await reader.read();
          if (v.done) break;
          size += v.value.length;
          if (size > 65536) return null;
          chunks.push(v.value);
        }
      } finally {
        await reader.cancel();
      }
      try {
        const value: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        return value;
      } catch {
        return null;
      }
    };
    const schema = z.object({
      paging: z.object({ next: z.string().optional() }).optional(),
      data: z
        .array(
          z.object({
            whatsapp_business_api_data: z.object({ id: z.string() }),
          }),
        )
        .max(100),
    });
    const before = schema.safeParse(await request("GET"));
    if (!before.success || before.data.paging?.next) return "unconfirmed";
    if (
      !before.data.data.some(
        (e) => e.whatsapp_business_api_data.id === config.appId,
      )
    )
      return "subscription_removed";
    if (!(await current())) return "unconfirmed";
    // No guessed global identity revocation. DELETE removes this app's WABA
    // subscription. The customer's WABA, number and billing account remain theirs.
    const removed = z
      .object({ success: z.literal(true) })
      .safeParse(await request("DELETE"));
    return removed.success ? "subscription_removed" : "unconfirmed";
  };
}
