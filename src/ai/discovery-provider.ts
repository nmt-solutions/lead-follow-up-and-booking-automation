import type { createAiApplication } from "../application/ai";
import {
  DiscoveryProviderFailure,
  type DiscoveryProvider,
} from "../models/discovery";

/** Exa retains sole ownership of retrieval and its rights/configuration. */
export function createProfiledDiscoveryProvider(
  retrieval: Pick<DiscoveryProvider, "id" | "search">,
  ai: Pick<ReturnType<typeof createAiApplication>, "executeWorkflow">,
): DiscoveryProvider {
  return {
    id: retrieval.id,
    search: (input) => retrieval.search(input),
    async review(input) {
      if (!input.identity || !input.authorize)
        throw new DiscoveryProviderFailure("permission_denied");
      const result = await ai.executeWorkflow(
        input.identity,
        {
          businessId: input.businessId,
          requestKey: input.operationId,
          sample: {
            task: "extraction",
            label: input.source.name,
            text: input.source.excerpt,
          },
          context: {
            brief: input.brief,
            buyer: input.buyer,
            sourceUrl: input.source.url,
          },
        },
        { signal: input.signal, authorize: input.authorize },
      );
      if (result.status !== "succeeded" || !result.output)
        throw new DiscoveryProviderFailure(
          result.failure === "invalid_output"
            ? "invalid_response"
            : result.failure === "credentials"
              ? "permission_denied"
              : result.failure === "rate_limited"
                ? "rate_limited"
                : "unavailable",
        );
      return result.output;
    },
  };
}
