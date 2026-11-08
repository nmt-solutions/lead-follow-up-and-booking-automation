import { z } from "zod";
import { exaActivationSchema, type ExaActivation } from "../models/exa";
import {
  DiscoveryProviderFailure,
  discoveryPolicySchema,
  searchResultSchema,
  evidenceUrlSchema,
  type DiscoveryPolicy,
  type DiscoveryProvider,
  type DiscoveryBrief,
  type DiscoveryProviderCost,
} from "../models/discovery";
import type { Clock } from "../models/business";

// Select the public REST API directly: no SDK retry, enrichment, synthesis,
// account provisioning or implicit tool/model fallback can be introduced here.
export function createExaRetrieval(dependencies: {
  activation: unknown;
  apiKey?: string;
  fetch: typeof fetch;
  clock: Clock;
}): Pick<DiscoveryProvider, "id" | "setup" | "search" | "contents"> {
  const parsed = exaActivationSchema.safeParse(dependencies.activation);
  const activation: ExaActivation | null = parsed.success ? parsed.data : null;
  function setup(policy: DiscoveryPolicy, brief?: DiscoveryBrief) {
    if (!activation || !dependencies.apiKey?.trim())
      return [
        "Exa is disabled. The operator must record #2 executed MSA/order scope, data permissions, quote, account limits and credentials.",
      ];
    if (
      !policy.exa ||
      policy.exa.scopeRef !== activation.scopeRef ||
      policy.exa.maxContentsPerSearch > policy.maxResults ||
      policy.exa.requestTimeoutMs > policy.deadlineMs ||
      (policy.permissions.retainQueries &&
        !activation.permissions.retainQueries)
    )
      return [
        "Exa Business query scope, Contents and call limits need operator review.",
      ];
    if (
      brief &&
      (!brief.buyers.every((b) =>
        policy.exa?.buyerCategories.includes(b.label),
      ) ||
        (brief.publicOffering &&
          !policy.exa.publicOfferings.includes(brief.publicOffering)))
    )
      return [
        "Use operator-reviewed public offering and buyer categories. Named-person and private queries are unsupported.",
      ];
    return [];
  }
  function permitted(policy: DiscoveryPolicy) {
    const result = discoveryPolicySchema.safeParse(policy);
    if (!result.success || setup(result.data).length || !result.data.exa)
      throw new DiscoveryProviderFailure("permission_denied");
    return result.data.exa;
  }
  async function request(
    endpoint: "search" | "contents",
    body: object,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
      const response = await dependencies.fetch(
        `https://api.exa.ai/${endpoint}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": dependencies.apiKey ?? "",
          },
          body: JSON.stringify(body),
          signal: combined,
          redirect: "error",
          cache: "no-store",
        },
      );
      combined.throwIfAborted();
      if (!response.ok) {
        await response.body?.cancel();
        throw new DiscoveryProviderFailure(
          response.status === 429
            ? "rate_limited"
            : [400, 401, 402, 403, 404, 422].includes(response.status)
              ? "permission_denied"
              : "unavailable",
        );
      }
      // Enforce the bound while streaming, including chunked responses. Never log
      // raw bodies/headers, provider messages, or account identifiers.
      const reader = response.body?.getReader();
      if (!reader) throw new DiscoveryProviderFailure("invalid_response");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          combined.throwIfAborted();
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 262144)
            throw new DiscoveryProviderFailure("invalid_response");
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      combined.throwIfAborted();
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new DiscoveryProviderFailure("invalid_response");
      }
    } catch (error: unknown) {
      signal.throwIfAborted();
      if (error instanceof DiscoveryProviderFailure) throw error;
      // A timeout/network failure may have been accepted/billed. Preserve the
      // reservation as uncertain instead of declaring a safely failed request.
      throw new DiscoveryProviderFailure("uncertain");
    } finally {
      clearTimeout(timer);
    }
  }
  const entry = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    url: evidenceUrlSchema,
    publishedDate: z.iso.datetime({ offset: true }).optional(),
  });
  const invalid = () => new DiscoveryProviderFailure("invalid_response");
  async function reportCost(
    raw: unknown,
    record?: (value: DiscoveryProviderCost) => Promise<void>,
  ) {
    if (!record) return;
    const response = z
      .object({
        requestId: z
          .string()
          .regex(/^[a-zA-Z0-9_.:-]{1,160}$/)
          .optional(),
        costDollars: z
          .object({ total: z.number().finite().nonnegative().max(1e12) })
          .optional(),
      })
      .safeParse(raw);
    await record({
      provider: "exa",
      estimatedUsd: response.success
        ? (response.data.costDollars?.total ?? null)
        : null,
      requestId: response.success ? (response.data.requestId ?? null) : null,
    });
  }
  return {
    id: "exa-search-contents-v1",
    setup,
    async search(input) {
      const config = permitted(input.policy);
      if (
        !config.publicOfferings.includes(input.offering) ||
        !config.buyerCategories.includes(input.buyer.label) ||
        !input.policy.activeMarkets.includes(input.market) ||
        input.limit !== input.policy.maxResults
      )
        throw new DiscoveryProviderFailure("permission_denied");
      const focused =
        config.focusedDomains.length > 0 && !input.buyer.requiresBuyingRequest;
      // Explicit projection. Never spread the brief, buyer object, identity or
      // model output into the wire request. Named-person searches are unsupported.
      const raw = await request(
        "search",
        {
          query: `${input.offering} | ${input.buyer.label} | ${input.market}`,
          type: focused ? "lite" : "auto",
          numResults: input.limit,
          ...(focused ? { includeDomains: config.focusedDomains } : {}),
        },
        input.signal,
        config.requestTimeoutMs,
      );
      await reportCost(raw, input.recordCost);
      const response = z
        .object({ results: z.array(entry).max(input.limit) })
        .safeParse(raw);
      if (!response.success) throw invalid();
      if (
        response.data.results.some(
          (result) =>
            result.publishedDate &&
            new Date(result.publishedDate) > dependencies.clock.now(),
        )
      )
        throw invalid();
      return response.data.results.map((result) =>
        searchResultSchema.parse({
          name: result.title ?? new URL(result.url).hostname,
          url: result.url,
          market: input.market,
          excerpt: result.title ?? new URL(result.url).hostname,
          retrieval: {
            provider: "exa",
            scopeRef: config.scopeRef,
            contentType: "metadata",
            publishedAt: result.publishedDate ?? null,
            contentSource: null,
          },
        }),
      );
    },
    async contents(input) {
      const config = permitted(input.policy);
      const source = searchResultSchema.safeParse(input.source);
      if (
        !source.success ||
        source.data.retrieval?.provider !== "exa" ||
        source.data.retrieval.scopeRef !== config.scopeRef ||
        source.data.retrieval.contentType !== "metadata"
      )
        throw new DiscoveryProviderFailure("permission_denied");
      const raw = await request(
        "contents",
        {
          urls: [source.data.url],
          [config.contentsType]: { maxCharacters: config.maxExcerptChars },
          maxAgeHours: config.maxAgeHours,
          livecrawlTimeout: config.requestTimeoutMs,
        },
        input.signal,
        config.requestTimeoutMs,
      );
      await reportCost(raw, input.recordCost);
      const response = z
        .object({
          results: z
            .array(
              entry.extend({
                text: z.string().optional(),
                highlights: z.array(z.string()).optional(),
              }),
            )
            .max(1),
          statuses: z
            .array(
              z.object({
                id: z.string(),
                status: z.enum(["success", "error"]),
                source: z.enum(["cached", "crawled"]).optional(),
                error: z
                  .object({
                    tag: z.string(),
                    httpStatusCode: z.number().nullable().optional(),
                  })
                  .nullable()
                  .optional(),
              }),
            )
            .length(1),
        })
        .safeParse(raw);
      if (!response.success) throw invalid();
      const status = response.data.statuses[0];
      if (status.id !== source.data.url) throw invalid();
      if (status.status === "error")
        throw new DiscoveryProviderFailure("unavailable");
      const result = response.data.results[0];
      if (!result || result.url !== source.data.url) throw invalid();
      if (
        result.publishedDate &&
        new Date(result.publishedDate) > dependencies.clock.now()
      )
        throw invalid();
      const excerpt =
        config.contentsType === "text"
          ? result.text
          : result.highlights?.join("\n");
      if (!excerpt?.trim() || excerpt.length > config.maxExcerptChars)
        throw invalid();
      return searchResultSchema.parse({
        ...source.data,
        excerpt,
        retrieval: {
          provider: "exa",
          scopeRef: config.scopeRef,
          contentType: config.contentsType,
          publishedAt:
            result.publishedDate ?? source.data.retrieval.publishedAt,
          contentSource: status.source ?? null,
        },
      });
    },
  };
}
