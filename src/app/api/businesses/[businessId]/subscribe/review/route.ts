import { z } from "zod";
import { getServices } from "@/server/services";
import { handleRequest } from "@/server/request";
import { createJsonBodyReader } from "@/http/request-body";
import { dataResponse } from "@/models/api";
import { ApplicationError } from "@/models/application-error";
import { isPlanId } from "@/content/plans";
import {
  productionSubscriptionIssues,
  publishedOfferMatches,
} from "@/production/subscriptions";
export const runtime = "nodejs";
const inputSchema = z.strictObject({
  planId: z.string().refine(isPlanId),
  requestKey: z.uuid(),
  acceptedTerms: z.literal(true),
});
export const POST = (
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) =>
  handleRequest(async () => {
    const services = await getServices();
    const { businessId } = await context.params;
    // Authorization happens before configuration details or input-dependent lookups.
    const state = await services.subscriptionQuotes.workspace(
      request.headers,
      businessId,
    );
    const raw = await createJsonBodyReader(
      new URL(
        process.env.BETTER_AUTH_URL ?? "https://leadrelay.nmtsolutions.in",
      ).origin,
      4096,
    )(request);
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success || !isPlanId(parsed.data.planId))
      throw new ApplicationError("INVALID_INPUT");
    if (productionSubscriptionIssues().length)
      throw new ApplicationError("SETUP_REQUIRED");
    const { planId, requestKey } = parsed.data;
    const offer = state.offers.find((item) => item.id === planId);
    if (!offer || !publishedOfferMatches(offer, planId))
      throw new ApplicationError("PRICING_SETUP_REQUIRED");
    const quote = await services.subscriptionQuotes.createQuote(
      request.headers,
      businessId,
      {
        expectedCatalogVersion: state.catalogVersion,
        expectedBillingVersion: state.billing.version,
        expectedReviewVersion: state.billing.reviewVersion,
        offerId: planId,
        reservedCapacityId: null,
        term: "monthly",
        requestKey,
      },
    );
    return dataResponse(
      await services.subscriptionPayments.prepare(request.headers, businessId, {
        quoteId: quote.snapshot.id,
        requestKey,
      }),
    );
  });
