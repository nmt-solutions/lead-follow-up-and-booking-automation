import type { Clock } from "../../src/models/business";
import { razorpayFixture } from "./razorpay";

export const fixtureAdjustmentPolicy = {
  id: "fixture-adjustment-policy",
  version: 1,
  mode: "test",
  account: "acc_fixture:test",
  reviewedBy: "deployment-operator",
  checkedAt: "2026-11-01T00:00:00.000Z",
  effectiveFrom: "2026-11-01T00:00:00.000Z",
  effectiveUntil: "2027-11-01T00:00:00.000Z",
  evidence: ["fixture:approved-refund-dispute-access-terms"],
  normalRefunds: true,
  acceptDisputes: true,
  contestDisputes: true,
  partialRefundAccess: "block_period",
  fullRefundAccess: "block_period",
  disputeOpenAccess: "block_period",
  disputeLostAccess: "block_period",
  disputeWonAccess: "preserve",
  disputeClosedAccess: "preserve",
  disputeLostCredit: true,
  preserveRecords: true,
};
export function financialNativeFixture(clock: Clock) {
  const native = razorpayFixture(clock),
    base = native.configuration.fetch;
  const refunds: Record<string, unknown>[] = [],
    refundPosts: { key: string | null; body: unknown }[] = [],
    disputes = new Map<string, Record<string, unknown>>();
  const documents = new Map<string, Uint8Array>();
  const effectRequests: { method: string; path: string }[] = [];
  const disputePosts: {
    path: string;
    method: string;
    body: unknown;
    idempotency: string | null;
  }[] = [];
  const fixture = {
    ...native,
    refunds,
    refundPosts,
    disputes,
    documents,
    disputePosts,
    effectRequests,
    loseRefund: false,
    loseDispute: false,
    beforePost: async () => {},
    afterPost: async () => {},
    onPaymentRead: async () => {},
    configuration: {
      ...native.configuration,
      env: {
        ...native.configuration.env,
        FINANCIAL_ADJUSTMENT_POLICY: JSON.stringify(fixtureAdjustmentPolicy),
      },
      fetch: (async (input, init) => {
        const url = new URL(
            typeof input === "string" || input instanceof URL
              ? input
              : input.url,
          ),
          method = init?.method ?? "GET";
        if (url.origin !== "https://api.razorpay.com") throw Error("origin");
        if (
          new Headers(init?.headers).get("authorization") !==
          `Basic ${Buffer.from("rzp_test_fixture:fixture-api-secret").toString("base64")}`
        )
          throw Error("auth");
        if (method !== "GET" && method !== "HEAD")
          effectRequests.push({ method, path: url.pathname });
        if (url.pathname.endsWith("/refund") && method === "POST") {
          await fixture.beforePost();
          const body = JSON.parse(String(init?.body)),
            key = new Headers(init?.headers).get("X-Refund-Idempotency");
          refundPosts.push({ key, body });
          const refund = {
            id: `rfnd_fixture${refunds.length + 1}`,
            entity: "refund",
            payment_id: url.pathname.split("/").at(-2),
            amount: body.amount,
            currency: "INR",
            status: "pending",
            receipt: body.receipt,
            notes: body.notes,
            created_at: Math.floor(clock.now().getTime() / 1000),
            acquirer_data: { arn: null },
            speed_requested: "normal",
          };
          refunds.push(refund);
          await fixture.afterPost();
          if (fixture.loseRefund) throw Error("lost acknowledgement");
          return Response.json(refund);
        }
        if (url.pathname.endsWith("/refunds")) {
          const skip = Number(url.searchParams.get("skip") ?? 0),
            items = refunds.slice(skip, skip + 100);
          return Response.json({
            entity: "collection",
            count: items.length,
            items,
          });
        }
        if (/\/refunds\/rfnd_/.test(url.pathname))
          return Response.json(
            refunds.find((r) => r.id === url.pathname.split("/").at(-1)),
          );
        if (url.pathname.startsWith("/v1/documents/")) {
          const bytes = documents.get(url.pathname.split("/")[3]);
          return bytes
            ? new Response(Buffer.from(bytes), {
                headers: { "content-type": "application/pdf" },
              })
            : Response.json({}, { status: 404 });
        }
        if (url.pathname.startsWith("/v1/disputes/")) {
          const id = url.pathname.split("/")[3],
            d = disputes.get(id);
          if (!d) return Response.json({}, { status: 404 });
          if (method !== "GET") {
            disputePosts.push({
              path: url.pathname,
              method,
              body: init?.body ? JSON.parse(String(init.body)) : null,
              idempotency: new Headers(init?.headers).get(
                "X-Refund-Idempotency",
              ),
            });
            await fixture.beforePost();
            if (url.pathname.endsWith("/accept")) {
              d.status = "lost";
              d.amount_deducted = d.amount;
            } else {
              const body = JSON.parse(String(init?.body));
              d.evidence = {
                ...body,
                submitted_at:
                  body.action === "submit"
                    ? Math.floor(clock.now().getTime() / 1000)
                    : null,
              };
              if (body.action === "submit") d.status = "under_review";
            }
            await fixture.afterPost();
            if (fixture.loseDispute) throw Error("lost dispute response");
          }
          return Response.json(d);
        }
        const result = await base(input, init);
        if (/^\/v1\/payments\/[^/]+$/.test(url.pathname) && method === "GET")
          await fixture.onPaymentRead();
        return result;
      }) satisfies typeof fetch,
    },
  };
  return fixture;
}
